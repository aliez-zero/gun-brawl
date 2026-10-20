# 从本地单机改为 Client-Server（CS）架构的方案

> **已被 [CLIENT_SERVER_PLAN_V2.md](./CLIENT_SERVER_PLAN_V2.md) 取代（2026-10-19）。** v2 记录了四项产品决策（4 人房 + AI 补位、延迟展示、匿名会话、完整部署）并修正了本版的三个硬伤；本文仅保留作历史对比，实施以 v2 为准。

研究日期：2026-10-19（北京时间）。范围：把现在"浏览器内自己跑完整模拟"的原型，改成**前后端分工、服务端权威**的联机游戏，服务端用 Rust，支持 Docker 部署。本文只做方案与拆解，不含实现。

## 1. 现状盘点：哪些能搬、哪些必须重写

| 层 | 位置 | 行数 | 迁移策略 |
| --- | --- | --- | --- |
| 纯规则核心 | `src/game/core` | 587 | **原样移植到 Rust**（无 Phaser、无 DOM、无存储） |
| 规则系统 | `src/game/systems` | 779 | 同上：移动 / 战斗 / 手雷 / 爆炸 / 投放 / 生命 / 胜负 / 训练 |
| AI | `src/game/ai` | 518 | 移植到服务端（AI 不可能交给客户端） |
| 内容数据 | `src/content` | 893 | **抽成共享 JSON**，TS / Rust 都读同一份 |
| 表现层 | `src/presentation` | 3,128 | 留在前端，改成"渲染快照" |
| 应用 / UI / 存档 | `src/app`、`src/ui`、`src/storage` | 1,366 | 拆分：局内 UI 保留，存档迁服务端 |

三个已经具备的有利条件：

1. **核心是纯函数式状态机**：`BattleSimulation.step(dt, inputs)` 输入固定、无副作用、无外部 I/O。这正是服务端 tick 需要的形状。
2. **固定 60 Hz + 种子随机**：`FIXED_STEP = 1/60`，`Random` 是 mulberry32 变体，同一个种子可复现。服务端可以直接按 tick 推进，回放也能重建。
3. **数据驱动**：地图 / 武器 / 战役都在 `content/` 里是纯对象，没有硬编码在渲染或 UI 里。

不利条件：

- 现在**没有任何网络层**，客户端即权威；`GameApplication` 直接持有 `MatchRunner` 并驱动 `requestAnimationFrame`。
- 存档在 `localStorage`，排行榜 / 战绩 / 战役进度都在浏览器里，联机后必须可信化。
- DeepSeek 网关目前是 Vite 中间件（Node），联机后应变成服务端的一个模块或独立服务。

## 2. 目标架构

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│ Browser                     │        │ Rust 服务端                       │
│                             │  WS    │                                  │
│  Phaser 渲染  ◀── 快照 ─────┼────────┤  房间 Actor（每房一个 tokio task）│
│  输入采集     ── 输入帧 ───▶│        │    60 Hz 模拟（同一份 core crate）│
│  WASM 预测（本地角色）      │        │    30 Hz 快照广播                 │
│  DOM HUD / 菜单             │        │    AI 掉线托管 / 观战             │
└─────────────────────────────┘        │  大厅：房间列表 / 匹配 / 重连      │
        ▲                              │  持久化：战绩 / 战役 / 皮肤        │
        └──── 静态资源（CDN 或 axum）──┴──────────────────────────────────┘
```

核心决策：**规则只写一遍，编译成两处**。

- `gunbrawl-core`（Rust crate，纯逻辑）同时被：
  - 服务端二进制直接调用；
  - 编译成 **WASM** 给浏览器做本地角色预测 / 离线练习。
- 前端不再保留第二套 TS 模拟（迁移期可临时保留，作为本地练习的降级路径）。

这样"前后端共同完成游戏逻辑"不是靠两份代码对齐，而是**同一份 Rust 代码的两个编译目标**，从根本上消灭两边规则漂移。

### 为什么不用确定性帧同步（lockstep）

帧同步要求前后端**逐位一致**（浮点、`sin/cos/pow` 跨语言/跨 CPU 都可能差最后一位）。本作有大量三角函数与指数衰减，跨 TS/Rust 对齐不现实。服务端权威 + WASM 预测既拿到了"本地跟手"，又不需要跨语言位级一致。

## 3. 网络模型

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 传输 | **WebSocket**（二进制帧） | 浏览器全平台可用；TCP 队头阻塞在 4 人同房、10 kB/s 量级下可接受 |
| 升级路径 | WebTransport（QUIC） | 后续若出现丢包卡顿再换，协议层已经按"不可靠数据报可丢"设计 |
| 模拟频率 | **60 Hz** | 与现有 `FIXED_STEP` 一致，物理手感不变 |
| 快照频率 | **30 Hz** | 4 人 + 弹丸，单帧约 300–500 B，约 12 kB/s |
| 输入频率 | **30 Hz，按 tick 批处理** | 客户端每 2 帧发一次 `InputFrame[]` |
| 输入延迟 | 客户端本地预测 + 服务端校正 | 目标：本地角色无感，远端角色插值 100 ms |

### 3.1 消息定义（`gunbrawl-proto`）

```rust
// 客户端 → 服务端
enum ClientMsg {
    Hello { version: u16, token: Option<String> },
    JoinRoom { room: Option<String>, name: String, appearance: Appearance },
    SetReady { ready: bool },
    Input { frames: Vec<InputFrame> },      // seq 单调递增，服务端去重
    Ping { client_time_ms: u64 },
    Leave,
}

// 服务端 → 客户端
enum ServerMsg {
    Welcome { player_id: u32, tick_rate: u16, snapshot_rate: u16, server_tick: u64 },
    Room { room_id: String, players: Vec<PlayerInfo>, map_id: String, mode: GameMode },
    Snapshot(Snapshot),
    MatchResult { winner: Option<u32>, stats: Vec<PlayerStat> },
    Error { code: u16, message: String },
}

struct InputFrame {
    seq: u32,
    move_x: i8,          // -1 / 0 / 1
    buttons: u8,         // bit0 跳 / bit1 穿台 / bit2 开火 / bit3 换弹 / bit4 投弹
}

struct Snapshot {
    tick: u64,
    server_ms: u64,
    ack_seq: u32,                          // 已处理到的最后一个输入序号（预测校正用）
    actors: Vec<ActorSnap>,                // 位置量化到 1/16 px
    projectiles: Vec<ProjectileSnap>,
    bombs: Vec<BombSnap>,
    drops: Vec<DropSnap>,
    events: Vec<EventSnap>,                // 命中 / 爆炸 / 出界 / 复活，用于音效与特效
}
```

要点：

- **位置量化**：`i32` 存 `px * 16`，把 `f32` 压到 3 B/轴，同时避免不同平台浮点格式差异。
- **事件随快照下发**：客户端不自己判定命中，只播特效，避免"两边各算一套"。
- **ack_seq**：客户端拿它回滚重放未确认的输入（预测校正）。
- **版本号**在 `Hello` 里，服务端拒绝不匹配的构建，避免老客户端连新服务端。

### 3.2 服务端 tick 循环

```rust
loop {
    tick += 1;
    let dt = Duration::from_secs_f64(1.0 / 60.0);
    // 1. 收集本 tick 之前到达的所有输入（每人每 tick 一条，缺失则沿用上一条）
    // 2. 用 core::step(dt, inputs) 推进一帧
    // 3. 事件入队 → 打给快照
    // 4. 每 2 tick 广播一次快照（30 Hz）
    // 5. 超时 / 掉线 / 全部离开 → 归档房间
    tokio::time::sleep_until(next_deadline).await;
}
```

**不要用 `sleep(16ms)` 累加**：按 `Instant` 计算绝对 deadline，落后就补齐（最多补 5 帧，与前端 `FixedStepLoop` 的策略一致）。

### 3.3 客户端预测与校正

1. 本地输入当帧立即用 **WASM core** 推进本地角色（预测）。
2. 服务端快照回来带 `ack_seq`：把本地状态回滚到快照，重放 `ack_seq` 之后尚未确认的输入。
3. 误差 > 8 px 时做 100 ms 平滑插值，而不是瞬移。
4. 远端角色只做插值（100 ms 缓冲），不做预测。

房间内比赛节奏慢（击退、平台），这套方案的手感上限大约等于本地 + 半个 RTT。

## 4. Rust 工程结构

```
server/
  Cargo.toml                # workspace
  crates/
    core/                   # 纯逻辑：state / movement / combat / grenade / drop / life / match
      src/lib.rs            # 无 tokio、无网络、无随机时间
      tests/                # 从 tests/*.test.ts 移植的行为断言
    content/                # 地图 / 武器 / 战役 / 训练数据（include_str! 读 JSON）
    proto/                  # serde 消息定义 + 编解码（postcard）
    bot/                    # AI：把 BotController / Navigation 移植过来
    server/                 # axum + tokio：大厅、房间、会话、持久化
      src/main.rs
      src/lobby.rs
      src/room.rs           # 每房一个 actor task
      src/session.rs        # 每个连接一个读/写 task
      src/persist.rs        # sqlx：战绩 / 战役 / 皮肤
  migrations/               # sqlx migrations
  Dockerfile
  docker-compose.yml
```

依赖（尽量少）：

```toml
axum = { version = "0.7", features = ["ws"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "sync"] }
serde = { version = "1", features = ["derive"] }
postcard = "1"              # 二进制编码，比 JSON 小 3–4 倍
sqlx = { version = "0.8", features = ["sqlite", "runtime-tokio"] }
tracing = "0.1"
tracing-subscriber = "0.3"
uuid = { version = "1", features = ["v4"] }
```

**不引入游戏引擎**（bevy 等）：现有核心是自写运动学 + AABB，port 过来就是几千行纯逻辑，引入 ECS 反而增加迁移成本。

### 4.1 移植映射

| TypeScript | Rust |
| --- | --- |
| `BattleSimulation.step(dt, inputs)` | `Simulation::step(&mut self, dt: f32, inputs: &InputTable)` |
| `ActorInput` | `InputFrame`（位域） |
| `MatchState` + `ActorState` | `MatchState { actors: Vec<Actor> }`，下标索引 |
| `Map<string, ActorInput>` | `[Option<InputFrame>; 4]`，避免每帧哈希 |
| `Random`（mulberry32） | 用 `u32::wrapping_*` 逐位复刻；**只在服务端内部要求一致**，不跨语言 |
| `weaponBurstImpulse` 等 | 同函数搬到 `core`，前端通过 WASM 调用 |
| `BattleEvent` | `EventSnap`，序列化后只用于客户端表现 |

**不需要跨语言位级一致**：客户端预测用的是同一份 Rust/WASM，不是 TS 版。

### 4.2 内容数据单一来源

现在 `src/content/*.ts` 是唯一来源。迁移时：

1. 写一个一次性脚本（Node）把 `content` 里的常量导出成 `content/*.json`（maps / weapons / campaign / tutorial / appearance）。
2. Rust 用 `include_str!` + `serde_json` 反序列化（编译期即可校验）。
3. TS 侧改成读同一份 JSON（`import data from './maps.json'`），删掉手写常量。
4. 加一条 CI 检查：JSON schema 版本号 + 必填字段，防止两边漂移。

## 5. 服务端功能拆分

| 模块 | 职责 | 备注 |
| --- | --- | --- |
| Lobby | 房间列表、创建/加入（房间码）、匹配 | 4 人房；v1 不做排位 |
| Room actor | 60 Hz 模拟、快照广播、暂停/重开、超时 | 每房一个 `tokio::spawn`，状态不出房间 |
| Session | WS 读写、限流（每连接 ≤120 msg/s）、心跳 | 读/写各一个 task，用 mpsc 交汇 |
| Bots | 空位补 AI、掉线托管 | 直接复用移植后的 `bot` |
| Persistence | 战绩、战役进度、皮肤、最近对局 | SQLite 起步，单机足够；后续换 Postgres 只改连接串 |
| DeepSeek | 外部模型对手（可选） | 从 Vite 中间件搬成服务端模块，密钥只存在服务端 |

### 5.1 权威性与反作弊边界

- 客户端只能发**输入**（`move_x ∈ {-1,0,1}` + 5 个按钮位），不能发位置、血量、击退。
- 所有命中、扣命、胜负都由服务端判定；客户端收到的快照是只读真相。
- 服务端对输入做上限校验：每 tick 最多一个 `InputFrame`，`seq` 必须单调，超额丢弃并计数（异常可踢）。
- 房间码 + 会话 token；不做公开匹配前，陌生人无法进入对局。

## 6. Docker 部署

### 6.1 单容器（推荐起步）

前端构建产物由 axum 直接托管，一个镜像包含服务端 + 静态资源：

```dockerfile
# ---- 前端 ----
FROM node:22-bookworm-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- 后端 ----
FROM rust:1-bookworm AS api
WORKDIR /app
COPY server/Cargo.toml server/Cargo.lock ./
COPY server/crates ./crates
RUN cargo build --release --bin gunbrawl-server

# ---- 运行 ----
FROM debian:bookworm-slim
RUN useradd -r -u 10001 app && mkdir -p /data && chown app /data
COPY --from=api /app/target/release/gunbrawl-server /usr/local/bin/
COPY --from=web /app/dist /srv/web
USER app
ENV GUNBRAWL_WEB_DIR=/srv/web DATABASE_URL=sqlite:///data/gunbrawl.db
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=2s CMD ["/usr/local/bin/gunbrawl-server", "--health"]
ENTRYPOINT ["gunbrawl-server"]
```

### 6.2 docker-compose

```yaml
services:
  game:
    build: .
    ports: ["8080:8080"]
    environment:
      RUST_LOG: info
      GUNBRAWL_MAX_ROOMS: "200"
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY:-}
    volumes: ["gunbrawl-data:/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "/usr/local/bin/gunbrawl-server", "--health"]
      interval: 10s
volumes: { gunbrawl-data: {} }
```

要点：

- **多阶段构建**：前端 `dist/` + Rust 静态二进制，最终镜像 60–80 MB（glibc 版）/ 30 MB（musl 版）。
- **非 root 运行**，`/data` 单独卷存 SQLite 与日志。
- 反代（Caddy / Nginx）负责 TLS 与 `Upgrade: websocket`；容器内只监听 `127.0.0.1:8080` 更安全。
- 健康检查走独立 `--health` 子命令，不依赖 HTTP 端口是否被占。
- 横向扩展要等"房间不在进程内"之后（见 7.1），v1 单进程多房间即可；单个房间每 tick 只是 4 个角色 + 少量弹丸的纯计算，容量上限需要压测确认，规划时按"数十到数百房/核"保守估计。

## 7. 迁移路线（建议 6 个阶段）

| 阶段 | 内容 | 产出 / 验收 | 估时 |
| --- | --- | --- | --- |
| P0 脚手架 | cargo workspace、proto、axum `/healthz` + WS echo、前端 `net/` 模块 | 浏览器能连上并收到 `Welcome` | 1–2 天 |
| P1 核心移植 | `core` + `content` + 单测移植 | Rust 侧规则测试覆盖主要行为（对照现有 269 项） | 1.5–2 周 |
| P2 房间与快照 | Room actor、30 Hz 快照、前端"按快照渲染"、1v1 同房 | 两台浏览器同房可对战 | 1–1.5 周 |
| P3 AI 与内容 | bot 移植、全部武器 / 地图 / 投放 / 炸弹 | 4 人房 + AI 补位 | 1–1.5 周 |
| P4 手感 | WASM 预测 + 回滚重放、远端插值、音效事件 | 本地输入无感，RTT 80 ms 下可玩 | 1–2 周 |
| P5 部署 | Dockerfile、compose、CI、压测、部署文档 | 单机 100 房压测通过 | 3–5 天 |

总计约 **6–8 周**（单人全职）；若只做 P0–P2 的"能联机对战"，2–3 周可见成果。

### 7.1 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 浮点跨语言差异 | 无法做 TS/Rust 位级回放对比 | 不做跨语言回放；预测用同一份 WASM |
| 内容两套来源 | 两边数值漂移 | 抽出 JSON 单一来源 + CI schema 校验 |
| 手感回退（击退类游戏对延迟敏感） | 联机不如单机爽 | P4 必须做预测；否则直接上 WASM 本地预测，服务端只做权威校验 |
| 现有测试无法直接复用 | 回归保护变弱 | 按"行为断言"重写 Rust 测试，不追 1:1 行覆盖 |
| 单进程房间状态 | 无法水平扩容 | v1 接受；扩容时把 Room 抽成独立服务 / 分片路由 |
| 工具链缺失 | 本机无法编译验证 | 先装 Rust（rustup）与 Docker Desktop；CI 用官方 `rust:1-bookworm` 镜像 |

## 8. 需要先确认的四件事

1. **玩法范围**：v1 是"1v1 联机对战"还是"4 人房 + AI 补位"？后者要多做 1–2 周（AI 移植 + 房间生命周期）。
2. **手感底线**：能不能接受"无预测、约 60–80 ms 输入延迟"的 v1？如果不能，P4 要提前到 P2 之后立即做。
3. **账号与存档**：联机是否要账号体系（注册 / 登录 / 云存档），还是先用匿名会话 + 房间码？前者会引入用户表、密码/令牌、限流与合规。
4. **部署形态**：只交付 Docker 镜像和 compose 文件，还是要一套可公网访问的部署（域名、TLS、反代、监控）？

## 9. 建议的最小可行版本（MVP）

如果目标是"尽快看到联机对战"，建议砍到：

- 一张地图（云上古城）、1v1、房间码加入、无账号；
- 服务端权威 60 Hz + 30 Hz 快照；
- 客户端先不做预测（接受 60–80 ms 延迟），P4 再补；
- SQLite 只存对局结果；
- 单容器 Docker。

这样 P0–P2 + 简化 P5 约 **2–3 周**，之后再按优先级补 AI、预测、账号、扩容。

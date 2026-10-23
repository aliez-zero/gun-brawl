# 混枪大乱战 · 联机版方案 v2（Rust 服务端 / 4 人房 / 完整部署）

- 取代：2026-10-19 的 [CLIENT_SERVER_PLAN.md](./CLIENT_SERVER_PLAN.md)（v1）
- 日期：2026-10-19（北京时间）
- 评审结论见：[CLIENT_SERVER_PLAN_REVIEW.md](./CLIENT_SERVER_PLAN_REVIEW.md)
- 实施状态（2026-10-20）：P1—P5 已落地，见 [联机完成交接](./updates/2026-10-20-online-complete.md)。
- 性能预算、手段与实测：[PERFORMANCE.md](./PERFORMANCE.md)（硬指标，每阶段记录）
- 本文只做方案与拆解，不含游戏实现；部署产物（Dockerfile / compose / Caddyfile / CI）在 §10 给出可直接落地的版本

## 0. 本版记录的四项决策

| # | 决策 | 对方案的影响 |
| --- | --- | --- |
| 1 | **4 人房 + 自建房间 + AI 补位** | 房间从"1v1 房间码"扩到 4 槽位；AI 必须在服务端（P3 前置到主线）；房间配置（地图/生命/时限/武器池）随房间走 |
| 2 | **接受延迟，但实时展示，并用成熟手段压低** | 预测 + 回滚 + 插值 + 抖动缓冲进入 P4；HUD 常驻 RTT/抖动/丢包；F3 调试面板 |
| 3 | **匿名会话 + 房间码** | 设备 token → 服务端匿名档案；不做注册/密码；断线 60 s 内可凭 token 回房 |
| 4 | **完整部署** | 域名 + TLS + 反代 + CI/CD + 监控告警 + 备份恢复 + 运维手册，全部进 P5，不留"以后再说" |

**路线确认**：服务端 Rust，客户端用同一份规则编译成 WASM 做预测。v1 评审中的三个硬伤（native/WASM 数学、边沿输入、Docker 网络）在本版 §4.1、§6.2、§10.2—10.3 中已修正。

## 1. 目标、范围与非目标

### 1.1 目标

- 一台公网服务器，4 名玩家用房间码开局；空位由 AI 补足；本地角色操作跟手，远端角色平滑。
- 房间可自建：房主选地图、生命、时限、掉落池、每个槽位是真人还是 AI（难度）。
- 匿名可玩：打开网页即得身份，刷新/断网 60 s 内可回到同一局。
- 延迟可见：HUD 常驻 RTT / 抖动 / 丢包；F3 看到 tick、输入缓冲、校正次数。
- 一套 Docker Compose 起完整服务；一条 CI 流水线完成构建、测试、部署、回滚。

### 1.2 非目标（v1 明确不做）

- 排位、匹配算法、跨区匹配、账号密码/第三方登录、好友系统。
- 观战、录像回放、手机触控、商城与付费。
- 横向多实例（房间跨进程）。v1 单实例多房间，扩容条件见 §8.4。
- 单机模式改走 WASM（见 §4.3 的 D2/D1 决策，排到 P6）。

### 1.3 验收口径

| 类别 | 指标 |
| --- | --- |
| 功能 | 建房/加入/满员/AI 补位/准备/开始/结算/重赛/改名/断线重连 全部可用 |
| 延迟 | 同区域 p95 RTT ≤ 80 ms；抖动 p95 ≤ 15 ms；丢包 ≤ 1% 时仍可玩 |
| 手感 | 本地按键到画面 ≤ 2 帧；> 4 px 的校正 ≤ 0.5 次/秒/人 |
| 性能 | tick p99 ≤ 2 ms；快照 p95 ≤ 600 B、单客户端 ≤ 20 KB/s；稳态每 tick 堆分配 = 0（预算与实测见 [PERFORMANCE.md](./PERFORMANCE.md)） |
| 服务端 | 快照丢弃率 ≤ 0.1%；单实例 100 房（400 连接）压测 10 分钟无超时；单核 ≥ 500 房 |
| 安全 | 越权输入被丢弃并计数；房间码爆破被限流；超大帧被拒 |
| 部署 | 全新 VPS 按手册 30 分钟内上线；回滚一次 ≤ 5 分钟；备份可恢复 |

## 2. 现状与可复用资产

| 层 | 现状 | 行数 | 处理 |
| --- | --- | --- | --- |
| 纯规则 | `src/game/core` + `systems` | 637 + 843 | **移植到 Rust**，逐位对齐数学与随机 |
| AI | `src/game/ai`（含 external） | 581 | 移植到服务端；DeepSeek 外部 AI 保留到 P5 |
| 内容 | `src/content` | 893 | 数据抽 JSON（单一来源）；规则函数随 core 移植 |
| 表现 | `src/presentation` | 3,314 | **原样复用**：0 行推进模拟，只读 `state` 绘制 |
| 驱动 | `ArenaScene` / `MatchRunner` / `FixedStepLoop` | 120 / 77 / 20 | 抽 `MatchSource` 接缝，联机版替换推进方式 |
| 应用/UI/存档 | `src/app`、`src/ui`、`src/storage` | 1,366 | 菜单与 HUD 复用；存档改为服务端档案 + 本地缓存 |
| 测试 | `tests/` | 31 文件 / 269 用例 | 按行为断言移植，作为 Rust 侧的验收基线 |

三个关键事实（决定改造范围）：

1. 规则是**无 I/O、固定步长、种子随机**的，且 `src/game` 不依赖 Phaser/DOM/时钟——可以直接按 tick 驱动。
2. 表现层是**状态驱动**的，`ArenaRenderer.draw(state, alpha, dt)` 不碰模拟；联机版只需换数据源。
3. 驱动逻辑集中在 3 个文件、217 行，远远小于表现层——这是本方案最大的有利条件。

## 3. 总体架构

```
┌──────────────────────────────┐          ┌────────────────────────────────────────┐
│ 浏览器                        │   WSS    │ 云服务器                                  │
│  Phaser 渲染（复用）           │◀────────▶│  Caddy（TLS / 反代 / 压缩 / 日志）          │
│  NetMatchSource              │          │        │                                │
│   ├ 输入采样 60 Hz → 上行      │          │  axum 房间服务（Rust）                     │
│   ├ 快照缓冲 + 插值            │          │   ├ 大厅：建房 / 加入 / 房间码               │
│   └ WASM 预测 + 回滚           │          │   ├ 房间 actor：60 Hz 模拟 / 30 Hz 快照     │
│  DOM 菜单 / HUD（复用）        │          │   ├ 会话：WS 读写 / 限流 / 重连              │
│  localStorage：设备 token      │          │   ├ AI：移植后的 bot                       │
└──────────────────────────────┘          │   └ DeepSeek 网关（可选，P5）                │
                                           │  SQLite（WAL）：档案 / 战绩 / 对局            │
                                           └────────────────────────────────────────┘
```

组件职责：

| 组件 | 职责 | 不做什么 |
| --- | --- | --- |
| Caddy | TLS、HTTP/2、WS 升级、压缩、访问日志 | 不碰游戏状态 |
| 大厅 | 建房/加入/房间码校验/容量准入 | 不推进模拟 |
| 房间 actor | 60 Hz 模拟、输入消费、快照、事件、结算 | 不直接读写磁盘 |
| 会话 | 每连接读写 task、心跳、限流、重连 | 不持有房间状态 |
| 持久化 | 异步批量写 SQLite | 不在 tick 内阻塞 |

## 4. 规则层：唯一权威实现

### 4.1 移植原则（修正 v1 的地基问题）

TS → Rust 的映射保持 `BattleSimulation.step(dt, inputs)` 的形状：`Simulation::step(&mut self, dt: f32, inputs: &InputTable)`。三条硬性规定：

1. **数学库统一**。core 通过 `libm` crate 使用 `sin/cos/powf/hypot` 的纯 Rust 实现，native 与 wasm32 链接同一份代码，逐位一致；禁止直接调 `f32::sin` 这类平台实现。理由与证据见评审 §2.1：`MovementSystem.ts:38` 的 `pow` 衰减、`math.ts:14-22` 与 `CombatSystem.ts:80` 的 `hypot`、`CombatSystem.ts:48-49` 的 `sin/cos` 散布，配合 `MovementSystem.ts:65`、`CombatSystem.ts:22` 这类阈值分支，1 ulp 会被放大成宏观分叉。
2. **随机流逐位复刻**。`Random`（mulberry32）要用 `u32::wrapping_add/wrapping_mul` + `Math.imul` 的 `ToInt32` 语义；`DropSystem` 的三个 `SeededRandom` 与 `BotController` 每决策 2 次抽取、且抽取次数依赖分支顺序，必须照抄。种子超过 2^53 的行为在服务端不出现（种子来自 `u32`），但**移植测试要覆盖边界**。
3. **系统私有状态纳入可序列化状态**。`CombatSystem.nextProjectile`、`GrenadeSystem.nextBomb`、`DropSystem.nextDropIn/nextDropId/initialized/overtimeHandled`、`MatchRunner.playingTick` 现在不在 `MatchState` 里；Rust 侧统一进 `RoomState`，否则回滚重放时 id 与掉落时序会错位。

验收：**黄金回放**。固定 seed + 600 帧输入脚本，TS / Rust native / Rust wasm 三方逐帧位置差 < 1e-3 px，结果字段（生命、淘汰、结算）完全一致。这项测试在 P1 第一天就建起来。

### 4.2 内容：数据与规则分离

- **数据**（地图、武器数值、掉落权重、战役、训练任务、外观预设）导出为 `content/*.json`，带 `schema_version` 与内容哈希；Rust `include_str!` + `serde` 反序列化，编译期校验。
- **规则函数**（`createWeapon`、`weaponBurstImpulse`、`createCustomMatchConfig`、`campaignScore`、`normalizeAppearance`）不是数据，随 core 移植；`src/content` 改读生成的 JSON，禁止再手写常量。
- CI 检查：JSON schema 校验 + 内容哈希写入构建产物；客户端 `Hello` 带上哈希，服务端拒绝不一致的构建。

### 4.3 单机模式的归属（v1 漏掉的问题）

v1 没有回答"战役/训练/本地双人/DeepSeek 怎么办"，这会导致两套规则。本版明确：

- **过渡期 D2**：单机继续跑 TS core，联机跑 Rust core，**以 Rust 为权威**。
- **护栏（必须做，否则 D2 不可接受）**：
  1. 规则参数只从 `content/*.json` 生成，TS 侧用生成文件，禁止手改；
  2. CI 每次改动同时跑 TS 与 Rust 的黄金回放，差异超过阈值直接失败；
  3. 平衡改动必须"改 JSON → 重新生成 → 两边测试通过"才算完成。
- **终态 D1**（P6 决策）：单机也走 WASM，删除 TS core。若 P6 时联机已稳定、WASM 预测可靠，切 D1 的成本约 1 周（换数据源 + 回归 269 用例）；不切则长期维持 D2，并在 `AGENTS.md` 写明"以 Rust 为准"。

### 4.4 客户端接缝

在 `ArenaScene` 与 `MatchRunner` 之间插入数据源接口，场景不再直接 `new MatchRunner`：

```ts
export interface MatchSource {
  readonly state: Readonly<MatchState>;
  readonly alpha: number;
  advance(deltaMs: number): BattleEvent[]; // 联机版返回快照事件，不推进模拟
  pause(): void;
  resume(): void;
}
```

- 单机：`LocalMatchSource` 包装现有 `MatchRunner`，行为零变化。
- 联机：`NetMatchSource` 负责输入上行、快照缓冲、插值、预测与回滚。
- 渲染层要求 `previous/current` 插值（`ArenaRenderer` 等 946 行依赖），快照 DTO 必须保留等价字段；`alpha` 在联机版由插值时间给出。

## 5. 网络模型：延迟从哪来、怎么压

### 5.1 延迟预算（本地区域，RTT 40 ms 为例）

| 环节 | 典型值 | 说明 |
| --- | --- | --- |
| 输入采样 | 0—8 ms | 60 Hz 采样，按键变化立即发送，不做 30 Hz 批处理 |
| 上行 | RTT/2 ≈ 20 ms | 同区；跨省 30—50 ms |
| 服务器排队 | 0—16 ms | 输入抖动缓冲 1 tick，自适应 |
| 模拟 + 快照 | < 1 ms | Rust，房间独立 task |
| 下行 | RTT/2 ≈ 20 ms | 30 Hz 快照，单帧 < 1 KB |
| 本地预测 | **0** | 本地角色按键即动，不等服务器 |
| 远端插值 | 66—133 ms | 只为平滑，远端角色本来就晚于真实时间 |

结论：**本地角色的操作延迟与网络无关**（预测），代价是"我看到的别人"比真实晚一个插值窗口。这是所有服务端权威游戏的共同取舍，不是本作的缺陷。

### 5.2 六项成熟手段（按收益排序）

1. **客户端预测 + 服务器校正**（Valve Source 的 prediction/reconciliation）：本地立即执行输入，收到 `ack` 后回滚重放未确认输入；> 8 px 才平滑，2—8 px 静默修正。
2. **实体插值**：远端角色用 100 ms 缓冲（约 3 个快照）插值，抖动大时自适应拉长到 133 ms。
3. **输入抖动缓冲**：服务端每人保留 1 tick 缓冲，网络抖动大时升到 2 tick；宁可加 16 ms 也不要卡顿。
4. **60 Hz 输入、每 tick 一条**：省掉 30 Hz 批处理的 0—16.7 ms；单条 < 20 B，带宽可忽略。
5. **小帧 + 关闭压缩 + TCP_NODELAY**：快照远小于 MTU，避免 TCP 队头阻塞放大；WebSocket 关闭 `permessage-deflate`（压缩增加延迟且对 1 KB 帧无收益）。
6. **就近部署**：v1 单区域（建议华东或香港，按玩家分布选），不做跨区匹配。

参考：[Valve Prediction](https://developer.valvesoftware.com/wiki/Prediction)、[Overwatch GDC 2017](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)、[Riot：Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode)（其插值延迟 7.8125 ms、peeker's advantage 40—70 ms 的公开数据可作为调参参照）。

### 5.3 弹道与命中：默认不做 rewind

本作所有武器是**弹丸**（弹速 1200、射程 750 等），不是 hitscan。服务端在"消费到该输入的 tick"生成弹丸，客户端本地立即生成预测弹丸；远端目标在往返期间移动，需要玩家自行提前量——这与弹丸类游戏的直觉一致。

- 默认**不做**命中回滚（rewind），避免"打空气却命中"的观感。
- 可选实验（P4 之后）：服务端按射手视角回看 ≤ 150 ms 生成弹丸，只对狙击类生效；作为房间开关，默认关。
- 反作弊边界不变：客户端只发输入，命中判定全在服务端。

### 5.4 实时延迟展示

HUD 常驻（右下角，可关）：

| 字段 | 来源 | 展示 |
| --- | --- | --- |
| RTT | `Ping/Pong` 每 1 s，滑动中位数 | 数值 + 颜色（< 60 绿 / 60—120 黄 / > 120 红） |
| 抖动 | RTT 的滑动标准差 | 数值 |
| 丢包 | 输入 `seq` 缺口 + 快照缺口估算 | 百分比 |
| 服务器 tick | 快照 `tick` 与到达时间 | 仅 F3 |
| 校正次数 | 本地回滚触发计数 | 仅 F3 |

`Ping/Pong` 带双端时间戳，客户端用滑动中位数估时钟偏移，供插值取 `server_time - interp_delay`。

### 5.5 断线、重连与掉线托管

- 连接断开 → 服务端保留槽位 **60 s**，期间角色按最后输入空转（或由 AI 托管，房间开关）。
- 客户端用设备 token 自动重连，带 `last_ack` 请求补发；服务端回 `RoomState` + 下一帧快照即可恢复。
- 60 s 未回 → 槽位释放；对局中则该玩家判负（按现有出界规则扣命），房间继续。
- 房主掉线不影响对局；大厅阶段房主转移给下一位真人。

**房间回收**：一个真人都不在线（只剩 AI，或者建了房没人进）超过 **5 分钟**，房间任务自行退出并从注册表摘除，`gunbrawl_rooms_active` 随之回落。否则「建房 → 加 AI → 关页面」会留下一个永远跑 60 Hz 的黑洞房间。实现见 `room::Room::should_close` / `run_room`，房间任务自己负责反注册（`Lobby::create` 里 spawn 的 wrapper），因此无论因空闲还是发送端全部关闭而结束，房间码都能立刻被复用。


## 6. 协议 v2

传输：WebSocket 二进制帧，`postcard` 编码，单帧上限 4 KB；`Hello` 带协议版本与内容哈希。

### 6.1 消息

```rust
enum C2S {
    Hello { proto: u16, content: u64, token: String, build: String },
    CreateRoom { name: String, appearance: Appearance, config: RoomConfig },
    JoinRoom { code: String, name: String, appearance: Appearance },
    PickSlot { slot: u8, kind: SlotKind, difficulty: Option<Difficulty> },
    Ready { ready: bool },
    Start,
    Rematch,
    Input { frames: Vec<InputFrame> }, // 1—4 帧，seq 单调
    Ping { t: u64 },
    Leave,
}

enum S2C {
    Welcome { player_id: u32, name: String, token_expires: u64, tick_rate: u16, snapshot_rate: u16 },
    RoomState { room: RoomView, version: u32 },
    Snapshot(Box<Snapshot>),
    Pong { t: u64, server_tick: u32 },
    MatchEnd { result: MatchResult },
    Kick { code: u16, message: String },
}
```

### 6.2 输入：保持位与边沿位分开（修正 v1）

```rust
struct InputFrame {
    seq: u32,
    tick_hint: u32, // 仅用于抖动统计，不参与裁决
    move_x: i8,     // -1 / 0 / 1
    held: u8,       // bit0 开火
    edges: u8,      // bit0 跳 / bit1 穿台 / bit2 投弹 / bit3 换弹
}
```

服务端补齐规则（**这是 v1 的 bug 来源**）：

| 情况 | 处理 |
| --- | --- |
| 本 tick 有输入 | 消费一帧；`edges` 只在本 tick 生效一次 |
| 本 tick 无输入 | `move_x`、`held` 沿用上一帧；**`edges` 置 0** |
| 一次收到多帧 | 缓冲，每 tick 消费一帧，最多缓冲 4 帧，超出丢最旧并计数 |
| `seq` 回退或重复 | 丢弃并计数；异常连续 3 次踢下线 |

`jumpPressed` 这类边沿如果按"沿用上一条"补齐，丢包时角色会连跳——v1 草案正是这么写的，本版已改。

### 6.3 快照

```rust
struct Snapshot {
    tick: u32,
    server_ms: u64,
    acks: [u32; 4],            // 每人最后被消费的输入 seq，0 = 无
    actors: Vec<ActorSnap>,    // 4 个，按槽位固定顺序
    projectiles: Vec<ProjSnap>,
    bombs: Vec<BombSnap>,
    drops: Vec<DropSnap>,
    events: Vec<EventSnap>,    // 命中 / 爆炸 / 出界 / 复活 / 阶段，带 tick
}
```

- 位置量化 1/16 px（`i32`，postcard varint 约 2—3 B），速度 1/8 px/s（`i16`）。
- **实测**（P0，criterion）：4 人 + 20 弹丸 + 事件 = **293 B**；编码 0.43 µs、解码 0.61 µs；30 Hz 下 8.8 KB/s，低于 20 KB/s 预算。
- **全量 vs delta**：全量已在预算内，delta 默认不启用（复杂度换不来收益）。若 p95 > 600 B 或带宽 > 20 KB/s，delta 升级为必做项，按"关键帧 + 变化掩码"实现。无论哪种，广播只编码一次、`Bytes` 零拷贝分发。
- 快照不进客户端逻辑判断，只用于渲染与预测校正的权威值。

## 7. 房间、账号与 AI

### 7.1 房间

- 房间码：6 位，字母表 `23456789ABCDEFGHJKMNPQRSTVWXYZ`（去掉 I/L/O/0/1），服务端生成并查重。
- 槽位：4 个，`Empty / Human{player} / Bot{difficulty}`；至少 2 个非空才能开始，至少 1 个真人。
- 房主 = 创建者；可改地图、生命（1—9）、时限（30—600 s）、掉落池；可把空位设为 AI；所有真人准备后开始。
- 状态机：`Lobby → Countdown(3 s) → Playing → Result(30 s) → Lobby(重赛) → Closed`。
- 空房 5 分钟回收；房间码不可复用（避免串房）。
- 联机不暂停：`Esc` = 离开（保留 60 s 重连窗口）；训练/单机仍可暂停。

### 7.2 匿名账号

- 客户端首次打开生成 `device_id`（UUID v4）存 `localStorage`。
- `POST /api/session { device_id, name? }` → 服务端建/取档案，返回 `player_id` + 签名 token（HMAC-SHA256，30 天）+ 默认名（可改）。
- WS `Hello` 带 token；token 失效返回 `Kick{code:401}`，客户端静默续签一次。
- 档案含：名字、外观、累计战绩、最近 20 局；不做密码、邮箱、找回。

### 7.3 AI 补位

- 服务端运行移植后的 `BotController`（三档难度），输入走与真人相同的 `InputTable`。
- 大厅可指定每个 AI 槽位的难度；开局时"补位"策略：空位按房主设置填 AI，未设置则不填。
- 真人中途掉线：可选 30 s 后 AI 接管（房间开关，默认开），回房后交还。

## 8. 服务端实现（Rust）

### 8.1 结构

```
server/
  Cargo.toml            # workspace
  crates/
    core/               # 纯逻辑：state/movement/combat/grenade/drop/life/match；依赖 libm，无 tokio
    content/            # include_str! 读 JSON，编译期校验
    proto/              # serde + postcard 消息
    bot/                # AI 移植
    server/             # axum + tokio：lobby/room/session/persist/metrics
  migrations/           # sqlx 迁移（编译期嵌入）
  Dockerfile
```

依赖保持少：`axum 0.8`（ws）、`tokio`、`serde`、`postcard`、`sqlx`（sqlite，**只用运行期 `query()`，不用宏**，避免编译期连库）、`tracing`、`uuid`、`libm`、`metrics`/`metrics-exporter-prometheus`。

### 8.2 tick 循环

- 每房一个 tokio task；`sleep_until` 绝对 deadline，落后最多补 5 tick（与前端 `FixedStepLoop` 一致），超出则跳帧并计数。
- 顺序固定：收集输入 → `core.step` → 事件入队 → 每 2 tick 广播快照 → 超时/结算检查。
- 快照发送用 `try_send`，队列满丢最旧帧（慢客户端不能拖垮房间）。
- tick 内禁止磁盘 IO、日志刷盘、网络等待；持久化走独立 channel + 批量提交。

### 8.3 并发与背压

- 每个连接一个读 task + 一个写 task，用 mpsc 交汇；每连接 ≤ 120 msg/s，超出丢弃并计数。
- 每房最多 4 个真人 + 4 个 AI；大厅与房间通过房间注册表（`DashMap`）交互，房间状态不出 task。
- 单实例 `MAX_ROOMS` 准入；超出返回 `Kick{code:503}`。

### 8.4 扩容条件（v1 不做）

当单核房间数打满或 tick 延迟 p99 > 5 ms 时：先把房间按 hash 分片到多进程（按房间码路由），再考虑多机。协议不变，客户端无感。

## 9. 数据与持久化

SQLite（WAL），单写 task：

```sql
CREATE TABLE players (
  id INTEGER PRIMARY KEY, token_hash BLOB NOT NULL UNIQUE,
  name TEXT NOT NULL, appearance TEXT NOT NULL,
  created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, map TEXT NOT NULL, mode TEXT NOT NULL,
  started_at INTEGER NOT NULL, ended_at INTEGER, winner INTEGER, stats_json TEXT
);
CREATE TABLE match_players (
  match_id TEXT NOT NULL, player_id INTEGER, slot INTEGER NOT NULL,
  bot INTEGER NOT NULL DEFAULT 0, stocks_left INTEGER, kos INTEGER, falls INTEGER,
  PRIMARY KEY (match_id, slot)
);
CREATE INDEX idx_matches_code ON matches(code);
```

- 迁移用 `sqlx::migrate!`（编译期嵌入，不需要运行期 DATABASE_URL）。
- 写放大控制：对局结束一次性写；`last_seen` 每 5 分钟批量更新。
- 备份：每日 `sqlite3 .backup` 到 `/data/backup`，保留 7 天，异地同步可选。

## 10. 部署（完整）

### 10.1 前置条件（需要你提供）

| 项 | 建议值 | 说明 |
| --- | --- | --- |
| VPS | 2 vCPU / 4 GB / 40 GB SSD，Ubuntu 24.04 | 单区 100—300 房；带宽 5 Mbps 足够 |
| 域名 | `play.example.com` | A/AAAA 记录指向 VPS |
| 防火墙 | 仅开 22 / 80 / 443 | 22 限制来源 IP |
| 仓库 | GitHub（私有即可） | CI 推镜像到 GHCR |
| 密钥 | `GUNBRAWL_SERVER_SECRET`、可选 `DEEPSEEK_API_KEY` | 只放服务器 `.env`（600 权限） |

### 10.2 Dockerfile（多阶段 + 缓存 + 非 root）

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS web
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM rust:1.83-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /src
FROM chef AS planner
COPY server/ .
RUN cargo chef prepare --recipe-path recipe.json
FROM chef AS build
COPY --from=planner /src/recipe.json .
RUN cargo chef cook --release --recipe-path recipe.json
COPY server/ .
RUN cargo build --release --bin gunbrawl-server

FROM debian:bookworm-slim
RUN useradd -r -u 10001 app && mkdir -p /data && chown app /data
COPY --from=build /src/target/release/gunbrawl-server /usr/local/bin/
COPY --from=web /app/dist /srv/web
USER app
ENV GUNBRAWL_WEB_DIR=/srv/web \
    DATABASE_URL=sqlite:///data/gunbrawl.db \
    RUST_LOG=info
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD ["/usr/local/bin/gunbrawl-server", "--health"]
ENTRYPOINT ["/usr/local/bin/gunbrawl-server"]
```

`.dockerignore`（必须有，否则 `COPY . .` 会带上本机 `node_modules` 与 `dist`）：

```
node_modules
dist
dist-weapon-preview
artifacts
.git
docs
*.local
```

注意不要把 `tests/` 排除：`pnpm build` 内含 `tsc --noEmit`，而 `tsconfig.json` 的 `include` 覆盖了 `src`、`tests`、`vite.config.ts`，排除后镜像内构建会失败。

### 10.3 docker-compose（容器内监听 0.0.0.0，宿主机不发布 8080）

```yaml
services:
  app:
    image: ghcr.io/OWNER/gun-brawl:${TAG:-latest}
    restart: unless-stopped
    env_file: [.env]
    volumes: ["data:/data"]
    expose: ["8080"]          # 只给 caddy 网络，不发布到宿主机
    networks: [web]
    healthcheck:
      test: ["CMD", "/usr/local/bin/gunbrawl-server", "--health"]
      interval: 15s
      timeout: 3s
      retries: 3

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    env_file: [.env]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy:/data
      - ./logs:/var/log/caddy
    networks: [web]

volumes: { data: {}, caddy: {} }
networks: { web: {} }
```

v1 草案写"容器内监听 127.0.0.1"又发布 `8080:8080`，在默认 bridge 下必然连不通；上面的写法让 app 只在 compose 网络内可达，由 Caddy 转发，安全性更好。

### 10.4 Caddyfile（自动 TLS + WS）

```
{$DOMAIN} {
    encode zstd gzip
    reverse_proxy app:8080
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }
    log {
        output file /var/log/caddy/access.log
        format json
    }
}
```

Caddy 自动申请/续期证书，`reverse_proxy` 原生支持 WS 升级，不需要额外配置。

### 10.5 静态资源与健康检查

- axum 托管 `/srv/web`，`index.html` 走 SPA fallback，`/assets/*` 长缓存（immutable），`/api/*` 与 `/ws` 走服务。
- `--health` 只检查：进程存活、数据库可打开、能读到自身状态；**不尝试 bind 端口**（会与运行中的服务冲突），也不发起业务请求。

### 10.6 CI/CD（GitHub Actions）

```yaml
name: deploy
on:
  push: { branches: [main] }
  workflow_dispatch: {}

jobs:
  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck && pnpm test && pnpm build

  rust:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with: { components: "rustfmt, clippy" }
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --workspace

  image:
    needs: [web, rust]
    runs-on: ubuntu-latest
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}

  deploy:
    needs: image
    runs-on: ubuntu-latest
    steps:
      - name: Deploy over SSH
        run: |
          ssh -o StrictHostKeyChecking=no deploy@${{ secrets.HOST }} '
            cd /srv/gun-brawl &&
            TAG=${{ github.sha }} docker compose pull app &&
            TAG=${{ github.sha }} docker compose up -d app &&
            sleep 5 &&
            curl -fsS https://${{ secrets.DOMAIN }}/healthz'
```

回滚：把 `TAG` 改成上一个 sha 重跑 deploy，或服务器上 `TAG=old docker compose up -d app`。

### 10.7 监控与告警

`/metrics`（Prometheus 文本格式）暴露：

| 指标 | 类型 | 用途 |
| --- | --- | --- |
| `gunbrawl_rooms_active` | gauge | 容量 |
| `gunbrawl_players_connected` | gauge | 活跃 |
| `gunbrawl_tick_lag_seconds` | histogram | tick 是否跟得上 |
| `gunbrawl_input_buffer_depth` | histogram | 抖动 |
| `gunbrawl_snapshot_bytes` | histogram | 带宽 |
| `gunbrawl_snapshot_dropped_total` | counter | 慢客户端 |
| `gunbrawl_reconcile_total` | counter | 预测校正频率 |
| `gunbrawl_ws_errors_total` | counter | 连接质量 |
| `http_request_duration_seconds` | histogram | API |

告警规则（Prometheus + Alertmanager 或 Uptime Kuma）：

- `histogram_quantile(0.99, sum(rate(gunbrawl_tick_lag_seconds_bucket[5m])) by (le)) > 0.02` 持续 5 分钟；
- `/healthz` 连续 1 分钟失败；
- 磁盘 > 80%；
- 5xx 比例 > 1% 持续 5 分钟；
- 证书到期（Caddy 自动续期，仅监控）。

日志：`tracing` JSON 输出，按天轮转，保留 14 天；访问日志由 Caddy 写文件。

### 10.8 运维手册（首次上线 / 升级 / 回滚 / 备份 / 扩容）

1. **首次上线**：装 Docker → 建 `/srv/gun-brawl` → `docker login ghcr.io`（私有镜像用只读 PAT）→ 放 `compose.yml`、`Caddyfile`、`.env` → `docker compose up -d` → DNS 生效后访问 → `curl /healthz`。
2. **升级**：合并到 main → CI 自动部署 → 观察 tick 延迟与错误率 10 分钟。
3. **回滚**：`TAG=<上一个 sha> docker compose up -d app`，30 秒内完成。
4. **备份**：cron 每日 `sqlite3 /data/gunbrawl.db ".backup /data/backup/$(date +%F).db"`；恢复 = 停服务、替换库、起服务。
5. **密钥轮换**：改 `.env` 的 `GUNBRAWL_SERVER_SECRET` 会让旧 token 失效（预期行为），发公告后重启。
6. **扩容**：先升配（垂直）；房间数持续打满再按 §8.4 分片。

### 10.9 成本

| 项 | 估算 |
| --- | --- |
| VPS 2C4G | $6—12 / 月 |
| 域名 | $10 / 年 |
| 备份存储 | 忽略不计（< 1 GB） |
| DeepSeek（可选） | 按现有网关预算，单局上限已有 |

## 11. 里程碑与工期

| 阶段 | 内容 | 产出 / 验收 | 估时 |
| --- | --- | --- | --- |
| P0 契约 | workspace、proto、libm 决策、内容导出脚本、`MatchSource` 接缝、CI 骨架 | 本地起服务、浏览器握手拿到 `Welcome`；单机模式零回归 | 1 周 |
| P1 规则移植 | core/systems/ai + 269 条行为断言 + 黄金回放 + 热路径零分配 + 核心 bench | TS / native / wasm 三方逐帧一致；Rust 侧测试全绿；4 人 tick p99 与每 tick 分配有基线数字 | 3 周 |
| P2 房间与快照 | 房间 actor、30 Hz 快照、4 人房、房间码、匿名会话、基础房间 UI；快照编码一次、广播零拷贝、慢客户端丢帧 | 2 个浏览器 1v1 可对战，4 槽位与房间码贯通；快照 p95 ≤ 600 B、单客户端 ≤ 20 KB/s | 2 周 |
| P3 完整体验 | AI 补位、重连、离开/暂停语义、结算/重赛、延迟 HUD、F3 面板 | 4 人 + AI 打完整局；断线 60 s 可回 | 2 周 |
| P4 手感 | WASM 预测、回滚重放、插值、抖动缓冲、可调输入延迟 | 模拟 0/40/80/150 ms RTT 下校正 < 0.5 次/秒 | 2—3 周 |
| P5 部署 | Docker、Caddy、CI/CD、监控、备份、压测、故障演练、bench 回归门槛 | 按手册 30 分钟上线；100 房压测通过；bench 回归 > 10% 阻断 | 1.5 周 |
| P6 收尾 | 单机归属决策（D1/D2）、文档、回归 | 全量回归 + 交接文档 | 1 周 |
| **合计** | | | **12—14 周**（单人全职） |

如果把 P4 砍掉先上线（接受 60—80 ms 输入延迟），P0—P3 + 简化 P5 约 **9—10 周**，但"降低延迟"这条决策就落空了——不建议。

## 12. 测试、压测与验收

| 层 | 方法 | 通过标准 |
| --- | --- | --- |
| 规则 | 269 条行为断言移植 + 黄金回放 | 三方逐帧 < 1e-3 px，结果一致 |
| 协议 | postcard round-trip、边界值、超大帧 | 无 panic，超限被拒 |
| 房间 | 4 个 headless bot 客户端跑 200 局 | 无 panic、结算一致、无泄漏 |
| 网络 | `tc netem` 注入 40/80/150 ms、1% 丢包、乱序 | 预测不抖、重连成功、无叠加误差 |
| 压测 | 100 房 × 4 玩家（bot）10 分钟 | tick p99 < 5 ms、CPU < 70%、无丢帧 |
| 部署 | 全新 VPS 按手册走一遍；回滚演练 | 30 分钟上线、5 分钟回滚 |

## 13. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 双实现漂移（D2） | 单机联机手感不一致 | 内容单一 JSON + 黄金回放 CI + 冻结窗口；P6 评估 D1 |
| native/WASM 数学不一致 | 预测频繁校正 | 统一 `libm`；P1 第一天做三方对比 |
| 移植后手感变化 | 老玩家不适应 | 黄金回放 + 参数冻结；P4 前不替换单机 |
| TCP 队头阻塞 | 丢包时卡顿 | 小帧、30 Hz、关压缩；保留 WebTransport 升级口 |
| SQLite 单写 | 对局写入阻塞 tick | 独立写 task + 批量提交；只在对局结束写 |
| 部署事故 | 上线/回滚失败 | 镜像不可变 + compose 版本化 + 健康检查 + 回滚手册 |
| 工期 | 12—14 周 | 阶段验收；P4 可独立延期而不阻塞 P2/P3 |

## 14. 附录

### A. 与 v1 的差异

| 项 | v1 | v2 |
| --- | --- | --- |
| 玩法 | 未定（1v1 或 4 人） | 4 人房 + 自建 + AI 补位 |
| 输入 | 30 Hz 批处理、缺失沿用 | 60 Hz、保持位/边沿位分离 |
| 数学 | "不需要位级一致" | 统一 `libm`，三方黄金回放 |
| 单机 | 未定义 | D2 过渡 + 护栏，P6 决策 D1 |
| 内容 | 导出 JSON | 数据/规则分离，JSON 为单一来源 |
| 部署 | 单容器草案 | 反代 + TLS + CI/CD + 监控 + 备份 + 手册 |
| 延迟 | 目标值 | 预算表 + 六项手段 + HUD 展示 |
| 工期 | 6—8 周 | 12—14 周（含 AI、4 人、完整部署） |

### B. 参考

- [Valve：Prediction](https://developer.valvesoftware.com/wiki/Prediction)
- [Overwatch Gameplay Architecture and Netcode（GDC 2017）](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)
- [Riot：Peeking into VALORANT's Netcode](https://www.riotgames.com/en/news/peeking-valorants-netcode)
- [VALORANT：Peeker's Advantage 与插值延迟](https://playvalorant.com/en-gb/news/game-updates/04-on-peeker-s-advantage-ranked/)

### C. 开始前需要你提供

1. 域名（或同意用临时 `sslip.io` 之类做联调）。
2. VPS 的 SSH 访问方式与地区偏好（决定目标延迟）。
3. GitHub 仓库地址（CI 推镜像用）。
4. 是否保留 DeepSeek 对战（默认保留，排到 P5）。

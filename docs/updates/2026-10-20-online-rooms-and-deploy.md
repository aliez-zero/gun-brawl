# 2026-10-20 联机版：房间、快照、AI 与部署

## 一句话

Rust 服务端已经能跑完整对局：房间码建房/加入、4 槽位、AI 补位、60 Hz 权威模拟、30 Hz 快照、客户端快照渲染与延迟显示；Web 端已实际跑通两个浏览器的建房/加入/开始。部署产物（镜像、compose、Caddy、CI 发布）已补齐，本机无 Docker，未做镜像构建验证。

## 本次交付

### 规则核心（P1，提交 `456b3e7`）

- `server/crates/core`：常量、`libm` 数学、mulberry32/LCG、移动、战斗/换弹、弹道、爆炸、炸弹、掉落、生命、胜负。
- `server/crates/content`：从 `web/src/content` 导出的 JSON（地图/武器/投放），编译期嵌入；平台与武器用索引。
- 黄金回放：`GOLDEN=1 pnpm vitest run tests/tools/golden.test.ts` 生成 600 帧夹具；`cargo test -p gunbrawl-content --test golden` 逐帧对比位置/生命/状态/弹丸数，误差 < 1e-3 px。

### 房间与协议（P2，提交 `19b7e56`）

- 协议 v2：`RoomView`、槽位、`Snapshot`（actors / projectiles / bombs / drops / events）、`MatchEnd`。
- 房间 actor：60 Hz `tokio::time::interval`（Skip），输入队列每 tick 消费一条，缺失时沿用保持位并清空边沿位。
- 大厅：6 位房间码（去掉易混字符）、创建/加入、房主开始/重赛。
- 集成测试：两个 WebSocket 客户端建房、加入、开始，输入 seq 被 ack。

### 客户端（提交 `21c3c50`）

- `web/src/net/postcard.ts`：最小 postcard 编解码。**坑**：`i8` 是单字节补码，不是 zigzag；其余整数是 varint/zigzag。
- `NetClient`：握手、房间命令、1 秒 ping、RTT/抖动中位数。
- `NetMatchSource`：把快照映射成现有渲染器的 `MatchState`，用 `previous/current` 做插值；本地输入 60 Hz 上行。
- UI：主菜单「联机对战」→ 建房/加入/槽位/准备/开始；HUD 显示 `PING · JITTER`。
- `pnpm test:online`：两个浏览器上下文跑通建房 → 加入 → 开始 → HUD → 延迟显示（截图在 `web/artifacts/online-host.png`）。

### AI（P3，提交 `dbb2d6d`）

- `server/crates/bot`：平台图 BFS（walk/jump/drop）、最近平台、三档难度（反应/追击距离/射程/投弹概率）。
- 行为：卡死重规划、边缘自救、炸弹规避、抢箱、跨平台路线、登高。
- 验证：房间测试里把 1 号位设为 AI，倒计时结束后 AI 位置发生位移。

### 部署（P5）

- `Dockerfile`（web 构建 + cargo-chef + debian-slim 运行，非 root，healthcheck）。
- `Dockerfile.gateway` 与 `server/ai/standalone.mjs`：把 DeepSeek 的 Vite 中间件包成独立边车，Caddy 代理 `/api/deepseek/*`；本机实测 `/status` 返回 200。
- `docker-compose.yml`（app / gateway / caddy）、`Caddyfile`（自动 TLS、HSTS、WS 透传）、`.env.example`。
- CI：web + rust 测试，GHCR 双镜像推送，`main` 通过 SSH 部署并 curl `/healthz`。
- 手册：[DEPLOY.md](../DEPLOY.md)。

## 验证记录

| 项 | 结果 |
| --- | --- |
| `cargo test --workspace` | 17 项通过（含黄金回放、房间双客户端、AI 位移） |
| `cargo clippy -D warnings` / `fmt --check` | 通过 |
| `pnpm typecheck` / `vitest` | 通过；270 用例 + 2 个工具用例（默认跳过） |
| `pnpm test:online` | 通过：房间码、4 槽位、开始、HUD、`PING 1ms` |
| 快照 | 338 B（4 人 + 20 弹丸 + 炸弹/掉落/事件），编码 ~0.40 µs |
| Docker 构建 | **未验证**（本机无 Docker），由 CI 首次构建确认 |

## 已知限制

1. 没有客户端预测：本地角色要等服务器确认，感觉相当于 `RTT/2 + 33 ms`；P4 计划用 WASM 回滚重放。
2. 断线重连/匿名 token 尚未落到协议（当前 `Hello` 的 token 未使用）；房间在所有人离开后仍留在注册表。
3. 持久化未接（SQLite 表结构在 v2 §9，尚未创建）；战绩仍是本地存档。
4. 观战、跨区匹配、房间列表未做（不在 v2 范围）。

## 下一步

1. P4：WASM 预测 + 回滚（先做本地角色，远端保持插值）。
2. 重连与房间回收。
3. SQLite 对局结果与匿名档案。
4. 性能门槛接入 CI（bench 回归、压测脚本）。

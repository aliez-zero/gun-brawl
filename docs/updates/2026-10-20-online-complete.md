# 2026-10-20 联机版完成交接（P4 / P5 收尾）

## 状态

v2 方案的 P1—P5 已全部落地：规则核心、房间与快照、大厅/房间码/AI/重连、WASM 预测、部署与监控。全部测试与浏览器冒烟通过；Docker 镜像未在本机构建（无 Docker），由 CI 首次构建验证。

## 本轮新增（相对 `2026-10-20-online-rooms-and-deploy.md`）

### P4 客户端预测

- `server/crates/predict`：把同一份移动核心编译成 wasm32（218 KB），裸 ABI：地图索引/名称、创建、单步、读位姿、校正。
- `web/public/predict.wasm` + `Predictor.ts`：本地角色按键立即移动；快照到达后误差 > 24 px 或状态变化才拉回。
- `NetMatchSource` 只在 `playing` 阶段推进预测，其余阶段仍以快照为准。
- 重建命令：`pnpm build:wasm`（需要 `rustup target add wasm32-unknown-unknown`）。
- 测试：Node 侧的 wasm ABI 测试（位移、校正）；浏览器冒烟断言 `predictor ready`。

### 匿名身份与重连

- 服务端按设备 token 保存 `player_id`、昵称和房间，保留 60 秒。
- `Hello` 命中 token 时自动 `Resume`：重发房间状态 + 最后一帧快照，槽位不变。
- 断线不立刻释放槽位；60 秒后由房间 tick 清理。
- 客户端断线后 0.8/1.6/3.2/6.4/12.8 秒退避重连，最多 5 次；浏览器冒烟强制断开 socket 并验证恢复。

### 持久化

- SQLite（`GUNBRAWL_DB`，默认 `gunbrawl.db`），`matches` + `match_players` 两张表。
- 对局结束通过 channel 交给 writer task，绝不在 tick 内写盘；数据库不可用时只告警。
- 单测覆盖建库、插入与查询。

### 监控

- `/metrics`（Prometheus 文本）：`rooms_active`、`rooms_created_total`、`players_connected`、`matches_finished_total`、`snapshots_sent_total`、`simulation_ticks_total`。
- HTTP 测试覆盖 `/healthz` 与 `/metrics`。

## 验证记录

| 项 | 结果 |
| --- | --- |
| `cargo fmt --check` / `clippy -D warnings` | 通过 |
| `cargo test --workspace` | 16 组测试全部通过（含黄金回放、房间三例、预测、持久化、HTTP） |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 271 通过 + 3 个工具用例（默认跳过） |
| `pnpm test:online` | 通过：建房→加入→开始→HUD→延迟→断线重连→指标 |
| wasm | 218 KB，Node ABI 测试通过 |
| 部署 | 文件齐备；本机无 Docker，镜像构建留给 CI |

## 仍未做（明确边界）

1. Docker 镜像未在本机构建，CI 首次运行前不能算"已验证部署"。
2. 房间注册表没有全局回收：所有人离开后房间对象仍存活（无玩家、空转）。计划用空闲超时清理，当前不影响对局。
3. 断线重连只在同一进程内有效；服务端重启后房间丢失（客户端会停在无快照状态，需要手动返回菜单）。
4. 观战、匹配列表、跨区、账号体系不在 v2 范围。
5. 预测只覆盖本地移动，不含本地射击/弹丸，远端仍为 100 ms 插值。

## 下一步建议

- 房间空闲回收 + 服务端重启后的客户端提示。
- 预测扩展到开火/弹丸（需要把武器状态纳入预测）。
- CI 首次跑通镜像后再补一次真实部署演练。

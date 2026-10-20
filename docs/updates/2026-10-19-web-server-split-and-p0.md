# 2026-10-19 前后端目录拆分与 P0 骨架

## 结论

- 前端全部移到 `web/`，后端在 `server/`；根目录只保留 `docs/`、`AGENTS.md`、`README.md`、`.gitignore` 与 `.github/`。
- Rust workspace 可构建、可测试；WebSocket 握手在本机 `127.0.0.1:8080` 实测通过。
- P0 还差三件：内容导出脚本、客户端 net 模块、`ArenaScene` 接线。

## 目录变化

| 之前 | 之后 |
| --- | --- |
| `src/`、`tests/`、`scripts/`、`public/`、`index.html`、`vite.config.ts`、`tsconfig.json`、`package.json`、`pnpm-*`、`.env*`、`node_modules/`、`dist/`、`artifacts/` | 全部在 `web/` 下，相对路径不变 |
| `server/ai/*.mjs`（Vite 的 DeepSeek 网关） | 原地保留，后续 P5 迁入 Rust |
| — | 新增 `server/Cargo.toml`、`server/crates/{proto,core,server}`、`server/rust-toolchain.toml` |
| — | 新增 `.github/workflows/ci.yml` |
| — | 新增 `web/src/net/MatchSource.ts`（数据源接缝，尚未接线） |

跨目录引用只改了三处：`web/vite.config.ts` 与两个测试文件对 `server/ai/*.mjs` 的 import。

## 验证

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit`（web） | 通过 |
| `vite build`（web） | 通过，产物写入 `web/dist` |
| `vitest run`（web） | **270 / 270** |
| `cargo fmt --check` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo test --workspace` | 12 项通过（proto 2、core 6、server 4） |
| `/healthz` | `200 ok` |
| `GET /` | `200`，返回 `web/dist/index.html` |
| WS 握手 | 发送 `Hello{proto:1}`（`00 01 00 00 00`）→ 收到 13 字节 `Welcome`：`00 01 07 e7 8e a9 e5 ae b6 31 00 3c 1e`（player 1 / 玩家1 / 60 tick / 30 snapshot） |

### 并发会话与合并

拆分完成后（约 23:12），另一个会话在旧路径 `D:\Code\gun-brawl\src`、`tests` 下继续写入，23:15—23:31 重建了根目录的旧结构，并把 `vite.config.ts` 改回 `./server/ai`。这会造成两份副本。

处理方式：

1. 对比两棵树：文件集合一致（`web/` 仅多出新增的 `src/net/MatchSource.ts`），内容不同的只有 5 个文件，且都是根目录更新（`ExternalInputController.ts`、`DeepSeekSetup.ts`、`external-ai.test.ts`、`deepseek-gateway.test.ts`、`model-context.test.ts`）；
2. 把这 5 个文件合并进 `web/`，并重新把两个测试里的 `../server/ai` 改成 `../../server/ai`；
3. 合并后 `tsc`、`vitest`（270/270）与 `vite build` 全部通过——之前 7 个失败也随对方 23:31 的修复一起消失；
4. 根目录重复副本已备份到 `D:\Code\.backup\gun-brawl-root-dupes-20261019` 后删除。

**如果那个会话仍在运行**，它可能再次在根目录重建 `src/` 等路径；请让它重启或把工作目录切到 `web/`（`AGENTS.md` 顶部已写明）。

## 性能（本轮新增）

- 新增 [PERFORMANCE.md](../PERFORMANCE.md)：预算、分层手段、度量与门槛；v2 的 §1.3 验收、§6.3 快照结论、§11 里程碑已同步。
- 协议层实测（criterion，release，MinGW-w64）：
  - 4 人 + 20 弹丸 + 事件的快照 **293 B**（预算 600 B）；
  - `encode_into` 复用缓冲 **0.36 µs**、decode **0.56 µs**；
  - 30 Hz 下 8.8 KB/s（预算 20 KB/s）。
- 已落地：量化字段（1/16 px、1/8 px/s）、`encode_into` 零增长缓冲、服务端发送改用 `Bytes` 复用缓冲；单测断言热缓冲容量不变。
- 结论：全量快照在预算内，delta **不默认启用**，但写死升级条件（p95 > 600 B 或单客户端 > 20 KB/s 时必做）。
- 已知热点：`MatchRunner.advance` 每 tick `new Map<string, ActorInput>()`；列入 P1（与 external-ai 分支协调后改为预分配输入表）。
- CI：`cargo bench --no-run` 保证 bench 可编译；P5 增加 bench 回归 > 10% 阻断。

## 工具链

- Rust 1.99.1，host `x86_64-pc-windows-gnu`，链接器用 `D:\Mingw64\bin`（MinGW-w64 8.1）。
- `rustup` 安装在 `%USERPROFILE%\.cargo`，未修改 PATH；构建时临时加：
  `$env:PATH = "$env:USERPROFILE\.cargo\bin;D:\Mingw64\bin;$env:PATH"`
- CI 用 `dtolnay/rust-toolchain@stable`（Linux gnu），与本地一致。

## 运行

```powershell
# 前端
cd D:\Code\gun-brawl\web
pnpm dev

# 后端（另一个终端）
cd D:\Code\gun-brawl\server
$env:GUNBRAWL_ADDR = "127.0.0.1:8080"
$env:GUNBRAWL_WEB_DIR = "D:\Code\gun-brawl\web\dist"
$env:RUST_LOG = "info"
cargo run -p gunbrawl-server
```

## 风险与待办

1. **并发会话**：`web/src/game/ai/external/**`、`web/src/game/core/MatchRunner.ts`、`web/src/game/systems/MovementSystem.ts`、`web/tests/external-ai.test.ts` 是对方未完成的改动（已合并进 `web/`，调试输出已清理，270 项测试通过）。不要整文件覆盖，也不要在根目录复活旧副本。
2. **Git**：拆分尚未提交（`git status` 显示旧路径删除 + `web/` 未跟踪）。确认无误后 `git add -A` 会让 Git 识别为重命名，而不是删除加新增。
3. **备份**：拆分前快照 `D:\Code\.backup\gun-brawl-pre-split-20261019`（含 `.git`）；根目录重复副本 `D:\Code\.backup\gun-brawl-root-dupes-20261019`（含对方 23:31 的版本）。
4. P0 剩余：内容导出脚本、客户端 net 模块、`ArenaScene` 接线（等 external-ai 分支落地，避免冲突）。

## 下一步

P1 的第一件事按 v2 §4.1：先移植 `MovementSystem` + `math` + `Random`，用同一份输入序列跑 600 帧，对比 TS / Rust native / Rust wasm 的逐帧位置差，通过后再移植其余系统。

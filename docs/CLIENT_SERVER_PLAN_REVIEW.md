# 评审：把 gun-brawl 改成 Client-Server 的方案

- 评审对象：[CLIENT_SERVER_PLAN.md](./CLIENT_SERVER_PLAN.md)（2026-10-19，Rust 服务端 + WASM 预测 + Docker）
- 后续：本文的 P0 问题已在 [CLIENT_SERVER_PLAN_V2.md](./CLIENT_SERVER_PLAN_V2.md) 中修正（Rust 路线确认，4 人房 + AI + 完整部署）
- 评审日期：2026-10-19（北京时间）
- 评审依据：实际源码与测试（`src/game` 2,061 行 / 31 个测试文件 269 个用例 / `src/presentation` 3,314 行）、`AGENTS.md` 架构约束、`PRD.md` F09、`ARCHITECTURE.md` 网络对战条目
- 本文只评价方案与拆解，不含实现；所有"属实 / 不属实"都附了文件与行号

## 0. 结论

**方向和分层是对的，事实核对基本准确；但有 6 项必须先处理（其中 3 项是硬伤）、1 个漏掉的战略选项，以及被低估约 40% 的工期。**

1. **硬伤：地基论证有漏洞**（§2.1）。"规则只写一遍，编译成两处，所以不存在一致性漂移"——服务端是 native，客户端预测是 WASM，两者调用的是**两套数学库**。可以修，成本很低，但文档现在的说法会让人以为不用管。
2. **硬伤：协议会制造自动连跳**（§2.2）。"输入缺失则沿用上一条"对**边沿输入**（跳跃 / 投弹 / 换弹）是错的。
3. **硬伤：Docker 按文档写法连不上**（§2.3）。"容器只监听 127.0.0.1"与 `ports: 8080:8080` 互相矛盾。
4. **结构缺口：单机模式没有归属**（§2.4）。战役 6 关、训练、本地双人、DeepSeek、自定义对局全部建在 TS core 上；联机走 Rust、单机留 TS，从 P2 开始就是**两套规则**——正是方案要消灭的东西。
5. **结构缺口：内容不是纯数据，客户端也缺一个数据源接缝**（§2.5、§2.6）。JSON 化只覆盖常量，规则函数仍需迁移；`ArenaScene.update()` 把输入、推进、事件、绘制、HUD 揉在一起，方案没指出从哪里切开。
6. **战略：Rust 没有被论证**（§5）。实测这套逻辑在 Node 上单核能跑 **800+ 个 4 人房**，而 Node 服务端可以直接复用现有 `src/game`（0 行重写、269 个测试直接可用），联机 MVP 约 2—3 周；Rust 路线是 4—6 周。

如果只按优先级修，先修 §2.2（协议 bug）和 §2.4（单机归属），再决定 §5 要不要换路线；§2.1、§2.3、§2.5、§2.6 都是低成本或一次性的改动。

## 1. 核对结果

| 方案中的说法 | 核对 | 证据 |
| --- | --- | --- |
| 269 项测试 | **属实**。31 个文件、269 个用例，实跑全通过 | `vitest run` 2026-10-19 22:43；928 个 `expect` |
| core 587 / systems 779 / ai 518 行 | 口径是"非空行"。含空行实际 **637 / 843 / 581 = 2,061 行** | 逐文件统计；文档总量偏低约 9% |
| presentation 3,128 行 | 实际 29 个文件 **3,314 行**；其中 **0 行**调用 `step/advance` | `ArenaRenderer` / `WeaponLayer` / `FieldLayer` 只读状态绘制 |
| `BattleSimulation.step(dt, inputs)` 无副作用、无 I/O | 基本属实 | `BattleSimulation.ts:56`，`ReadonlyMap<string, ActorInput>`，事件走 `drainEvents()` |
| 固定 60 Hz、最多补 5 帧 | **属实** | `constants.ts:1`；`FixedStepLoop.ts:10` |
| `Random` 是 mulberry32、同种子可复现 | **属实** | `Random.ts:1-9`（`0x6d2b79f5`）；`src/game` 内无 `Math.random` / 时钟调用 |
| 核心是"纯函数式状态机" | **措辞不准**。是可变的命令式状态机，且系统持有私有计数器 | `CombatSystem.nextProjectile`、`DropSystem.nextDropIn` / 三个 `SeededRandom`、`MatchRunner.playingTick` 都不在 `MatchState` 里 |
| 客户端即权威，`GameApplication` 直接持有 `MatchRunner` 并驱动 rAF | **结论对，细节错**。`GameApplication` 只持有 `ArenaScene`，`MatchRunner` 在场景里；rAF 由 Phaser 内部驱动 | `GameApplication.ts:88-116`、`ArenaScene.ts:63,99-119` |
| 没有网络层；DeepSeek 网关是 Vite 中间件 | **属实**。网关是 dev/preview 中间件，会话在内存，同源 + localhost 校验 | `vite.config.ts:14-26`、`server/ai/deepseek.mjs` |
| 表现层"改成渲染快照"即可复用 | **成立，且比文档说的更乐观**：97.6% 的表现层代码不推进模拟 | 驱动代码只在 `ArenaScene` 120 行、`MatchRunner` 77 行、`FixedStepLoop` 20 行 |

## 2. 必须修的问题（P0）

### 2.1 "同一份 Rust 代码两个编译目标"不等于同一套数学

方案 §2 说"前后端共同完成游戏逻辑不是靠两份代码对齐，而是同一份 Rust 代码的两个编译目标"，并据此认为不需要位级一致。**这句话只对了一半**：

- 服务端：`x86_64-unknown-linux-gnu`，`f32::sin/cos/powf` 走 glibc 的 `sinf/cosf/powf`；
- 客户端：`wasm32-unknown-unknown` 没有系统 libm，std 链接 Rust 自带的 libm 实现。

同一份源码，两个目标，**两个数学库**。而本作的模拟每帧都在用它们：

- `MovementSystem.ts:38` `Math.pow(0.5, dt / impulseHalfLife)`
- `math.ts:14-22`（击退上限归一化）与 `CombatSystem.ts:80` 的 `Math.hypot`
- `CombatSystem.ts:48-49` 用 `sin/cos` 生成弹道散布

后果不是"差 1 ulp 无所谓"：真正危险的是**阈值分支**——`MovementSystem.ts:65`（`old.y <= platform.y + 0.01` 判定落地）、`CombatSystem.ts:22`（`fireCooldown > 1e-8`）、`math.ts:32`（`Math.abs(delta) < 1e-9`）。一次翻转就是"落地 / 没落地""这一枪算不算命中"的宏观分叉，随后 8 px 阈值被持续触发，表现为**网络越好越橡皮筋**。

修法（选 A 更省事）：

- **A. 统一数学库**：`core` 显式依赖 `libm` crate，所有超越函数走 `libm::sinf` 等；native 与 wasm 逐位一致，同时也让 native 在不同 glibc / 不同机器上一致。加一条 golden test：固定 600 帧输入序列，native 与 wasm 的逐帧状态哈希必须相等。
- **B. 接受漂移**：预测只跑"本地角色 + 静态地形"，不预测弹丸 / 他人交互；把 8 px 阈值改成与实测误差匹配，并把"每分钟校正次数"列为验收指标。

无论选哪个，§2 里"不需要跨语言位级一致"必须改写——它现在是整篇方案的地基，而地基上有一条缝。

### 2.2 边沿输入不能用"缺失沿用上一条"补齐

§3.2 的 tick 循环写"每人每 tick 一条，缺失则沿用上一条"，§3.1 的 `buttons: u8` 把跳、穿台、开火、换弹、投弹压在一个位域里。

但 `ActorInput` 里 `jumpPressed / dropPressed / bombPressed / reloadPressed` 是**按下沿**，不是按住状态（`types.ts:49-58`；`EXTERNAL_AI.md:152` 已经写明"同一命令只在第一个有效逻辑步输出一次"）。30 Hz 输入 + 丢包/抖动时"沿用上一条"，等于把一个按下沿重复喂给 60 Hz 模拟：**丢包时角色自动连跳、连续投弹**。

必须区分两类位：

| 类型 | 字段 | 缺失时 |
| --- | --- | --- |
| 保持位 | `moveX`、`shootHeld` | 可沿用 |
| 边沿位 | `jumpPressed`、`dropPressed`、`bombPressed`、`reloadPressed` | **必须清零**，或带 `edge_seq` 由服务端"消费一次" |

另外要定义：客户端一个 16.6 ms 帧内按了两次跳，合并成一次（核心只认一个 bool）。

### 2.3 Docker 有三处会直接卡住

1. **监听地址与端口映射冲突**。§6.2 说"容器内只监听 127.0.0.1:8080 更安全"，同时 `ports: ["8080:8080"]`。Docker 默认 bridge 下，端口发布是把流量打到容器 eth0，监听 loopback 的进程收不到。二选一：容器监听 `0.0.0.0:8080`、宿主侧写 `127.0.0.1:8080:8080`（只给本机反代）；或 `network_mode: host`（仅 Linux）。
2. **`sqlx` 宏的编译期 `DATABASE_URL`**。如果按常规写法用 `sqlx::query!` / `query_as!`，宏在**编译期**需要连库或 `.sqlx` 离线元数据；Dockerfile 只在运行期设了 `DATABASE_URL`，`cargo build` 会失败。要么全用运行期 `sqlx::query()`，要么构建阶段 `cargo sqlx prepare` 并提交 `.sqlx/`。
3. **缺 `.dockerignore`**。`COPY . .` 会把本机 `node_modules/`（含平台相关二进制）和 `dist/` 带进构建上下文，构建变慢且可能污染安装。

另外 `HEALTHCHECK` 的 `--health` 子命令如果实现成"连自己的 HTTP 端口"，在服务未就绪时会误判；建议只检查进程存活 + 数据库可打开。

### 2.4 单机模式没有归属，会造成方案自己反对的"两套规则"

方案说"前端不再保留第二套 TS 模拟（迁移期可临时保留，作为本地练习的降级路径）"。但现状是这些模式**全部**建立在 TS core 上：

- 战役 6 关（`createCampaignConfig`，`campaign.ts:69`）
- 训练 6 任务 + 17 型号图鉴（`src/game/systems/TrainingSystem.ts`、`content/tutorial.ts`）
- 本地双人（`local-duel`）
- DeepSeek 对战（`createDeepSeekMatchConfig`，`matches.ts:207`）
- 自定义 2—4 人对局（`matches.ts:135`）

而服务端只覆盖"房间对战"。如果联机走 Rust、单机留 TS，从 P2 起就是**两套规则**：一次击退参数调整、一次武器平衡都要改两遍，没有任何测试能保证两者一致——这正是文档要消灭的东西。

必须在 P0 先定（建议写进 §8）：

| 选项 | 内容 | 代价 |
| --- | --- | --- |
| D1 全量 Rust/WASM | 删掉 TS core，单机也加载 WASM | 单机模式回归测试重做；静态站点多一个 wasm 包（约 100—300 KB） |
| D2 双实现 | 单机 TS、联机 Rust，明确"谁是权威" | 长期两套规则；需要 CI 比对参数 |
| D3 单机也走本地服务端 | 只有一个实现 | 破坏现在"静态站点打开即玩"的交付方式 |

建议：**终态 D1，过渡期 D2 且书面写清以 Rust 为准**；D3 只适合内部测试。

### 2.5 内容不是纯数据，JSON 化会丢东西

§4.2 的计划是"把 `content` 导出成 JSON，Rust 用 `include_str!` 读"。但 `src/content` 里除了常量还有**规则函数**：

- `weapons.ts:250-267` `weaponMuzzle / weaponBurstImpulse / weaponSustainedImpulse`
- `weapons.ts:298` `createWeapon`、`matches.ts:135,183` `createCustomMatchConfig / createMatchConfig`
- `appearances.ts:47` `normalizeAppearance`、`campaign.ts:62` `campaignScore`
- `tutorial.ts:18` `createTrainingState`

这些决定"开局给什么枪、掉落池怎么算、战役分数怎么算、旧存档怎么校验"。JSON 只覆盖常量，函数要么搬进 Rust core（工作量要单列），要么在 JSON 里变成规则表（掉落权重、初始武器、模式配置、分数公式）。否则"同一份内容"会在**语义**上分叉，比数值漂移更难查。

建议：明确"内容 = 数据 + 规则脚本"，把规则函数列进 core 移植清单；现在的 §4.1 只映射了 `weaponBurstImpulse` 一行，明显不够。

### 2.6 客户端缺一个"数据源"接缝

`ArenaScene.update()` 一个函数干了 5 件事：采样键盘、推进模拟、处理事件、绘制、回调 HUD（`ArenaScene.ts:99-119`）。联机版只需要换掉"推进模拟"这一件，其余 4 件原样保留。

方案说"前端改成渲染快照"，但没指出接缝在哪。建议 P0 就抽：

```ts
interface MatchSource {
  readonly state: Readonly<MatchState>;
  readonly alpha: number;
  advance(deltaMs: number): BattleEvent[];  // 本地 = MatchRunner；联机 = 空实现，靠快照更新
  pause(): void;
  resume(): void;
}
```

好消息是渲染层已经是纯状态驱动（`ArenaRenderer.draw(state, alpha, dt)`），这块几乎不用改；坏消息是 `ArenaRenderer` / `WeaponLayer` / `FieldLayer` 共 946 行依赖 `previous/current` 做插值（`ArenaRenderer.ts:137-158`），快照 DTO 必须保留等价字段，否则每个绘制文件都要改。

## 3. 缺失的设计（P1）

| # | 缺口 | 为什么重要 | 建议 |
| --- | --- | --- | --- |
| 1 | 重连 / 断线 | `ServerMsg` 里没有 `Resume`，§5 提到"重连"但协议没有 | `Resume { token, room, last_ack }`，掉线 30 s 内可回房 |
| 2 | 慢客户端背压 | 快照队列无限积压会吃光内存 | 每连接队列上限 + 丢旧帧（`try_send`） |
| 3 | 房间生命周期 | ready → countdown → playing → result → rematch；暂停怎么办 | 单客户端不能暂停 tick；暂停只在全员同意时生效 |
| 4 | 预测范围 | 掉落的 RNG 消耗顺序一分叉，整局漂移 | 只预测本地角色移动/开火；掉落、炸弹、他人命中一律以快照为准 |
| 5 | 时钟同步 | 100 ms 插值缓冲需要 RTT 与抖动估计 | `Ping/Pong` 带双端时间戳，滑动中位数估 RTT |
| 6 | WASM ABI | 60 Hz 跨 JS/WASM 边界，别每帧序列化对象 | 输入/状态用扁平 `Float32Array`，一次调用推进一步 |
| 7 | 身份与存档 | 现有存档是单键 `gun-brawl:save:v1`（schema 已到 v2），联机后谁权威 | 匿名设备 token → 服务端档案；本地存档降级为离线缓存 |
| 8 | 网络测试工具 | P5 的"100 房压测"没有 bot 客户端就是空头支票 | 先写多 bot 客户端（可复用 AI），断言收敛与 desync 计数 |
| 9 | 观测性 | 出问题时无法定位是延迟、丢包还是规则 bug | 每房 tick 延迟、输入缓冲深度、快照丢弃、校正次数 |
| 10 | 版本与内容哈希 | 地图/武器不一致会打出"幽灵伤害" | `Hello` 除协议版本外带内容哈希 |
| 11 | 反作弊下限 | 房间码可暴力枚举 | Origin 校验、单连接消息上限、每 IP 连接数、房间码尝试限流 |
| 12 | 迁移期开关 | `AGENTS.md` 明令"未完成的功能不添加可点击的假入口" | 联机入口用构建/运行开关控制，P2 通过验收再打开 |

## 4. 规模与工期（含实测）

在本机用现有代码跑了一个临时基准（4 人：1 人 + 3 个 AI，跑 `MatchRunner.advance`，测完已删除脚本）：

| 场景 | 单步耗时 | 折算 |
| --- | --- | --- |
| `MatchRunner.advance`（4 人，含 3 个 AI） | **0.0192 ms** | 约 52,000 步/秒 ≈ **867 房/核**（60 Hz） |
| `BattleSimulation.step`（4 人，全 idle） | 0.0066 ms | 约 2,500 房/核（乐观上限） |

实战弹丸、掉落更多，按 2—3 倍余量算仍是**数百房/核**。也就是说文档 §6.2 "数十到数百房/核"成立，而且偏保守；单进程多房间在 v1 完全不是瓶颈。

工期校准：

| 阶段 | 文档 | 本评审 | 主要偏差原因 |
| --- | --- | --- | --- |
| P0 | 1—2 天 | 1—2 天 | — |
| P1 | 1.5—2 周 | **2—3 周** | 2,061 行逻辑 + 269 个行为断言 + 轨迹对齐；RNG 的 `ToInt32/ToUint32` 语义、AI 的随机消耗顺序要逐分支核对 |
| P2 | 1—1.5 周 | **2—3 周** | `ArenaScene`/`GameApplication` 解耦、快照插值、房间 actor、断线 |
| P3 | 1—1.5 周 | 1.5—2 周 | AI 移植 + 掉落/炸弹/RNG 顺序对齐 |
| P4 | 1—2 周 | **2—3 周** | WASM 预测 + 回滚 + 校正平滑 + libm 对齐 |
| P5 | 3—5 天 | 1 周 | Docker/CI/压测工具/文档 |
| 合计 | 6—8 周 | **9—12 周** | 单人全职，不含内容与美术 |

"P0—P2 2—3 周可见联机"只在砍掉 AI 与预测时成立，且 P2 的客户端改造被低估。

## 5. 战略选项：为什么可能不需要 Rust

这是整篇评审最需要拍板的一条。方案的出发点是"规则只写一遍"，但 **TypeScript 服务端能更彻底地做到这件事**，因为浏览器和 Node 跑的是同一份文件、同一个语言、同一套数学：

| 维度 | 方案（Rust） | Node/TS 方案 |
| --- | --- | --- |
| 复用现有规则 | 重写 2,061 行 + 269 个测试 | **直接 import `src/game`，0 行重写** |
| 客户端预测 | WASM 工具链 + native/wasm 数学对齐 | 同一份 TS，浏览器与 Node 同一实现 |
| 内容单一来源 | 抽 JSON + 规则函数迁移 | 不用动 |
| 联机 MVP（1v1、无预测） | 4—6 周（含客户端改造） | **2—3 周**（客户端改造两条路线相同） |
| 测试 | 按行为断言重写 | 现有 269 个用例直接可用 |
| 部署 | 静态二进制 + Docker，60—80 MB | `node:22-slim` + Docker，镜像大 2—3 倍 |
| 协作门槛 | 两套语言、两套工具链 | 一套 |
| 容量 | 数百房/核（见 §4 实测，Node 同量级） | 单核 800+ 房；需要时 `worker_threads` 分片 |

方案没有排除 Node，也没有论证为什么必须是 Rust。如果 Rust 是硬约束（团队偏好、长期自研服务端、练手），那就按方案走并修掉 §2；如果只是手段，建议：

1. 先花 **3—5 天**做一个 spike：Node 房间 + WebSocket + 30 Hz 快照 + 1v1，验证"客户端只渲染快照"这条链路；
2. 用 §4 的实测数据确认容量后，再决定要不要换 Rust；
3. 两条路线的协议与客户端代码**完全一样**（方案 §3 的协议是语言中立的），换实现只是替换后端，客户端一行不改——所以先做 Node 不是分叉，是降风险。

## 6. 对文档 §8 四个待确认问题的建议答复

1. **玩法范围**：v1 做 **1v1 + 房间码**，4 人房 + AI 补位留到 P3。房间、快照、预测的复杂度与人数强相关，1v1 就能暴露 90% 的问题。
2. **手感底线**：不接受"无预测"作为最终形态，但接受"v1 先无预测，P4 立即补"。先量：在模拟 0 / 40 / 80 / 150 ms RTT 下记录每分钟校正次数，用数据排 P4 优先级。
3. **账号与存档**：v1 匿名设备 token + 服务端档案（不注册），本地存档保留为离线模式；账号体系等公开匹配再做。
4. **部署形态**：先交付 Docker 镜像 + compose + 一份反代示例；v1 不上公网域名/TLS/监控。

## 7. 如果坚持 Rust：建议的修订

1. P0 增加四项：libm 策略（§2.1）、协议边沿位（§2.2）、`MatchSource` 接缝（§2.6）、单机归属决策（§2.4）。
2. P1 改成"先移植 `MovementSystem` + `math` + `Random`，同一个输入序列跑 600 帧，对比 native / wasm / TS 的逐帧偏差"，通过后再移植其余系统——把最大的不确定性放在第一周暴露。
3. P2 之前补：房间生命周期、重连、背压（§3 的 1—3）。
4. P4 的验收从"能玩"改成"0/40/80/150 ms RTT 下每分钟校正次数 < N、快照丢弃率 < 0.1%"。
5. Docker 按 §2.3 修正，并补 `.dockerignore`、`cargo` 依赖缓存层、CI 里的 `clippy + fmt + cargo test`。

## 8. 本次评审的验证边界

- **实测**：`vitest run` 31 文件 / 269 用例全通过；行数逐文件统计；性能基准（临时脚本已删除，仓库无残留）。
- **代码核对**：`src/game`、`tests`、`src/scenes`、`src/app`、`src/presentation`、`server/`、`vite.config.ts` 的相关行号已逐一确认。
- **推断未实测**：glibc 与 Rust libm 的 ULP 差异（文献结论 + 代码路径推断，本机未构建 wasm 验证）；Docker 网络行为（按 Docker 网络模型推断，未起容器）；Node 版服务端容量（按现有 `step` 实测外推，未含网络与序列化开销）。

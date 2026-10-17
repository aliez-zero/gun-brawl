# T00 · 公共契约与可复用基线

更新：2026-10-17（北京时间）。分组：基础与集成。状态：已完成；负责人：当前会话；基线 `332998d` / 文档同步 `1cc7358`。

[模块目录](./README.md) · [认领与依赖总看板](../PARALLEL_PLAN.md) · [当前实现状态](../DEVELOPMENT.md)

## 开始前

先读 [AGENTS.md](../../AGENTS.md)、[架构](../ARCHITECTURE.md) 和 [PRD](../PRD.md)。状态、负责人、工作区与分支只在总看板登记；本文复选框用于子任务，不代表集成完成。

首先完成本模块。其他模块可先调研与设计；接口冻结和基线建立前，不各自改公共类型或创建缺少源码的工作区。

## 模块范围与验收

- **目标**：让不同 AI 拿到一致的源码、输入 / 武器 / 地图 / 事件 / 存档约定和文件归属。
- **负责范围**：Git 本地基线、总计划的契约记录、`src/game/core/types.ts` 的首批必要变更、初始化兼容、测试基线；由集成者执行。
- **交付**：基线 commit、首批消费方接口、数据默认值、旧模式兼容策略、每项任务的接入清单。
- **具体工作**：确认模块负责人；确定武器实例 / 弹丸快照 / 爆炸服务签名；确定配置校验入口和视图挂载接口；记录逻辑阶段；确定存档迁移责任。只增加实际有调用方的接口。
- **验收**：原三模式和当前默认键位仍可运行，31 项原有回归保留；新接口可被任务实现使用，无空壳功能入口。
- **不包含**：代替所有任务实现玩法、推送远端或部署。

## 开发子任务

按下列顺序推进。部分能力可先开发，但不能用占位行为替代真实依赖后勾选完整模块。

- [x] **T00.1** 核对现有源码、未跟踪文件与 31 项规则基线，建立可以分发的本地基线并记录 commit。
- [x] **T00.2** 列出首批武器实例、弹丸快照、投弹输入、爆炸服务的实际消费方，只冻结本批会用到的契约。
- [x] **T00.3** 明确初始化、复活、加时、重赛、训练重置与结果 ID 的责任，确定新的系统调用顺序。
- [x] **T00.4** 约定设置子视图与存档字段交付方式，登记公共文件写入者及各开发工作区。
- [x] **T00.5** 接入首批必要类型和默认值，保留当前三模式；公布接口变更与各模块接入清单。

## T00 冻结结果

### 武器与弹丸

- `WeaponDefinition.maxAmmo: number | null`：`null` 表示无限弹；当前手枪为 `null`。
- `WeaponInstance { definition, ammoRemaining }`；`ActorState.weapon` 保存当前实例。
- `MatchConfig.startingWeapon` 是出生 / 复活 / 加时的复位目标；拾取只换当前实例，不改配置。
- `ActorState.fireCooldown` 继续由角色持有，切枪不重置冷却；T01 负责有限弹扣减、耗尽回退和六枪注册表。
- `Projectile` 新增 `weaponId`、`velocity: Vec2`、`impulse: Vec2`；发射时冻结，`distanceRemaining` 仍限制射程。换枪不改变在途弹丸，二维速度供 T01 霰弹使用。

### 投弹与爆炸

- `ActorInput.bombPressed: boolean` 是按下边沿；`idleInput`、`KeyboardInput`、`BotController` 默认 `false`，不改变连续射击语义。
- 当前没有投弹键绑定和 UI 显示；T02 实现真实炸弹后由 T06 接 K / 小键盘 1，未接入前不显示可用。
- `ExplosionSource = 'bomb' | 'rocket'`。
- `ExplosionRequest { ownerId, source, center, radius, centerImpulse, edgeImpulse }`。
- `ExplosionHit { actorId, impulse }`。
- `ExplosionResolver.resolve(state, request): ExplosionHit[]`：T02 实现共享计算，T01 火箭与 T02 炸弹消费；调度层负责应用推力、保护和归因，不在解析器里直接改生命。

### 生命周期与结果 ID

- 初始化：`BattleSimulation` 用 `MatchConfig.startingWeapon` 创建每个 `ActorState.weapon`。
- 复活：`respawnActor` 读取 `state.config.startingWeapon`，恢复满弹 / 无限弹并清空 `fireCooldown`；`LifeSystem` 只负责计时触发。
- 加时：`MatchSystem` 清空弹丸后对并列领先者调用 `respawnActor`；T02/T03 接入时还必须清炸弹、箱子、预告和引信。
- 重赛 / 训练重置：`GameApplication.start` 生成新配置和新运行器，`ArenaScene.startMatch` 替换旧 runner；不继承旧局弹丸、计时或武器实例。
- 结果 ID：应用层每局生成 `matchId`；`MatchSystem` 优先写 `MatchResult.id = config.matchId`，缺省回退 `seed-mode` 兼容旧调用。T12 负责存档历史与去重范围，当前只保存 `lastResultId`。

### 设置、存档与视图边界

- `SaveStore` 只由 T12 负责人修改；应用层调用 `persist` / `recordResult`，UI 视图只发回调，不直接写 localStorage。
- 设置页当前仍在 `GameUI` 内；T06 交付独立设置组件时提供挂载 / 卸载 / 保存回调，主 UI 接线由集成者完成。
- 外观 / 地图编辑器已经按独立组件交付；后续页面沿用“组件渲染 + 应用保存”的模式。
- 当前工作区：`D:\code\gun-brawl`，分支 `main`，基线 `1cc7358`；没有其他并行工作区。

### 检查与剩余

- `pnpm typecheck` 通过；`pnpm test` 48 项 / 5 文件通过；`pnpm build` 通过；浏览器 smoke 通过（三模式、默认键位、暂停 / 恢复、失焦、设置、双人、重赛、刷新、禁用存储）。
- 新增 `tests/contracts.test.ts` 覆盖默认武器 / 投弹输入、在途弹丸快照、复活 / 加时复位、`matchId` 结果标识。
- 未完成：T01 有限弹 / 六枪 / 换枪入口；T02 炸弹 / 爆炸运行时；T03 投放与拾取；T06 投弹键 / 设置组件；T12 存档字段与历史去重。
- T00 不包含推送远端；本次只做本地提交。

## 文件与接口交接

- 只修改总看板和本任务约定的独占文件；公共类型、调度、应用装配和主 UI 的修改交给对应负责人。
- 新文件位置均为开发建议，当前可能尚未存在。公共契约未冻结时提交具体字段、默认值、消费者和调用顺序，由集成者确认并落地。
- 交付实际行为、文件或补丁、接口与事件、初始化 / 复活 / 加时 / 重置 / 存档影响，以及主流程需要接入的位置。
- 写明执行的检查及结果、可复现步骤、尚缺功能和阻塞条件。按 [交接模板](../PARALLEL_PLAN.md) 汇报，集成后再更新 [开发现状](../DEVELOPMENT.md)。

## 可直接复制给开发 AI 的指令

```text
请在 D:\Code\gun-brawl 中开发 T00 模块。
先阅读 AGENTS.md、docs/DEVELOPMENT.md、docs/PARALLEL_PLAN.md，
再按 docs/modules/00-integration.md 的范围和子任务工作。
先在总看板登记负责人、工作区、依赖与独占文件；不要覆盖其他模块的改动。
共享文件由集成者接入；保留现有三模式、默认键位和手枪击退回归。
完成后提供实际变更、接口接入点、测试结果和剩余限制，区分待集成与已完成。
```

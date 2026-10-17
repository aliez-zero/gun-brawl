# T02 交付：炸弹与共享爆炸服务

更新：2026-10-17（北京时间）。状态：部分完成（T02.1—T02.5 核心完成；键盘、HUD、渲染、音效、AI 仍待集成）。负责人：当前会话。工作区：`D:\code\gun-brawl`。基线：`e5ff7eb`。

## 实际交付

### 爆炸服务

- `src/game/systems/ExplosionSystem.ts`
  - `ExplosionSystem implements ExplosionResolver`，纯读取状态并返回 `ExplosionHit[]`。
  - 中心命中且角色中心与爆心重合时默认向上。
  - 距离线性衰减：中心 `centerImpulse`，边缘 `edgeImpulse`。
  - 实体平台从爆心到角色中心遮挡；单向平台不遮挡。
  - `protectionRemaining > 0` 的角色完全跳过。
  - `applyExplosionHits`：施加冲量、写 `hit` 事件；非拥有者才写 `lastHit`，自爆不覆盖已有敌方归因。

### 炸弹运行时

- `src/game/systems/GrenadeSystem.ts`
  - 每命 2 枚；0.6 秒投掷冷却；最多 2 枚未爆。
  - 2 秒引信；重力 1400；反弹系数 0.45；炸弹半径 10。
  - 爆炸半径 150；爆心 360 / 边缘 90。
  - 投掷位置在角色前方 18、上方 34；水平 320 / 向上 340。
  - 实体墙水平反弹；实体 / 单向平台垂直反弹；单向平台可穿过。
  - 投弹成功清除保护；`bomb-empty` 事件用于后续 HUD 轻提示。
  - 拥有者出界 / 被淘汰后炸弹继续；暂停时引信和运动冻结。
- `src/game/core/constants.ts` 新增 `BOMB` 配置；`ActorState` 新增 `bombsRemaining` / `bombCooldown`；`MatchState` 新增 `bombs`。
- `BattleSimulation` 在移动 / 射击之后、批量出界之前更新炸弹。
- `MatchSystem` 加时清空炸弹；`createActor` / 复活重置到 2 枚。

### 事件与状态

- 事件：`bomb`、`bomb-empty`、`explosion`、`hit`。
- 状态：`MatchState.bombs`、`ActorState.bombsRemaining`、`ActorState.bombCooldown`。
- 共享入口：`ExplosionSystem.resolve(state, request)` + `applyExplosionHits(state, request, hits, events)`；T01 火箭后续直接消费。

## 变更文件

- `src/game/systems/ExplosionSystem.ts`（新）
- `src/game/systems/GrenadeSystem.ts`（新）
- `src/game/core/constants.ts`
- `src/game/core/types.ts`
- `src/game/core/actors.ts`
- `src/game/core/BattleSimulation.ts`
- `src/game/systems/MatchSystem.ts`
- `tests/explosions.test.ts`（新）
- T02 模块与交付记录

## 检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 119 项 / 10 文件通过（T02 单文件 11 项；T01 火箭、T03 投放、T06 投弹键与并行地图测试一并通过） |
| `pnpm build` | 通过；Phaser 单独分包 |
| 浏览器 smoke | 通过（菜单、画布、键盘、训练、暂停、设置、双人、重赛、保存、禁用存储）；默认投弹键 / HUD 数量 / 炸弹表现已接 |

## 仍待集成

1. **T06**：默认 K / 小键盘 1 已接；冲突检查、改键 UI、设置显示仍未完成。
2. **HUD / 渲染 / 音效**：HUD 炸弹数量、炸弹 / 爆炸表现已接；冷却条、爆炸音效仍待。
3. **T05 AI**：AI 投弹、躲避、自爆风险判断。
4. **T01.4 火箭**：爆炸服务已消费；T01 通用火箭已接入（注册、发射、射程 / 命中爆炸），手内火箭外观已由 T10 接入。
5. **物理边界**：炸弹使用固定步长 + AABB 近似，尖角 / 极高速连续碰撞未做专项验证。

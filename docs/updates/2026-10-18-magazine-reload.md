# T01 追加：弹匣、备弹与换弹

更新：2026-10-18（北京时间）。状态：已交付并验证。正常对局仍从手枪开始；特殊枪 / 终极武器现在使用弹匣 + 备弹，不再是一整局只递减一个总弹量。

## 触发

用户要求“加特林弹夹”，并把武器威力与手枪对比。上一版八枪虽然威力已重调，但 `maxAmmo` 仍是总弹量，打空直接回手枪，没有弹夹节奏；这一版把类别级弹药模型补成真正的弹匣 / 备弹 / 换弹。

## 实际交付

### 弹药模型

- `WeaponDefinition.maxAmmo` 改语义为**弹匣容量**（`null` = 无限弹匣的手枪）。
- 新增可选 `reserveAmmo`、`reloadTime`。
- `WeaponInstance` 增加 `reserveRemaining`；`ActorState` 增加 `reloadRemaining`。
- `startReload` / `finishReload` / `tickReload` / `canReload` 集中在 `WeaponSystem`；射击只扣弹匣，换弹从备弹补满。
- 手动换弹：P1 `R`、P2 `小键盘 2`；空仓按住开火会在射速冷却后自动换弹。
- 换弹期间不能射击，但可移动 / 跳跃 / 受击；备弹不足时部分装填。
- 弹匣与备弹都为空才回退基础手枪；回退帧仍不会白送一发手枪。
- 拾取、复活、加时、训练 1—8 都会补满弹匣 + 备弹；换枪 / 换弹不重置 `fireCooldown`。

### 弹匣参数

| 枪械 | 弹匣 | 备弹 | 换弹 |
| --- | --- | --- | --- |
| 基础手枪 | ∞ | — | — |
| 冲锋枪 | 30 | 90 | 1.5 s |
| 突击步枪 | 30 | 90 | 1.8 s |
| 霰弹枪 | 6 | 18 | 2.0 s |
| 狙击枪 | 5 | 15 | 2.2 s |
| 火箭筒 | 1 | 3 | 2.4 s |
| 加特林 | 100 | 100 | 3.2 s |
| 重炮狙击枪 | 1 | 2 | 2.6 s |

### HUD / 输入

- HUD：`突击步枪 · 30/90`；换弹时显示 `换弹 1.2s`；手枪仍为 `∞`。
- 底栏 / 帮助弹窗：P1 `R 换弹`、P2 `小键盘 2 换弹`；投弹键保持 K / 小键盘 1。
- 训练场仍按 1—8 满弹切换，切换后两池都补满。

## 验证

- 新增 `tests/reload.test.ts` 4 项：空仓自动换弹、手动换弹与备弹不足、无限弹手枪拒绝换弹 / `refillWeapon` 补两池、换弹期间禁射且备弹只扣一次。
- 全量 **150 项 / 14 文件** 通过（后续补入改键）；`tsc --noEmit`、`vite build`、浏览器 smoke 通过。
- 浏览器：训练场霰弹枪开一枪后按 R，HUD 显示 `霰弹枪 · 5/18 · 换弹 1.9s`；换弹后 `6/17`。截图 `artifacts/training-reload.png`。

## 变更文件

- `src/content/weapons.ts`：八枪弹匣 / 备弹 / 换弹时间。
- `src/game/core/types.ts`：`reserveRemaining`、`reloadRemaining`、`reloadPressed`、`reserveAmmo` / `reloadTime`。
- `src/game/systems/WeaponSystem.ts`：换弹入口与补弹。
- `src/game/systems/CombatSystem.ts`：换弹计时、自动 / 手动换弹、禁射与耗尽回退。
- `src/game/core/actors.ts`：新角色初始换弹状态。
- `src/content/controls.ts` / `src/presentation/KeyboardInput.ts` / `src/ui/GameUI.ts`：R / 小键盘 2、HUD、帮助。
- `src/game/ai/BotController.ts`：低弹匣时主动换弹。
- `tests/reload.test.ts`、`tests/weapons.test.ts`、`tests/training.test.ts`、`tests/drops.test.ts`、`tests/keyboard.test.ts`、`tests/contracts.test.ts`。

## 仍待

1. 17 个具体型号的独立弹匣容量、换弹动画 / 音效与逐枪手感仍是设计提案。
2. 换弹期间还没有专用动画 / 音效；HUD 已有倒计时。
3. 仍需人工试玩确认加特林 100 发弹匣、重炮 1 发弹匣的节奏是否合适。

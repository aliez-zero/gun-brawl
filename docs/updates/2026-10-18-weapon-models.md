# T01 追加：17 个具体武器型号

更新：2026-10-18（北京时间）。状态：核心完成；逐枪手绘换弹 / 火光帧、真实音色素材和人工平衡仍待。负责人：当前会话。工作区：`D:\code\gun-brawl`（`main`）。

## 实际交付

### 17 个型号

P92、P1911、Deagle、UMP45、Vector、UZI、M416、AKM、SCAR-L、S686、S1897、S12K、Kar98k、M24、AWM、RPG-7、AT4。

- `ARMORY_WEAPONS` 是 17 型号展示 / 图鉴顺序；`WEAPON_MODELS` 保存 16 个新增型号，P92 复用基础手枪。
- `WeaponId` 扩展到 24 个（8 类别名 + 16 型号）；`WEAPONS` 继续只暴露八类别名，`getWeapon` 同时查型号表，旧存档 / 训练 1—8 / 既有测试不破。
- 逐枪参数来自 [WEAPONS.md](../WEAPONS.md)：弹匣 / 备弹 / 换弹、水平后坐 + `recoilY` 垂直后坐、弹速 / 射程 / 击退、霰弹丸数 / 散布、火箭爆炸半径 / 推力。

### 接入

- **投放**：`DEFAULT_DROP_POOL` 改为 16 个标准型号 + 加特林 / 重炮；`STANDARD_DROP_POOL` 过滤两类终极。
- **图鉴 / 训练**：图鉴显示 17 卡真实参数；任意卡可“用此枪训练”。`selectTrainingWeapon` 同时接受 1—8 槽位和具体 `WeaponId`。
- **HUD / AI**：HUD 显示具体型号名与逐枪弹量；AI 继续读取 `definition.range` 等公开属性。
- **外观**：`WeaponArt` 以八家族轮廓为底，叠加型号色带 / 木托 / 镜筒 / 枪口环；箱子和 HUD 共用同一裁剪。
- **音效**：`shot` 事件携带 `weaponId`，`SoundEffects` 用逐型号音高表。
- **换弹表演**：沿用 `weaponPose` 的通用换弹姿势，时长由逐枪 `reloadTime` 驱动；尚无逐枪手绘关键帧。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **182 项 / 19 文件**通过；`weapons-models.test.ts` 4 项 |
| `pnpm build` | 通过 |
| Chrome smoke | 通过 |
| 浏览器图鉴 | 17 张卡；`artifacts/armory-17.png` |
| 浏览器试枪 | 点击 AWM 后 HUD `AWM · 5/15 · 炸弹 2`；`artifacts/awm-training.png` |
| 既有回归 | 八类别名、训练 1—8、弹匣 / 换弹、投放、武器契约全部通过 |

## 变更文件

- `src/game/core/types.ts`：24 个 WeaponId、`family`、`recoilY`、shot 事件 `weaponId`。
- `src/content/weapons.ts`：16 个型号、`ARMORY_WEAPONS`、`WEAPON_MODELS`、合并查找。
- `src/content/drops.ts`：17 型号权重池。
- `src/game/systems/CombatSystem.ts`：垂直后坐与 shot 型号。
- `src/presentation/WeaponArt.ts` / `FieldLayer.ts` / `SoundEffects.ts`：型号外观、色带、音高。
- `src/ui/GameUI.ts` / `BattleSimulation.ts` / `MatchRunner` 调用侧 / `ArenaScene.ts`：17 卡图鉴、任意型号训练。
- `tests/weapons-models.test.ts`。
- WEAPONS、WEAPON_ART、T01 模块、README、DEVELOPMENT、PARALLEL_PLAN、QA。

## 仍待

1. 逐型号手绘换弹动作 / 枪口火光帧；当前是程序化家族轮廓 + 型号色带 / 部件。
2. 真实逐枪音色素材；当前 WebAudio 合成音高。
3. 17 型号逐枪人工平衡与正式发布前原创命名确认。

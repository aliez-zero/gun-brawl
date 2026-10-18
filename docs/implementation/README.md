# 武器与战斗实现文档

更新：2026-10-18（北京时间）。本目录专门整理这一轮实际落地并已提交的武器、战斗、表现、HUD 与验证工作，按职责拆分，避免把所有内容堆在一份长文里。

> 范围说明：这里记录的是**本轮实现**，不是整个项目的 PRD 完成声明。并行开发中的牛仔骨架 / 外观编辑器改动不在本目录范围内，也没有被提交进这些模块的提交。模块总览仍看 [`docs/modules`](../modules/README.md)，当前全项目状态看 [`docs/DEVELOPMENT.md`](../DEVELOPMENT.md)。

后续 R3 集成已将五人及全部混搭切换到连续骨架，原武器提交边界仍保留作历史记录。当前手臂 / 双手 IK 由 `HumanoidRig` / `HumanoidView` 提供，WeaponLayer 消费世界挂点并抑制旧手臂；火光按视觉挂点定位，弹丸仍使用逻辑枪口。当前状态与验证见 [全角色交接](../updates/2026-10-18-all-character-rigs.md)，本文目录中的旧前景手臂说明仅适用于无骨架挂点的兼容路径。

## 1. 模块目录

| 目录 | 文档 | 负责内容 |
| --- | --- | --- |
| `combat/` | [01 武器内容与平衡](./combat/01-weapon-content.md) | 17 个具体型号、8 个类别别名、弹匣 / 备弹 / 射速 / 击退 / 爆炸、CF 式定位与平衡口径 |
| `combat/` | [02 战斗、换弹与击退](./combat/02-combat-reload-knockback.md) | 60 Hz 开火流程、自动换弹、弹丸 / 霰弹 / 火箭、冲量上限、近距离爆炸方向 |
| `presentation/` | [03 武器模型与持枪](./presentation/03-weapon-art-and-holding.md) | 3 倍画布、世界尺寸、逐型号几何、表面细节、左右镜像、握把 origin、前景手臂 |
| `presentation/` | [04 枪口与弹道表现](./presentation/04-muzzle-and-projectiles.md) | 逐型号枪口、子弹 / 火光同点生成、按威力分档的弹道、火箭弹体、拖尾裁剪 |
| `ui/` | [05 HUD、图鉴与训练](./ui/05-hud-armory-training.md) | HUD 弹药 / 换弹文本、17 卡图鉴、威力条、训练 1—8 与具体型号预选 |
| `engineering/` | [06 测试、构建与发布](./engineering/06-tests-build-release.md) | 测试矩阵、实际命令、构建产物、浏览器 smoke、提交与推送记录 |
| `engineering/` | [07 文件、接口与边界](./engineering/07-files-interfaces-boundaries.md) | 文件归属、对外接口、扩展新枪步骤、未完成项和协作边界 |

## 2. 推荐阅读顺序

### 想快速试玩

1. 看 [武器内容与平衡](./combat/01-weapon-content.md) 的“当前数值表”。
2. 看 [HUD、图鉴与训练](./ui/05-hud-armory-training.md) 的“试枪入口”。
3. 按项目 README 启动开发服务并进入训练，按 `1—8` 切类别枪，或从图鉴选具体型号；`4180` 是武器开发时的历史预览端口，不保证仍运行。

### 想接手代码

1. [文件、接口与边界](./engineering/07-files-interfaces-boundaries.md)
2. [战斗、换弹与击退](./combat/02-combat-reload-knockback.md)
3. [武器模型与持枪](./presentation/03-weapon-art-and-holding.md)
4. [枪口与弹道表现](./presentation/04-muzzle-and-projectiles.md)
5. [测试、构建与发布](./engineering/06-tests-build-release.md)

### 想继续调平衡

1. 先读 [武器内容与平衡](./combat/01-weapon-content.md) 的约束和公式。
2. 再读 [测试、构建与发布](./engineering/06-tests-build-release.md) 的击退 / 出屏测试。
3. 不要只改面板值；`impulseCap`、射速整帧、枪口位置、弹丸数都要一起检查。

## 3. 本轮的六个核心结论

1. **伤害在本作就是击退**：没有 HP；命中只施加冲量，出界才扣命。
2. **射速必须按 60 Hz 整帧核算**：面板 `interval` 不等于实际 RPM；快速枪尤其明显。
3. **多弹丸需要整发上限**：只给单颗弹丸上限会让霰弹总推力被 900 截断。
4. **枪口必须是每把枪自己的点**：固定 `x+27` 会让长枪从胸口吐子弹。
5. **世界尺寸要除 3 倍画布采样**：`160×80` 逻辑稿实际画布是 `480×240`，漏除会把枪放大三倍。
6. **左右镜像要同时镜像 origin**：Phaser `flipX` 不会自动镜像握把原点。

## 4. 相关既有文档

- [武器总设计](../WEAPONS.md)：完整参数、投放、图鉴和历史平衡说明。
- [武器外观](../WEAPON_ART.md)：尺寸、轮廓、配色与手内规则。
- [模块任务包：武器](../modules/01-weapons.md)：T01 的任务、接口和验收清单。
- [平衡交付记录](../updates/2026-10-18-weapon-balance.md)：本轮反馈的逐条修复记录。
- [架构](../ARCHITECTURE.md)：固定步、系统顺序和分层约束。

## 5. 当前验证快照

- 本轮最后一次完整回归：**215 项 / 24 文件通过**（包含当时工作区中并行未提交的 AI 测试）。
- `tsc --noEmit`：通过。
- `vite build --outDir dist-weapon-preview`：通过。
- Chrome smoke：菜单、画布、键盘、训练、暂停 / 恢复、失焦、设置、双人、重开、持久化、存储阻塞全部通过。
- 远端 `main` 与本轮武器提交同步；具体哈希见 [测试、构建与发布](./engineering/06-tests-build-release.md)。

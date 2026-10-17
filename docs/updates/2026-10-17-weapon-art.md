# T10 交付：六家族武器外观与场地表现

更新：2026-10-17（北京时间）。状态：核心完成；六家族武器、箱子、炸弹、爆炸表现已接入。17 个具体型号、HUD 图标、音效和正式地图点位仍待后续。负责人：当前会话。工作区：`D:\code\gun-brawl`。基线：`8de68a4`。

## 实际交付

### 角色与武器分离

- `src/presentation/CharacterArt.ts`
  - `paintCharacter(..., withGun = true)`；实战图集传 `false`，只保留手臂 / 手。
  - 菜单预览和外观编辑器仍默认带手枪，预览不空手。
- `src/presentation/WeaponArt.ts`
  - 六个家族程序化 3× Canvas 侧视：手枪、冲锋枪、步枪、霰弹枪、狙击枪、火箭筒。
  - 握把原点 `(46, 46)`，枪口朝右；`displayScale = 0.55 / 3`，适配 96 px 角色。
  - 每个家族有独立轮廓、主体色和识别色；不引入第三方素材。
- `src/presentation/WeaponLayer.ts`
  - 每个 actor 一张独立武器 sprite；按 `ActorState.weapon.definition.id` 切换纹理。
  - `flipX` 跟随朝向；深度在角色之上、名字标签之下；切换武器不重建角色图集。
  - 角色淘汰 / 复活时隐藏 / 恢复；场景重置 / 销毁清理纹理。

### 场地表现

- `src/presentation/FieldLayer.ts`
  - 箱子 incoming：落点光柱 + 脉冲圈。
  - 箱子 active：50×36 箱体、武器图标、识别色、角钉；最后 3 秒闪烁。
  - 炸弹：弹体、引信、火花、临近爆炸加速闪烁与地面阴影。
  - 爆炸：0.36 秒扩张圈 + 中心闪光。
- `ArenaScene` 装配 `WeaponLayer` + `FieldLayer`；`ArenaRenderer` 未改，避免与并行地图会话抢文件。

### 可玩性

- 训练场等待约 8 秒后可以直接看到箱子；走到箱子上自动拾取，HUD 枪名 / 弹量切换，手内武器外观同步切换。
- 炸弹键 K / 小键盘 1 已接入（T06 / T02 集成），HUD 显示每命炸弹数；投掷物和爆炸在场地层可见。

## 变更文件

- `src/presentation/CharacterArt.ts`：`withGun` 开关，实战图集不再烘手枪。
- `src/presentation/WeaponArt.ts`（新）：六家族纹理。
- `src/presentation/WeaponLayer.ts`（新）：独立武器 sprite。
- `src/presentation/FieldLayer.ts`（新）：箱子 / 炸弹 / 爆炸。
- `src/scenes/ArenaScene.ts`：装配与清理。
- `docs/modules/10-appearance.md`、`docs/WEAPON_ART.md`、本记录。

## 检查

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 120 项 / 10 文件通过（T03 节奏追加 1 项 + T06 投弹键 1 项） |
| `pnpm build` | 通过 |
| 浏览器 smoke | 通过；菜单、训练、暂停、双人、重赛、保存 |
| 视觉检查 | `artifacts/weapon-layer-gallery.png` 六家族纹理；`artifacts/battle.png` 手内位置；`artifacts/training-bomb.png` 炸弹 + HUD；`artifacts/training-drop.png` 箱子 |

## 仍待完成

1. 17 个具体型号的独立轮廓 / 配件 / 配色。
2. HUD 32 px 武器图标、图鉴 / 训练武器墙。
3. 开火后坐位移、枪口火光、换弹动作；目前换枪只换纹理。
4. 投弹 / 拾取 / 爆炸音效已接；逐枪独立音色仍待。
5. 正式地图 `dropPoints` 与箱子落点 / 拾取提示；当前回退到平台下半区派生点。
6. 双人同色时的武器轮廓 / 编号区分仍需结合玩家色做最终检查。

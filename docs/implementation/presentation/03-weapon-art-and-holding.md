# 模块三：武器模型与持枪表现

代码入口：`src/presentation/WeaponArt.ts`、`WeaponLayer.ts`、`WeaponSupport.ts`、`CharacterMotion.ts`、`CharacterPainter.ts`
测试 / 证据：`tests/character-motion.test.ts`、`tests/muzzle.test.ts`、`artifacts/facing-*.png`、`artifacts/weapon-wall.png`

## 1. 模块职责

这个模块解决“看起来像人在拿枪”和“不同枪看起来不一样”：

- 程序化生成 17 个型号的侧视武器贴图。
- 给每个型号独立的世界尺寸、枪口、轮廓和家族色。
- 让武器跟随角色朝向、移动、后坐、换弹倾斜。
- 在武器前方画持枪手臂，避免枪浮在身体上。
- 处理左右镜像时的握把 origin。
- 给长枪加支撑手 / 支撑臂。
- 保持枪身小于角色，同时让手枪、步枪、狙击、重炮有明显体量差。

## 2. 画布与坐标系

### 2.1 逻辑稿与 3 倍画布

武器美术按 `160 × 80` 逻辑稿绘制，但实际 canvas 是：

```text
160 × 3 = 480
80  × 3 = 240
```

`createWeaponArtCanvas` 里 `ctx.scale(3, 3)`，所以绘制代码仍用 `0—160` 坐标。

**关键坑**：Phaser 显示的是 480 宽的 canvas。世界缩放如果直接用 `0.4`，实际渲染宽度是：

```text
480 × 0.4 = 192 px
```

而不是 `160 × 0.4 = 64 px`。因此 `weaponDisplayScale` 必须返回：

```ts
MODEL_SCALE[id] / SAMPLE
```

其中 `SAMPLE = 3`。

### 2.2 握把原点

```ts
WEAPON_ART = {
  width: 160,
  height: 80,
  gripX: 46,
  gripY: 46,
  ...
}
```

所有武器都围绕 `(46, 46)` 绘制握把 / 扳机区域，`WeaponLayer` 用这个点作为 sprite origin，再把它对齐到角色手部：

```ts
CHARACTER_GRIP = { x: 22, y: -32 }
```

`x=22` 是角色脚底中心向前 22 px，`y=-32` 是脚底向上 32 px（胸前外侧）。

## 3. 世界尺寸

### 3.1 缩放表

`MODEL_SCALE` 是“相对 160 逻辑稿的比例”，最终世界宽度约为 `160 × scale`：

| 类别 | 型号 | scale | 约宽 |
| --- | --- | --- | --- |
| 手枪 | P92 | 0.37 | 59 px |
| 手枪 | P1911 | 0.36 | 58 px |
| 手枪 | Deagle | 0.40 | 64 px |
| 冲锋枪 | UMP45 / Vector / UZI | 0.30—0.34 | 48—54 px |
| 步枪 | M416 | 0.40 | 64 px |
| 步枪 | AKM | 0.41 | 66 px |
| 步枪 | SCAR-L | 0.42 | 67 px |
| 霰弹 | S686 / S1897 / S12K | 0.38—0.42 | 61—67 px |
| 狙击 | Kar98k / M24 / AWM | 0.47—0.48 | 75—77 px |
| 火箭 | RPG-7 / AT4 | 0.45—0.47 | 72—75 px |
| 加特林 | — | 0.50 | 80 px |
| 重炮 | — | 0.51 | 82 px |

角色约 96 px 高，因此最大枪身约 82 px，仍然小于人物。

### 3.2 为什么手枪要放大

早期手枪 `0.28` 只有约 45 px，在 1280 视口里几乎看不见，用户反馈“手枪太小、和其他武器不成比例”。

现在：

- P92 `0.28 → 0.37`（45 → 59 px）
- P1911 `0.27 → 0.36`（43 → 58 px）
- Deagle `0.32 → 0.40`（51 → 64 px）

手枪和步枪都在 58—67 px 量级，但通过滑套 / 握把 / 枪口形状区分，不再靠尺寸区分。

## 4. 逐型号轮廓

`WeaponArt` 由三层组成：

1. **家族基础轮廓**：手枪 / 冲锋枪 / 步枪 / 霰弹 / 狙击 / 火箭 / 加特林 / 重炮。
2. **型号几何**：枪管、枪托、弹匣、护木、双管、泵动、镜筒、火箭锥、制退器。
3. **型号色带 / 材质**：木托、沙色护木、金色滑套、紫色狙击镜、警示条纹等。

### 4.1 辨识点举例

| 型号 | 视觉识别 |
| --- | --- |
| P92 | 短滑套、圆润枪身 |
| P1911 | 长滑套、木握把 |
| Deagle | 大三角滑套、金色点缀 |
| UMP45 | 方盒机匣、青色条纹 |
| Vector | 楔形枪身、橙色条纹 |
| UZI | 盒形机匣、红色条纹 |
| M416 | 沙色护木、长导轨 |
| AKM | 木托、木护木、香蕉弹匣 |
| SCAR-L | 长导轨、沙色枪身 |
| S686 | 双管、木质枪托 |
| S1897 | 泵动护木、长枪管 |
| S12K | 半自动机匣、短管 |
| Kar98k | 木托、长枪管、小镜 |
| M24 | 长镜、合成托 |
| AWM | 最长枪管、大镜、制退器 |
| RPG-7 | 粗管、锥形战斗部、木隔热套 |
| AT4 | 直管、锥形前盖、肩托 |

## 5. 表面细节与光照

### 5.1 自动箱体渐变

`box()` 对高度 >3 的六位十六进制颜色自动生成上亮下暗的线性渐变：

```text
顶部 = tint(fill, +20%)
中部 = fill
底部 = tint(fill, -20%)
```

这让机匣、枪管、枪托、弹匣不再是纯色块。

### 5.2 顶部高光

高度 ≥4 的箱体在顶部画 0.65 px 的高光边，模拟金属 / 木托受光。

### 5.3 整体受光层

所有绘制完成后，用 `source-atop` 给不透明像素叠一层垂直光照：

```text
顶部  rgba(255,246,218,0.20)
中部  透明
底部  rgba(4,12,16,0.30)
```

透明边缘不受影响，HUD 裁剪也不会出现底色。

### 5.4 硬件细节

`drawHardwareDetails` 按家族补：

- 手枪：滑套防滑纹、抛壳口、枪口高光。
- 冲锋枪：散热孔、弹匣筋、导轨。
- 步枪：导轨槽、弹匣筋、快慢机、枪管高光。
- 霰弹：枪管肋、泵动槽、弹仓帽。
- 狙击：镜片渐变、拉机柄、弹匣筋、枪管高光。
- 火箭：警示环、瞄具、握把。
- 加特林：六管高光、弹链、枪口环。
- 重炮：制退孔、炮管高光、瞄具。

### 5.5 木纹

AKM / P1911 / RPG-7 / S1897 的木托额外画 2—4 条深色木纹和一条亮色受光边。

## 6. 左右镜像与握把 origin

### 6.1 问题

Phaser 的 `sprite.setFlipX(true)` 会镜像纹理，但**不会自动镜像 origin**。sprite 的 origin 仍然指向纹理的 `46/160` 处，翻转后 content 的握把跑到另一侧，枪托横在胸前，看起来像换了一把枪。

### 6.2 解法

朝左时同时镜像 origin：

```ts
const gripOriginX = WEAPON_ART.gripX / WEAPON_ART.width;
const originX = facing < 0 ? 1 - gripOriginX : gripOriginX;
sprite.setOrigin(originX, WEAPON_ART.gripY / WEAPON_ART.height);
sprite.setFlipX(facing < 0);
```

这样握把内容始终落在 sprite 的 `(x, y)` 上，枪口朝角色面向，枪托在背侧。

### 6.3 深度

武器 sprite 深度为 `3`，在角色身体（约 2）之前：

- 左右轮廓都能完整显示；
- 枪托不会被躯干遮住一半；
- 朝左 / 朝右不会因为遮挡差异看成两把枪。

## 7. 前景持枪手臂（兼容路径）

R3 后当前五人及全部混搭都由 `HumanoidRig` / `HumanoidView` 绘制手臂与双手，`ArenaRenderer.weaponMounts` 传给 `WeaponLayer.draw`，挂点存在时跳过下述旧手臂 / 小手。下面保留无挂点时的实现说明，不能与骨架叠加。固定骨长、支撑点收近及生命周期见 [全角色交接](../../updates/2026-10-18-all-character-rigs.md)。

### 7.1 为什么需要

角色 atlas 里的手臂画在身体层，武器层在其上，因此枪会“浮”在胸前，看不出是手在拿。

`WeaponLayer` 额外画：

- **持枪臂**：`Graphics`，深度 `3.35`。
- **握把手**：独立小手贴图，深度 `3.4`。
- **支撑臂**：长枪才有，深度 `3.15`。
- **支撑手**：深度 `3.2`。

### 7.2 持枪臂几何

肩 → 肘 → 手枪握把：

```ts
shoulder = { x: actor.x + facing * 11, y: actor.y - 40 }
elbow    = { x: actor.x + facing * 18, y: actor.y - 27 }
wrist    = { x: sprite.x, y: sprite.y }
```

绘制顺序：

1. 11 px 深色描边，肩—肘—腕。
2. 7 px 袖子色，肩—肘。
3. 6 px 肤色，肘—腕。
4. 肩 / 肘关节圆点。
5. 扳机握把手覆盖腕部。

这样即使武器很大，手臂也能看出是弯着伸过去拿枪，而不是枪贴在身体上。

### 7.3 袖子颜色

`sleeveColor` 按 outfit 取色：

| outfit | 袖子 |
| --- | --- |
| astronaut | 浅灰蓝 `0xb8c9ce` |
| knight | 钢蓝 `0x5c7784` |
| operative | 深灰 `0x3c4a52` |
| cowboy / ronin / 默认 | 深皮革棕 `0x5a3a2e` |

### 7.4 支撑臂

长枪如果有 `supportGrip`：

```ts
chest = { x: actor.x - facing * 5, y: actor.y - 36 }
supportElbow = 中点，略低于胸
hand = 护木支撑手位置
```

画一条胸 → 支撑肘 → 支撑手的弯臂，支撑手贴图覆盖腕部。手枪没有支撑手，因此不会多出一条手臂。

### 7.5 握把手贴图

`WeaponSupport.createGripHandCanvas(skin)`：

- 深色手套底；
- 肤色拳部；
- 一条深色指缝；
- scale 0.55，避免变成大肉球。

支撑手 `createSupportHandCanvas(skin)`：

- 小臂 + 手套；
- scale 0.64；
- origin 对齐护木。

## 8. 持枪姿态

`CharacterMotion.weaponPose(actor)` 输出：

- `rotation`：换弹倾斜 + 后坐抬枪。
- `x / y`：枪身位置偏移。
- `alpha`：换弹 / 保护透明度。
- 支撑手位置随 `rotation` 旋转。

`WeaponLayer` 每帧：

1. 计算角色插值位置。
2. 查 `weaponMuzzle` / `weaponDisplayScale`（枪口与尺寸是分开的）。
3. 设置武器纹理、origin、scale、flip、rotation。
4. 画持枪臂。
5. 放握把手。
6. 如果 family 有 supportGrip，放支撑手 + 支撑臂。

## 9. 深度顺序

| 层 | 深度 | 说明 |
| --- | --- | --- |
| 角色身体 | 约 2 | atlas sprite |
| 武器 | 3 | 在身体前 |
| 支撑臂 | 3.15 | 在武器上、支撑手下 |
| 支撑手 | 3.2 | 护木位置 |
| 持枪臂 | 3.35 | 在武器上 |
| 握把手 | 3.4 | 最前 |
| 名字 / 标签 | 更高 | UI 场景 |

这样枪、手、手臂不会互相吞掉。

## 10. 已知限制

- 武器仍是程序化像素画，不是手绘序列帧。
- 换弹没有逐枪拉栓 / 退弹匣动作，只有整体倾斜 + 支撑手变化。
- 枪口火光由 `ArenaRenderer` 的 `shot` 事件绘制，不是每把枪独立贴图。
- 部分型号的枪口点是从美术轮廓近似换算，如果以后重画枪管，需要同步 `weaponMuzzle`。
- 外部 Cowboy 骨架工作会改动 `ArenaRenderer` / `CharacterArt` / `CharacterPainter`，本模块提交只包含武器表现部分，不包含那套未完成骨骼。

## 11. 相关文件

- `src/presentation/WeaponArt.ts`：画布、轮廓、渐变、细节、尺寸。
- `src/presentation/WeaponLayer.ts`：sprite、origin、flip、手臂、手、深度。
- `src/presentation/WeaponSupport.ts`：握把手 / 支撑手 canvas。
- `src/presentation/CharacterMotion.ts`：握把常量、武器姿态。
- `src/presentation/CharacterPainter.ts`：角色 atlas 里的手 / 前臂。
- `tests/character-motion.test.ts`：姿态 / 帧。
- `tests/muzzle.test.ts`：枪口与左右镜像。

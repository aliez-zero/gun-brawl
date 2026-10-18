# 模块五：HUD、图鉴与训练

代码入口：`src/ui/GameUI.ts`、`src/app/GameApplication.ts`、`src/content/weapons.ts`、`src/ui/appearance/`
相关测试 / 证据：`artifacts/auto-reload.png`、`artifacts/armory-17.png`、`scripts/smoke.mjs`

## 1. 模块职责

这个模块把武器数据变成玩家能看见、能操作的东西：

- HUD 上的当前枪名、弹匣 / 备弹、换弹倒计时、炸弹数。
- 武器图标（HUD 与图鉴共用一套轮廓）。
- 17 张图鉴卡：型号、定位、弹匣、换弹、射速、射程、击退、爆炸、单发 / 持续威力条。
- 点图鉴卡直接进训练场试枪。
- 训练场 `1—8` 类别枪热键。
- 图鉴 / 训练之间保留“上次试枪”的型号。
- 自动换弹时的 HUD 倒计时可见。

它不决定武器数值，也不改角色状态；所有按钮通过回调请求应用层。

## 2. HUD 结构

每名角色一张 `actor-card`：

```html
<div class="actor-card" id="card-p1">
  <div class="actor-name">
    <i></i><span>玩家 1</span>
    <canvas id="weapon-icon-p1" width="120" height="48"></canvas>
  </div>
  <div class="stocks" id="stocks-p1"></div>
  <small id="actor-status-p1"></small>
</div>
```

### 2.1 状态文本

`GameUI.update` 每帧生成：

```text
[终极 · ]<枪名> · <弹匣>/<备弹>[ · 换弹 x.x s] · 炸弹 <n>
```

例如：

```text
AKM · 30/90 · 炸弹 2
火箭筒 · 0/3 · 换弹 2.1s · 炸弹 2
终极 · 重炮狙击枪 · 1/2 · 炸弹 2
基础手枪 · ∞ · 炸弹 2
```

- `ammoRemaining === null` → `∞`。
- `reloadRemaining > 0` → 增加 ` · 换弹 x.xs`。
- `tier === 'ultimate'` → 前缀 `终极 · `。
- 淘汰 / 复活状态会替换成 `已淘汰 · 观战中` / `正在返回战场`。

### 2.2 武器图标

`drawWeaponIcon(actorId, weaponId)`：

- 只在武器 id 变化时重画，避免每帧重绘 canvas。
- `createWeaponIconCanvas(id)` 从 3 倍武器画布裁剪家族轮廓，缩放到 120×48。
- 图鉴卡和 HUD 共用同一套轮廓，不另画一套。

### 2.3 生命 / 队伍

- 普通模式显示 `● ● ●` / `○`。
- 训练模式显示 `∞ 无限生命`。
- 4 人局 `actor-cards` 使用 `many` 布局。

## 3. 自动换弹的 HUD 反馈

自动换弹发生在 `CombatSystem` 最后一发同帧；HUD 不需要额外接口，只读取 `actor.reloadRemaining`：

```text
开火前：火箭筒 · 1/3 · 炸弹 2
最后一发后：火箭筒 · 0/3 · 换弹 2.1s · 炸弹 2
换弹完成：火箭筒 · 1/3 · 炸弹 2
```

这保证玩家松开扳机也能看到换弹开始，而不是黑箱等待。

## 4. 图鉴（ARMORY）

入口：主菜单 / 训练界面的“武器图鉴”。

`showEncyclopedia()` 遍历 `ARMORY_WEAPONS`（17 个具体型号），每张卡：

1. **武器轮廓 canvas**：`data-weapon-art`，120×48，调用 `createWeaponIconCanvas`。
2. **名称 + 定位**：`weaponRole(id)`，当前选中的显示“当前试枪”。
3. **弹匣 / 换弹**：`maxAmmo/reserveAmmo`，无限弹显示 `∞`。
4. **射速 / 射程 / 击退**：`interval*1000 ms`、`range`、`knockback`。
5. **弹丸 / 爆炸**：`pellets 丸 · ±spread°` 或“单发直线”；火箭附 `爆炸 radius px`。
6. **单发威力条**：`weaponBurstImpulse`，宽度 `clamp(round(burst/12.5), 3, 100)%`。
7. **持续威力条**：`weaponSustainedImpulse`，宽度 `clamp(round(sustained/22), 3, 100)%`。
8. **“用此枪训练 ↗”**：`data-action="train-weapon" data-weapon="id"`。

### 4.1 为什么图鉴用具体型号

类别别名（`smg`、`rifle`）只用于训练 `1—8` 和旧存档；图鉴展示的是 17 个具体型号，玩家能直接比较 UMP45 / Vector / UZI，而不是只看“冲锋枪”。

### 4.2 图鉴与训练联动

`lastTrainingWeaponId` 保存上次试枪：

- 图鉴里该卡显示“当前试枪”；
- 点“用此枪训练”进入训练场时使用该 id；
- 训练中按 `1—8` 会切回类别枪，并更新该记录；
- 返回图鉴时保留选择。

## 5. 训练场

### 5.1 入口

- 主菜单“自由练习” → 训练场。
- 图鉴“用此枪训练” → 指定具体型号。
- 训练内 `1—8` 热键 → 类别枪。

### 5.2 1—8 热键

`WEAPON_SLOTS` 固定顺序：

| 键 | 武器 |
| --- | --- |
| 1 | 基础手枪 |
| 2 | 冲锋枪 |
| 3 | 突击步枪 |
| 4 | 霰弹枪 |
| 5 | 狙击枪 |
| 6 | 火箭筒 |
| 7 | 加特林 |
| 8 | 重炮狙击枪 |

切枪会补满弹匣 / 备弹、重置换弹，但不重置当前射击冷却（防止免费连发）。

### 5.3 训练任务

训练场有六项任务：

1. 移动。
2. 二段跳。
3. 穿台。
4. 命中假人。
5. 把假人击出平台。
6. 投弹。

任务只记录完成，不计入正式战绩；训练无限时、无限生命，假人 0.5 秒回场。

### 5.4 具体型号预选

`startTrainingWeapon(weaponId)` 让训练角色直接拿具体型号（例如 AKM），而不是类别别名。这样玩家可以在图鉴里选“S1897”后立刻感受泵动霰弹，不需要先按 4 再猜。

## 6. 反馈闭环

这一轮用户反馈的路径：

```text
试玩 → 发现手枪太小 / 子弹不像枪口 / 威力不对
→ 调整 MODEL_SCALE / weaponMuzzle / knockback / impulseCap
→ 图鉴与 HUD 显示新数值
→ 训练场按 1—8 或图鉴选具体型号验证
→ 自动化测试 + Chrome smoke
```

UI 的作用不是“好看”，而是让数值改动**可验证**：

- 图鉴立刻显示新弹匣 / 换弹 / 击退。
- HUD 立刻显示自动换弹倒计时。
- 训练场立刻能对比 17 个型号的手感。
- 截图 / smoke 作为交付证据。

## 7. 相关文件

- `src/ui/GameUI.ts`：HUD、图鉴、对话框、按钮。
- `src/app/GameApplication.ts`：模式切换、训练入口、图鉴回调。
- `src/content/weapons.ts`：`ARMORY_WEAPONS`、`WEAPON_SLOTS`、`weaponRole`、威力函数。
- `src/presentation/WeaponArt.ts`：`createWeaponIconCanvas`。
- `src/game/systems/TrainingSystem.ts`：训练任务 / 重置。
- `tests/training.test.ts`、`tests/weapons-models.test.ts`、`scripts/smoke.mjs`。

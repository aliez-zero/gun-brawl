# 模块四：枪口与弹道表现

代码入口：`src/content/weapons.ts`（`weaponMuzzle`）、`src/game/systems/CombatSystem.ts`、`src/presentation/ArenaRenderer.ts`
测试入口：`tests/muzzle.test.ts`
证据：`artifacts/muzzle-shot.png`、`artifacts/rocket-tracer.png`

## 1. 模块职责

这个模块解决三件事：

1. 子弹从**枪口**出发，而不是从胸口。
2. 枪口火光、弹道拖尾、弹丸本体使用同一个起点。
3. 不同威力的枪，弹道粗细、长度、颜色、弹体形态明显不同。

它不决定伤害 / 击退，只决定表现和起点。

## 2. 旧实现的根因

旧 `CombatSystem` 对所有枪写死：

```ts
const position = {
  x: actor.position.x + actor.facing * 27,
  y: actor.position.y - 28,
};
```

这个点位于角色胸口。手枪、冲锋枪、步枪、狙击、火箭全从这里出弹，长枪看起来像从身体中间吐子弹。

同时 `ArenaRenderer` 所有弹丸都是同一条：

```ts
lineStyle(7, 0xffd38a, 0.18)
lineStyle(2.5, 0xffefbf, 1)
```

手枪和重炮视觉上完全没有区别。

## 3. 逐型号枪口

### 3.1 数据

`weaponMuzzle(id)` 返回**朝右时相对脚底**的枪口点：

| 类别 | 型号 | X | Y |
| --- | --- | --- | --- |
| 手枪 | P92 | 33 | -36 |
| 手枪 | P1911 | 31 | -36 |
| 手枪 | Deagle | 34 | -36 |
| 冲锋枪 | UMP45 | 44 | -37 |
| 冲锋枪 | Vector | 43 | -37 |
| 冲锋枪 | UZI | 42 | -37 |
| 步枪 | M416 | 62 | -37 |
| 步枪 | AKM | 64 | -37 |
| 步枪 | SCAR-L | 64 | -37 |
| 霰弹 | S686 | 63 | -38 |
| 霰弹 | S1897 | 65 | -38 |
| 霰弹 | S12K | 61 | -38 |
| 狙击 | Kar98k | 71 | -38 |
| 狙击 | M24 | 71 | -38 |
| 狙击 | AWM | 72 | -38 |
| 火箭 | RPG-7 | 73 | -37 |
| 火箭 | AT4 | 74 | -37 |

类别别名使用 `FAMILY_MUZZLE`：

```text
pistol 33/-36, smg 43/-37, rifle 63/-37, shotgun 64/-38,
sniper 71/-38, rocket 73/-37, gatling 72/-37, cannon 79/-38
```

### 3.2 换算方式

这些值不是随便填的，而是从 160×80 美术稿换算：

```text
世界偏移 = (美术枪口坐标 - grip坐标) × 型号世界 scale
```

例如 AKM：

```text
枪口美术 x ≈ 156，grip x = 46
(156 - 46) × 0.41 ≈ 45
加上角色握把 x=22 → 约 67 (数据用 64)
y：枪管中心约 34，grip y=46
(34 - 46) × 0.41 ≈ -4.9
加上角色 grip y=-32 → 约 -37
```

所以枪口高度集中在 `-36—-38`，水平距离随枪管长度从 31 到 79 变化。

### 3.3 朝左镜像

```ts
const muzzle = weaponMuzzle(weapon.id);
const position = {
  x: actor.position.x + actor.facing * muzzle.x,
  y: actor.position.y + muzzle.y,
};
```

- 朝右：`x + muzzle.x`
- 朝左：`x - muzzle.x`
- Y 不变（枪口高度相同）

## 4. 所有发射物共用枪口

`CombatSystem` 现在只在开火时算一次 `position`，然后：

- 霰弹的每一颗弹丸都从同一个枪口点出发，再用扇形角度散开。
- 火箭从枪口点出发。
- `shot` 事件 `position` 使用同一个点。
- `ArenaRenderer` 的枪口火光用 `event.position`。

因此：

```text
子弹起点 = 弹丸轨迹起点 = 枪口火光位置 = sprite 枪管末端附近的枪口点
```

## 5. 拖尾不穿过枪管

### 5.1 问题

弹丸在生成当帧就会向前推进。如果拖尾直接按固定长度往反方向画，第一帧的拖尾会从枪口往角色身体方向延伸，看起来像从身体里出来。

### 5.2 解法：记录 origin

`Projectile` 增加可选：

```ts
origin?: Vec2
```

开火时写入：

```ts
position: { ...position },
previous: { ...position },
origin: { ...position },
```

渲染时：

```ts
const origin = projectile.origin ?? projectile.position;
const travel = hypot(x - origin.x, y - origin.y);
const back = min(style.length, travel);
```

拖尾最多画到枪口，不会退到枪口后方。

### 5.3 为什么不用 `previous`

`previous` 每帧都会更新为上一帧位置；到第二帧时它已经不是枪口。`origin` 是**整个飞行过程不变的枪口起点**，所以能持续限制拖尾不穿过枪口。

## 6. 按威力分档的弹道

`ArenaRenderer` 的 `TRAIL_STYLES`：

| family | 宽度 | 长度 | 主色 | 光晕 |
| --- | --- | --- | --- | --- |
| pistol | 1.5 px | 7 | `0xfff1c4` 淡黄 | `0xffcf78` |
| smg | 1.8 px | 9 | `0xffe39a` | `0xffc45c` |
| rifle | 2.4 px | 15 | `0xffc766` 橙 | `0xff9a3d` |
| shotgun | 1.7 px | 8 | `0xffb56d` | `0xff7d3d` |
| sniper | 3.2 px | 28 | `0xd8f6ff` 青白 | `0x8fd9ff` |
| rocket | 2.4 px | 18 | `0xffd28a` | `0xff6a2d` |
| gatling | 1.8 px | 10 | `0xffdf8a` | `0xffb347` |
| cannon | 4.6 px | 38 | `0xfff4ef` 白 | `0xff4f68` 红 |

### 6.1 威力修正

```ts
boost = family === 'shotgun'
  ? 1
  : clamp(sqrt(weaponBurstImpulse(weapon) / 500), 0.8, 1.6)

width  = base.width  * boost
length = base.length * boost
glow   = base.glowWidth * boost
```

效果：

- P92 360 → boost 约 0.85，细短。
- M416 520 → boost 约 1.02。
- AKM 700 → boost 约 1.18。
- AWM 1500 → boost 约 1.6，长亮。
- 重炮 3400 → boost 1.6（封顶），宽而长。

霰弹不按总冲量放大，因为每颗弹丸很小；否则 6 颗弹丸会变成 6 条重炮轨迹。

### 6.2 颜色逻辑

- 手枪 / 冲锋枪：偏淡黄，视觉轻。
- 步枪 / 霰弹：橙色，中等。
- 狙击：青白，冷色、长。
- 重炮：白 + 红，最重。
- 火箭：橙红 + 弹体深色。

## 7. 火箭的专用表现

火箭不再画线条，而是：

1. 10 px 橙红尾焰光晕，向后 26 px。
2. 2.4 px 橙色火焰，向后 15 px。
3. 深色弹体圆点，半径 4 px，位于弹丸前方。
4. 1.2 px 亮黄弹体高光。

这样即使火箭速度慢，也能看出是一枚飞行物，而不是一颗黄色子弹。

## 8. 枪口火光

`drawMuzzle` 从 `shot` 事件位置绘制，按威力放大：

```ts
flashBoost = family === 'shotgun'
  ? 1.2
  : clamp(sqrt(weaponBurstImpulse(weapon) / 500), 0.85, 1.8)

radius *= flashBoost
```

不同家族形状：

- 手枪 / 冲锋枪：四向小火花。
- 步枪 / 霰弹：多向短火花。
- 狙击：水平长闪光 + 斜向副光。
- 火箭：橙红圆形尾焰 + 后向喷射。
- 加特林 / 重炮：圆形爆闪 + 六向射线，重炮颜色偏红。

火光寿命约 0.2 秒，因此正常截图不一定能捕捉到；它和弹丸起点一致。

## 9. 测试

`tests/muzzle.test.ts` 覆盖：

- 25 个 id（17 具体 + 8 别名）弹丸 `previous` / `origin` 与枪口数据一致。
- `shot` 事件位置与弹丸起点一致。
- 朝左时 X 取反、Y 不变。
- 所有枪口 `x > 25`、`y` 在合理范围。

测试通过说明“表现起点”和“模拟起点”没有分叉。

## 10. 常见坑

1. **只改 `shot` 事件，不改弹丸**：火光在枪口，子弹还在胸口。
2. **只改 `CombatSystem`，不改表现**：弹丸起点对了，拖尾仍可能往枪管后面画。
3. **朝左忘记镜像**：只改 right，left 仍从身体中间出弹。
4. **改枪模尺寸不更新枪口**：枪变长，枪口数据没变，子弹又从枪管中间出来。
5. **画布 3 倍采样没除**：枪口 / 尺寸整体偏移。
6. **火箭近身方向**：枪口前移后，贴脸爆炸的径向方向可能反向，需要 `direction` 修正。

## 11. 相关文件

- `src/content/weapons.ts`：`weaponMuzzle`、`FAMILY_MUZZLE`、`MODEL_MUZZLE`。
- `src/game/core/types.ts`：`Projectile.origin`、`ExplosionRequest.direction`。
- `src/game/systems/CombatSystem.ts`：枪口生成、火箭 direction。
- `src/presentation/ArenaRenderer.ts`：弹道、火箭弹体、枪口火光。
- `tests/muzzle.test.ts`：起点 / 镜像。

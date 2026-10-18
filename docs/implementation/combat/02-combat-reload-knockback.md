# 模块二：战斗、换弹与击退

代码入口：`src/game/systems/CombatSystem.ts`、`WeaponSystem.ts`、`ExplosionSystem.ts`
测试入口：`tests/reload.test.ts`、`tests/weapons.test.ts`、`tests/knockback.test.ts`、`tests/muzzle.test.ts`

## 1. 模块职责

这个模块负责把“武器数据 + 玩家输入”变成每帧的确定性结果：

- 冷却、射速和开火时机。
- 弹匣扣弹、自动换弹、手动换弹、耗尽回退。
- 单发 / 多弹丸 / 散布 / 火箭爆炸。
- 弹丸扫掠碰撞、实体阻挡、命中击退。
- 持枪者后坐力。
- 霰弹 / 狙击 / 火箭的冲量上限与出屏能力。
- 近距离火箭的爆炸方向修正。

它不负责绘制；只输出 `MatchState` 与 `BattleEvent`。

## 2. 每帧执行顺序

`CombatSystem.update(state, inputs, dt, events)` 对每个角色执行：

1. `fireCooldown = max(0, fireCooldown - dt)`。
2. 跳过死亡 / 淘汰角色。
3. `tickReload(actor, dt)`：推进换弹计时，完成时补弹。
4. 读取输入；没有输入则跳过。
5. `reloadPressed` 且 `startReload` 成功 → 推 `reload-start` 事件。
6. 不满足 `shootHeld` / 冷却为 0 / 不在换弹，则跳过。
7. 弹匣无弹：
   - 有备弹 → 开始换弹、推事件、本帧不开火；
   - 无备弹 → 回退基础手枪，并保留至少手枪冷却。
8. 有弹：
   - 消耗保护；
   - 设置 `fireCooldown = interval`；
   - 从**枪口**生成 1—N 颗弹丸；
   - 施加持枪者后坐力；
   - 推 `shot` 事件；
   - 扣 1 发；
   - 打空后立即自动换弹（见第 5 节）。
9. 处理所有弹丸的扫掠碰撞、爆炸、命中与射程耗尽。
10. 返回事件给 HUD / 音效 / 画面。

## 3. 开火条件

一帧能开火必须同时满足：

```text
actor.status === 'alive'
input.shootHeld === true
actor.fireCooldown <= 0
actor.reloadRemaining <= 0
hasAmmo(actor) === true   // 或本帧先进入换弹分支
```

`hasAmmo` 只检查弹匣：

- `ammoRemaining === null` → 无限弹，永远有弹；
- `ammoRemaining > 0` → 有弹；
- `ammoRemaining === 0` → 空仓，必须先换弹或回退。

## 4. 射速与冷却

### 4.1 冷却重置

开火后：

```ts
actor.fireCooldown = weapon.interval;
```

下一帧先减 `1/60`。因此实际冷却至少是**整帧**：

```text
实际间隔 = ceil(interval * 60) / 60
```

这也是为什么快速枪的 `.055` 实际是 4 帧 / 900 RPM，而不是理论 1091 RPM。

### 4.2 为什么不做分数冷却

曾经尝试每帧 `+= interval` 保留小数，会让空闲时冷却变成负数，导致首发 / 测试 / 切枪行为不稳定；最终采用“重置为 interval + 每帧 clamp 到 0”的确定性方案，并让内容表里的间隔对齐整帧。

### 4.3 切枪不重置冷却

`equipWeapon` 只替换武器实例和清除换弹，不修改 `fireCooldown`。这样：

- 拾取不能获得免费即时射击；
- 空仓回退手枪也要等当前冷却结束；
- 切枪后第一发仍遵守上一把枪留下的节奏。

## 5. 自动换弹

### 5.1 触发时机

开火扣弹后：

```ts
if (ammo !== null) {
  actor.weapon.ammoRemaining = ammo - 1;
  if (actor.weapon.ammoRemaining === 0) {
    if (reserve > 0) startReload(actor);     // 同一帧
    else revertToPistol(actor);              // 弹尽
  }
}
```

关键点：

- **不需要松开扳机**。
- **不需要再按一次开火**。
- 自动换弹和手动换弹共用 `reload-start` 事件、HUD 倒计时和音效。
- 如果 `reloadTime <= 0`，`startReload` 会立即完成（当前数据没有这种枪）。

### 5.2 手动换弹

`R` / P2 小键盘 `2` → `input.reloadPressed`：

```ts
if (input.reloadPressed && startReload(actor)) {
  events.push({ type: 'reload-start', ... });
}
```

`canReload` 条件：

```text
maxAmmo !== null
magazine !== null
magazine < maxAmmo
reserveRemaining > 0
reloadRemaining <= 0
```

所以满弹匣、无备弹、无限弹手枪、正在换弹都会被拒绝。

### 5.3 完成换弹

```ts
missing = max - magazine
loaded = min(missing, reserve)
ammo += loaded
reserve -= loaded
reloadRemaining = 0
```

备弹不足时部分装填，不会凭空补满。

### 5.4 弹尽回退

只有**弹匣和备弹都为空**才回退：

```ts
revertToPistol(actor);
actor.fireCooldown = max(actor.fireCooldown, BASIC_PISTOL.interval);
```

回退帧不会再生成一颗手枪弹；这是为了保持“最后一发之后必须有节奏”的规则。

## 6. 弹丸生成

### 6.1 枪口

```ts
const muzzle = weaponMuzzle(weapon.id);
const position = {
  x: actor.position.x + actor.facing * muzzle.x,
  y: actor.position.y + muzzle.y,
};
```

所有弹丸和 `shot` 事件都用这个点；不再使用旧固定值 `(27, -28)`。详见 [枪口与弹道表现](../presentation/04-muzzle-and-projectiles.md)。

### 6.2 霰弹扇形

```ts
pellets = max(1, floor(weapon.pellets))
spread = pellets === 1
  ? 0
  : ((index / (pellets - 1)) * 2 - 1) * weapon.spreadRadians
```

- 弹丸均匀覆盖 `[-spread, +spread]`。
- 不使用随机数，保证可复现。
- 一次扳机只扣 1 发弹，不按弹丸数扣。
- 后坐力只结算一次。

### 6.3 速度与方向

```ts
velocity = {
  x: cos(spread) * speed * facing,
  y: sin(spread) * speed
}
```

`facing` 只翻转 X；朝左时扇形仍围绕水平轴展开。

### 6.4 弹丸快照

弹丸在发射时冻结：

```ts
weaponId
position / previous / origin
direction
velocity
impulse
distanceRemaining
explosion?
impulseCap?
```

拾取 / 切枪不会改变已经在飞的弹丸。

## 7. 弹丸碰撞

每个绘制步内，弹丸向前移动 `speed * dt`，并做扫掠线段：

1. 对所有 `kind === 'solid'` 平台求交，取最近交点。
2. 对所有存活、非发射者的角色矩形求交，取更近的交点。
3. 如果命中平台：
   - 有爆炸 → 在平台交点爆炸；
   - 无爆炸 → 弹丸消失。
4. 如果命中角色：
   - 有爆炸 → 在角色交点爆炸；
   - 无爆炸 → 施加 `projectile.impulse`；
   - 保护中的角色不受伤，但弹丸仍会消失。
5. 无命中则更新位置与剩余射程；射程耗尽时有爆炸就爆炸，否则消失。

单向平台不挡弹；只有 `kind === 'solid'` 参与子弹阻挡。

## 8. 击退、冲量与衰减

### 8.1 命中不是扣血

命中只调用：

```ts
addImpulse(target, impulse.x, impulse.y, cap)
```

生命只由 `LifeSystem` 在角色完全出界时扣除。

### 8.2 冲量上限

普通弹默认：

```ts
cap = projectile.impulseCap ?? max(MOVEMENT.maxImpulse, hypot(impulse.x, impulse.y))
```

- `MOVEMENT.maxImpulse = 900`。
- 普通步枪 / 手枪的冲量小于 900，不会被截。
- 狙击 / 重炮 / 霰弹需要 `impulseCap` 才能保留完整单发。
- 每颗霰弹弹丸共享**整发上限**，否则逐颗累计时会被 900 截断。

### 8.3 为什么霰弹需要整发上限

假设 S686 6 颗弹丸、每颗 380：

```text
总冲量 = 6 * 380 = 2280
```

如果每颗都按默认 900 上限累计，最终只有 900，推距约 390 px，根本打不出屏幕。设置 `impulseCap: 2280` 后，目标可以累计到 2280，实测推距约 871 px。

### 8.4 有效推距

外力按 `impulseHalfLife = 0.3 s` 衰减。一次脉冲的总位移近似：

```text
distance ≈ impulse * 0.433
```

因此：

| 冲量 | 近似推距 |
| --- | --- |
| 900 | 390 px |
| 1600 | 693 px |
| 2400 | 1039 px |
| 2800 | 1212 px |
| 3400 | 1472 px |

实际还会受地面摩擦、平台边缘、角色输入、碰撞体宽度影响。

### 8.5 出屏判定

当前浏览器视口按 1280 宽设计，目标起点 x=750。只要推距 > 530 px，目标就越过右边缘：

```text
750 + 530 > 1280
```

`tests/knockback.test.ts` 直接断言：

```ts
expect(750 + s686).toBeGreaterThan(1280);
expect(750 + s1897).toBeGreaterThan(1280);
expect(750 + s12k).toBeGreaterThan(1280);
expect(750 + shotgun).toBeGreaterThan(1280);
expect(750 + rpg7).toBeGreaterThan(1280);
expect(750 + at4).toBeGreaterThan(1280);
expect(750 + rocket).toBeGreaterThan(1280);
```

### 8.6 当前实测

平地、目标无输入、2.5 秒：

| 武器 | 冲量 / 总推力 | 推距 |
| --- | --- | --- |
| P92 | 360 | 152 px |
| P1911 | 300 | 127 px |
| Deagle | 700 | 296 px |
| UMP45 | 420 | 178 px |
| Vector | 320 | 136 px |
| UZI | 320 | 136 px |
| M416 | 520 | 225 px |
| AKM | 700 | 296 px |
| SCAR-L | 640 | 271 px |
| S686 | 2280（全中） | 约 804 px |
| S1897 | 2800（全中） | 约 1162 px |
| S12K | 1800（全中） | 约 747 px |
| 通用霰弹 | 1700（全中） | 约 575 px |
| Kar98k | 1150 | 486 px |
| M24 | 1300 | 550 px |
| AWM | 1500 | 635 px |
| RPG-7 | 2400 爆心 | 约 925 px |
| AT4 | 2800 爆心 | 约 1073 px |
| 通用火箭 | 2400 爆心 | 约 925 px |

## 9. 后坐力

开火后：

```ts
addImpulse(actor, -facing * weapon.recoil, -(weapon.recoilY ?? 0))
```

- 水平后坐把角色往射击反方向推。
- 垂直后坐给一个小的向上冲量。
- 后坐力也受 `MOVEMENT.maxImpulse` 影响，但数值远低于 900。
- 高射速枪连续射击会把自己推走，这是设计的一部分。

## 10. 火箭爆炸

### 10.1 爆炸解析

`ExplosionSystem.resolve`：

1. 遍历存活、非保护角色。
2. 用角色中心 `feet.y - ACTOR_HEIGHT/2` 计算与爆心距离。
3. 超出半径跳过。
4. 实体平台阻挡则跳过。
5. 线性插值：

```text
t = min(1, distance / radius)
magnitude = centerImpulse + (edgeImpulse - centerImpulse) * t
```

6. 方向默认从爆心指向角色中心。

### 10.2 近距离直击方向修正

枪口前移后，火箭可能直接在目标身体内部 / 近边缘爆炸：

```text
爆炸中心在目标中心右侧几个像素
→ 径向方向会把目标往左推
```

现在 `ExplosionRequest` 增加可选 `direction`，火箭传入自己的速度方向。当目标中心距爆心 ≤ `ACTOR_WIDTH` 时，使用弹丸飞行方向作为推力方向，保证贴脸直击仍把目标推向前方。

炸弹仍不传 `direction`，保持径向爆炸。

### 10.3 自伤

`applyExplosionHits` 对使用者也会施加冲量，但不会覆盖既有的敌人归因，也不会把自伤记成击出。自伤是火箭的风险之一。

## 11. 边界情况清单

- 弹匣 0、备弹 > 0：自动换弹，不射空包。
- 弹匣 0、备弹 0：回退手枪，不在同帧补一发。
- 换弹中按开火：不射击，换弹继续。
- 换弹中切枪：换弹取消，新枪满弹。
- 拾取在开火同帧：该发仍属于旧枪，新枪下一步才可用。
- 保护中命中：弹丸消失，但不施加击退。
- 自身子弹：不命中自己。
- 火箭命中平台：在平台表面爆炸，仍可波及附近角色。
- 火箭射程耗尽：在终点爆炸。
- 霰弹部分弹丸命中：按实际命中数累计，仍受整发上限。
- 目标已出界：不再作为弹丸目标。

## 12. 相关测试

| 测试文件 | 覆盖 |
| --- | --- |
| `tests/reload.test.ts` | 最后一发自动换弹、手动换弹、备弹不足部分装填、无限弹拒绝、换弹禁射 |
| `tests/weapons.test.ts` | 注册表、切枪、补弹、霰弹弹道、火箭命中、射程耗尽、重炮、加特林、AI 射程 |
| `tests/knockback.test.ts` | 手枪 / 步枪 / 狙击 / 霰弹 / 火箭推距与出屏 |
| `tests/muzzle.test.ts` | 25 个 id 的弹丸起点、火光位置、左右镜像 |
| `tests/explosions.test.ts` | 爆炸解析、阻挡、保护、自伤归因 |
| `tests/map-combat.test.ts` | 地图内实际击出与回台 |

## 13. 扩展时的注意事项

1. 新的多弹丸武器必须同时设置 `pellets`、`spreadRadians`、`impulseCap`。
2. 新的爆炸武器必须考虑 `direction`、自伤和遮挡。
3. 新的高射速武器要先算整帧 RPM，再定 `interval`。
4. 不要用 HP 思路改击退；先测实际推距。
5. 不要在 `CombatSystem` 里写死枪口 / 尺寸；查 `weaponMuzzle` 与 `weaponDisplayScale`。

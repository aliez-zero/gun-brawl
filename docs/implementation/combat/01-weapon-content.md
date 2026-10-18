# 模块一：武器内容与平衡

代码入口：`src/content/weapons.ts`
测试入口：`tests/weapons-models.test.ts`、`tests/weapons.test.ts`、`tests/knockback.test.ts`

## 1. 模块职责

这个模块只负责**定义武器数据**，不推进时间、不生成弹丸、不扣弹：

- 17 个具体型号的完整参数。
- 8 个类别别名，兼容训练 `1—8`、旧存档和早期测试。
- 弹匣 / 备弹 / 换弹时间 / 单发击退 / 后坐 / 弹速 / 射程 / 弹丸数 / 散布 / 爆炸参数。
- 逐型号枪口偏移。
- CF 式定位标签与图鉴威力口径。
- 注册表、查找和实例化入口。

真正的开火、换弹、弹丸碰撞在 [`CombatSystem`](../../../src/game/systems/CombatSystem.ts) 与 [`WeaponSystem`](../../../src/game/systems/WeaponSystem.ts)；本模块是它们的纯数据来源。

## 2. 数据结构

`WeaponDefinition`（定义在 `src/game/core/types.ts`）的核心字段：

| 字段 | 含义 | 备注 |
| --- | --- | --- |
| `id` | 内部 id | 与 `WeaponId` 联合类型对应 |
| `name` | 显示名 | HUD / 图鉴 |
| `family` | 具体型号所属家族 | 如 `akm` 的 family 是 `rifle` |
| `tier` | `standard` / `ultimate` | 终极武器显示“终极 ·” |
| `interval` | 两发之间的冷却（秒） | 实际受 60 Hz 整帧量化影响 |
| `projectileSpeed` | 弹速，px/s | 火箭较慢 |
| `range` | 最大飞行距离，px | 与命中距离不同 |
| `knockback` | 单颗弹丸 / 单发推力 | 霰弹还要乘弹丸数，并受整发上限约束 |
| `recoil` / `recoilY` | 持枪者后坐冲量 | X 反向，Y 向上 |
| `maxAmmo` | 弹匣容量；`null` 为无限 | 手枪无限 |
| `reserveAmmo` | 备弹 | 初始携弹 = 弹匣 + 备弹 |
| `reloadTime` | 换弹秒数 | 自动 / 手动共用 |
| `pellets` | 每次扣扳机的弹丸数 | 霰弹 >1 |
| `spreadRadians` | 最大散布角 | 弹丸在 `[-spread, +spread]` 等分 |
| `explosion` | 火箭爆炸参数 | `radius / centerImpulse / edgeImpulse` |
| `impulseCap` | 单次命中的整发上限 | 防止多弹丸累计被 900 截断 |

`WeaponInstance` 保存运行时状态：

```ts
{
  definition: WeaponDefinition,
  ammoRemaining: number | null,
  reserveRemaining: number
}
```

`createWeapon(id)` 只负责按定义创建实例，不重置角色冷却。

## 3. 注册表与别名

### 3.1 17 个具体型号

`ARMORY_WEAPONS` 的顺序就是图鉴顺序：

```text
P92, P1911, Deagle,
UMP45, Vector, UZI,
M416, AKM, SCAR-L,
S686, S1897, S12K,
Kar98k, M24, AWM,
RPG-7, AT4
```

`WEAPON_MODELS` 注册除 P92 外的 16 个具体型号；P92 与 7 个类别名共用 `WEAPONS`。

### 3.2 8 个类别别名

| id | 名称 | 用途 |
| --- | --- | --- |
| `pistol` | 基础手枪 | 训练槽 1、复活 / 耗尽兜底、无限弹 |
| `smg` | 冲锋枪 | 训练槽 2、旧存档 |
| `rifle` | 突击步枪 | 训练槽 3 |
| `shotgun` | 霰弹枪 | 训练槽 4 |
| `sniper` | 狙击枪 | 训练槽 5 |
| `rocket` | 火箭筒 | 训练槽 6 |
| `gatling` | 加特林 | 训练槽 7、终极 |
| `cannon` | 重炮狙击枪 | 训练槽 8、终极 |

具体型号有 `family`，类别别名没有；因此 `weaponMuzzle`、`trailStyle` 等表现函数会先试用型号数据，再回退到 `family ?? id`。

### 3.3 查找 / 实例化

```ts
getWeapon(id)      // WEAPONS[id] ?? WEAPON_MODELS[id]，找不到直接 throw
createWeapon(id)   // createWeaponInstance(getWeapon(id))
```

这两个入口保证训练、HUD、图鉴、投放和旧存档都消费同一份数据。

## 4. 当前数值表

### 4.1 手枪

| 型号 | 弹匣 / 备弹 | 间隔 | 弹速 | 单发击退 | 后坐 X/Y | 射程 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P92 | ∞ / ∞ | 0.30 s | 1200 | 360 | 12 / 0 | 750 | — |
| P1911 | 7 / 28 | 0.20 s | 1150 | 300 | 20 / 3 | 620 | 1.4 s |
| Deagle | 7 / 21 | 0.46 s | 1450 | 700 | 52 / 12 | 820 | 1.7 s |

P92 是唯一无限弹；P1911 用射速换单发；Deagle 单发接近 AKM，但射速慢、后坐大。

### 4.2 冲锋枪

| 型号 | 弹匣 / 备弹 | 间隔 | 有效射速 | 弹速 | 单发击退 | 后坐 X/Y | 射程 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UMP45 | 25 / 100 | 0.075 s | 5 帧 / 720 RPM | 1150 | 420 | 8 / 2.5 | 560 | 1.6 s |
| Vector | 19 / 95 | 0.05 s | 3 帧 / 1200 RPM | 1050 | 320 | 5 / 1.5 | 430 | 1.5 s |
| UZI | 30 / 120 | 0.055 s | 4 帧 / 900 RPM | 1050 | 320 | 4 / 1 | 390 | 1.4 s |

三把枪的分工是：UMP 单发最高、Vector 射速最快、UZI 弹量最多且射程最短。

### 4.3 步枪

| 型号 | 弹匣 / 备弹 | 间隔 | 有效射速 | 弹速 | 单发击退 | 后坐 X/Y | 射程 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M416 | 30 / 120 | 1/12 ≈ 0.0833 s | 5 帧 / 720 RPM | 1350 | 520 | 14 / 4 | 860 | 1.8 s |
| AKM | 30 / 90 | 0.10 s | 6 帧 / 600 RPM | 1300 | 700 | 28 / 9 | 780 | 2.0 s |
| SCAR-L | 30 / 120 | 0.10 s | 6 帧 / 600 RPM | 1350 | 640 | 16 / 5 | 920 | 1.9 s |

M416 稳定、AKM 单发重、SCAR-L 射程远。三者都用 30 发弹匣和 120 发以内备弹。

### 4.4 霰弹枪

| 型号 | 弹匣 / 备弹 | 间隔 | 弹速 | 单丸击退 | 弹丸 / 散布 | 后坐 X/Y | 射程 | 整发上限 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S686 | 2 / 10 | 0.40 s | 1150 | 380 | 6 丸 / ±12° | 42 / 12 | 270 | 2280 | 2.2 s |
| S1897 | 5 / 25 | 0.85 s | 1150 | 400 | 7 丸 / ±10° | 38 / 10 | 300 | 2800 | 2.4 s |
| S12K | 5 / 25 | 0.40 s | 1200 | 360 | 5 丸 / ±10° | 32 / 8 | 250 | 1800 | 2.0 s |

整发上限 = 单丸击退 × 弹丸数，允许全中时把目标一枪推出屏幕。一次扳机只扣 1 发弹，后坐力也只结算一次。

### 4.5 狙击枪

| 型号 | 弹匣 / 备弹 | 间隔 | 弹速 | 单发击退 | 后坐 X/Y | 射程 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Kar98k | 5 / 20 | 1.00 s | 1850 | 1150 | 58 / 14 | 1250 | 2.2 s |
| M24 | 5 / 20 | 0.90 s | 1900 | 1300 | 52 / 12 | 1300 | 2.1 s |
| AWM | 5 / 15 | 1.25 s | 2050 | 1500 | 72 / 18 | 1450 | 2.6 s |

AWM 单发最高、射程最远、备弹最少；三把狙击的单发推距约 486 / 550 / 635 px，仍低于近距离霰弹和火箭直击。

### 4.6 火箭筒与终极武器

| 型号 | 弹匣 / 备弹 | 间隔 | 弹速 | 爆心 / 边缘 | 半径 | 射程 | 换弹 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RPG-7 | 1 / 3 | 1.20 s | 650 | 2400 / 680 | 170 | 950 | 2.8 s |
| AT4 | 1 / 2 | 1.40 s | 750 | 2800 / 800 | 160 | 1050 | 3.0 s |
| 加特林 | 100 / 100 | 0.06 s | 1500 | 单发 160 | — | 700 | 3.2 s |
| 重炮 | 1 / 2 | 2.40 s | 2200 | 单发 3400，上限 4000 | — | 1800 | 2.6 s |

加特林按 60 Hz 整帧实际约 4 帧一发（约 900 RPM），不是理论 1000 RPM；重炮是全场最高单发。

## 5. 平衡口径

### 5.1 本作没有 HP

`knockback` 不是伤害数字，而是**水平冲量**。角色出界才扣命，因此所有比较都用“推距 / 出屏”而不是“打掉多少血”。

### 5.2 CF 分工映射

| CF 直觉 | 本作实现 |
| --- | --- |
| 手枪是副武器 | P92 无限弹、单发低，负责兜底 |
| 冲锋枪高射速 | 720—1200 RPM，单发低，用持续火力压制 |
| 步枪 3—4 发 | 单发 520—700，射速中等 |
| 霰弹贴脸 | 多弹丸、短射程、全中可一枪出屏 |
| 狙击一发 | 单发 1150—1500，远距离改变站位 |
| 火箭范围重击 | 爆心 2400—2800，范围伤害 |
| 终极武器 | 加特林持续火力 / 重炮单发 3400 |

### 5.3 单发 / 持续威力口径

```ts
weaponBurstImpulse(weapon) =
  weapon.explosion
    ? weapon.explosion.centerImpulse
    : weapon.knockback * max(1, weapon.pellets)

weaponSustainedImpulse(weapon) =
  round(weaponBurstImpulse(weapon) / max(0.01, weapon.interval))
```

- 图鉴的“单发威力条”用 burst。
- “持续威力条”用 sustained。
- 这两个函数只用于展示和比较，不参与实际命中结算。

### 5.4 整帧射速约束

`CombatSystem` 每帧先减 `fireCooldown`，只有 ≤0 才允许开火；开火后重置为 `interval`。60 Hz 下冷却至少持续整数帧：

```text
实际间隔 = ceil(interval * 60) / 60 秒
实际 RPM = 60 / 实际间隔
```

因此：

- UMP45 `.075` → 5 帧 → 720 RPM。
- UZI `.055` → 4 帧 → 900 RPM。
- Vector `.05` → 3 帧 → 1200 RPM。
- M416 `1/12` → 5 帧 → 720 RPM。
- AKM / SCAR-L `.10` → 6 帧 → 600 RPM。

调射速时要把这个量化算进去；只改小数会出现“面板快、手感慢”。

## 6. 枪口偏移数据

每把枪有脚底相对的枪口点，朝右：

| 类别 | 型号 | 枪口 X | 枪口 Y |
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

类别别名通过 `FAMILY_MUZZLE` 回退。完整使用说明见 [枪口与弹道表现](../presentation/04-muzzle-and-projectiles.md)。

## 7. 初始携弹与换弹

- 初始弹匣 = `maxAmmo`。
- 初始备弹 = `reserveAmmo`。
- 总携弹 = 弹匣 + 备弹。
- 拾取 / 复活 / 训练补满会同时恢复两池。
- 换弹只从备弹补足弹匣差额；备弹不足时部分装填。
- 弹匣和备弹都为 0 才回退基础手枪。
- P92 `maxAmmo` 为 `null`，永远不进入换弹。

## 8. 扩展新枪的检查清单

1. 在 `WeaponDefinition` 中填全参数，尤其 `family`、`maxAmmo`、`pellets`、`spreadRadians`。
2. 加入 `WEAPON_MODELS`（或 `WEAPONS`）和 `ARMORY_WEAPONS`。
3. 给 `WEAPON_ROLES` 写定位标签。
4. 如果不在类别别名覆盖范围，补 `FAMILY_MUZZLE` / `MODEL_MUZZLE`。
5. 在 `WeaponArt.ts` 加模型几何 / 配色 / `MODEL_SCALE`。
6. 如果多弹丸或高单发，补 `impulseCap`。
7. 加图鉴 / 击退 / 枪口回归。
8. 检查 `weaponBurstImpulse` 与 `weaponSustainedImpulse` 的层级是否合理。

## 9. 相关文件

- `src/content/weapons.ts`：数据、注册表、枪口、威力函数。
- `src/game/core/types.ts`：`WeaponDefinition` / `WeaponInstance` / `Projectile`。
- `src/game/systems/WeaponSystem.ts`：换弹、补满、回退。
- `src/game/systems/CombatSystem.ts`：消费武器数据。
- `src/ui/GameUI.ts`：图鉴与 HUD 展示。
- `tests/weapons-models.test.ts`：型号 / 弹匣 / 定位排序。
- `tests/weapons.test.ts`：注册表、霰弹、换弹、火箭、AI 射程。
- `tests/knockback.test.ts`：推距 / 出屏。

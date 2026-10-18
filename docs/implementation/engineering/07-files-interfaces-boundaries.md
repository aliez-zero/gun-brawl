# 模块七：文件、接口与边界

这份文档给接手的人用：改哪、调哪个接口、哪些不能碰、还有哪些没做完。

## 1. 文件地图

### 1.1 数据层

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `src/content/weapons.ts` | 17 型号 + 8 别名 + 枪口 + 威力函数 | `WEAPONS`、`WEAPON_MODELS`、`ARMORY_WEAPONS`、`WEAPON_SLOTS`、`weaponMuzzle`、`weaponBurstImpulse`、`weaponSustainedImpulse`、`weaponRole` |
| `src/game/core/types.ts` | 武器 / 弹丸 / 爆炸 / 输入 / 状态类型 | `WeaponDefinition`、`WeaponInstance`、`Projectile`、`ExplosionRequest`、`ActorInput` |

**不要**在 `content` 里做状态变更、时间推进或 Phaser 调用。

### 1.2 战斗层

| 文件 | 职责 | 关键函数 |
| --- | --- | --- |
| `src/game/systems/CombatSystem.ts` | 冷却、开火、弹丸、命中、火箭 | `update`、`explode` |
| `src/game/systems/WeaponSystem.ts` | 换弹 / 补满 / 回退 / 弹药检查 | `equipWeapon`、`refillWeapon`、`revertToPistol`、`hasAmmo`、`canReload`、`startReload`、`finishReload`、`tickReload` |
| `src/game/systems/ExplosionSystem.ts` | 爆炸解析 / 应用 | `ExplosionSystem.resolve`、`applyExplosionHits` |
| `src/game/core/math.ts` | 冲量、线段扫掠、AABB | `addImpulse`、`segmentRect`、`actorRect` |
| `src/game/core/constants.ts` | 固定步、最大冲量、角色尺寸 | `FIXED_STEP`、`MOVEMENT.maxImpulse`、`ACTOR_WIDTH/HEIGHT` |

### 1.3 表现层

| 文件 | 职责 |
| --- | --- |
| `src/presentation/WeaponArt.ts` | 3 倍 canvas、型号几何、表面细节、`MODEL_SCALE`、武器图标裁剪 |
| `src/presentation/WeaponLayer.ts` | 世界武器 sprite、origin / flip、持枪臂、握把手、支撑手 / 支撑臂 |
| `src/presentation/WeaponSupport.ts` | 握把手 / 支撑手 canvas |
| `src/presentation/CharacterMotion.ts` | 握把常量、武器姿态、角色帧 |
| `src/presentation/CharacterPainter.ts` | 角色 atlas 的手 / 前臂 |
| `src/presentation/ArenaRenderer.ts` | 弹道、火箭弹体、枪口火光、角色 / 地图绘制 |
| `src/presentation/SoundEffects.ts` | 逐型号射击 / 换弹音高 |

### 1.4 UI 层

| 文件 | 职责 |
| --- | --- |
| `src/ui/GameUI.ts` | HUD、图鉴、训练入口、暂停、结算、设置 |
| `src/app/GameApplication.ts` | 模式 / 场景 / 存档 / 训练 / 图鉴接线 |
| `src/game/systems/TrainingSystem.ts` | 训练任务和重置 |

### 1.5 测试

```text
tests/weapons-models.test.ts   型号 / 弹匣 / 定位 / 排序
tests/weapons.test.ts          八类别 / 霰弹 / 火箭 / 重炮 / AI
tests/reload.test.ts           自动 / 手动换弹
tests/knockback.test.ts        推距 / 出屏
tests/muzzle.test.ts           枪口 / 镜像 / origin
tests/explosions.test.ts       爆炸
tests/character-motion.test.ts 角色姿态
```

## 2. 接口契约

### 2.1 开火入口

```ts
CombatSystem.update(
  state: MatchState,
  inputs: ReadonlyMap<string, ActorInput>,
  dt: number,
  events: BattleEvent[],
): void
```

调用方只提供输入，不直接生成弹丸；所有冷却 / 扣弹 / 枪口 / 事件在内部完成。

### 2.2 换弹入口

```ts
startReload(actor): boolean
tickReload(actor, dt): boolean
finishReload(actor): void
canReload(actor): boolean
```

自动换弹和手动换弹共用这些函数；不要在 UI 或场景里另写一套计时。

### 2.3 枪口

```ts
weaponMuzzle(id: WeaponId): { x: number; y: number }
```

返回值相对脚底、朝右；调用方负责 `facing` 镜像。**不要**在 `CombatSystem` 里再写 `27/-28`。

### 2.4 尺寸

```ts
weaponDisplayScale(id: WeaponId): number
```

返回 Phaser sprite 的 scale（已除 3 倍采样）。如果新增武器，必须同时在 `MODEL_SCALE` 注册；否则回退到 `WEAPON_ART.displayScale`，尺寸会不对。

### 2.5 爆炸

```ts
interface ExplosionRequest {
  ownerId: string;
  source: 'bomb' | 'rocket';
  center: Vec2;
  radius: number;
  centerImpulse: number;
  edgeImpulse: number;
  direction?: Vec2; // 火箭直击方向
}
```

- 炸弹不传 `direction`，保持径向。
- 火箭传 `projectile.velocity`，近距离直击时避免反向推。
- `applyExplosionHits` 负责自伤和归因，不要在调用方重复加冲量。

## 3. 分层边界

```text
content  → 纯数据 / 查询
game     → 纯 TS 状态和系统，不依赖 Phaser / DOM
presentation → 消费状态 / 事件，绘制 / 音效
ui       → DOM，回调请求应用层
app      → 生命周期 / 保存 / 模式切换
```

必须保持：

- `game/**` 不能 import `phaser`。
- `presentation/**` 不能改角色位置 / 生命 / 胜负。
- `ui/**` 不能直接改 `MatchState`。
- 武器数值只改 `content/weapons.ts`，不要在表现层复制一份。
- 枪口数据在内容层，表现层和战斗层共用。

## 4. 扩展新武器步骤

### 4.1 数据

1. 在 `src/content/weapons.ts` 新增 `WeaponDefinition`。
2. 设 `family`、`tier`、`interval`、`projectileSpeed`、`range`、`knockback`、`recoil`。
3. 设 `maxAmmo` / `reserveAmmo` / `reloadTime`；无限弹用 `null`。
4. 多弹丸设 `pellets` / `spreadRadians`，并设整发 `impulseCap`。
5. 爆炸武器设 `explosion`；高单发设 `impulseCap`。
6. 加入 `WEAPON_MODELS` 或 `WEAPONS`。
7. 加入 `ARMORY_WEAPONS` 和 `WEAPON_ROLES`。
8. 在 `MODEL_MUZZLE` 或 `FAMILY_MUZZLE` 补枪口。

### 4.2 美术

1. 在 `WeaponArt.ts` 加型号几何 / 颜色 / 细节。
2. 在 `MODEL_SCALE` 加世界尺寸。
3. 检查 `weaponMuzzle` 是否和枪管末端一致。
4. 检查 `weaponBurstImpulse` 对应的弹道档位是否合理。
5. 截图检查左右持枪、枪口火光、弹道。

### 4.3 测试

至少补：

- 注册表 / 弹匣 / 换弹。
- 击退 / 出屏（如果是重武器）。
- 枪口起点。
- 图鉴排序 / 威力条。
- 训练选择。

## 5. 并行工作边界

当前工作区还有一套**未提交**的 Cowboy 骨架 / 外观编辑器改动：

- `src/presentation/characters/`
- `src/presentation/ArenaRenderer.ts` 的 rig 接线
- `CharacterArt.ts` / `CharacterPainter.ts` / `WeaponLayer.ts` / `ArenaScene.ts`
- `src/ui/appearance/`
- `AppearanceMotionPreview.ts`
- `tests/character-rig.test.ts`
- `docs/PARALLEL_PLAN.md`

本轮的 `ArenaRenderer.ts` 提交使用了隔离补丁，只包含：

- `weaponBurstImpulse` 导入
- 弹道样式
- 火箭弹体
- 枪口火光放大
- 拖尾 `origin` 裁剪

**没有**提交 Cowboy rig 接线。后续合并时：

- 不要用工作区整文件覆盖 `ArenaRenderer.ts`。
- 先合并 Cowboy 的 `CharacterView` / rig，再确认武器分支的 `projectile` 循环仍然存在。
- 冲突时保留两边：rig 负责角色，武器分支负责弹道。

## 6. 已知未完成

### 6.1 美术 / 音效

- 逐枪手绘换弹序列帧、拉栓、退弹匣。
- 逐枪枪口火光贴图（目前是 Graphics 程序化）。
- 真实音色素材（目前是 Web Audio 合成音高）。
- 其他四种身体的骨架迁移（Cowboy 之外）。

### 6.2 平衡

- 真人逐枪手感：S686 / S1897 / AT4 是否过强。
- 1280 之外分辨率下的“出屏”体感。
- 高射速枪连续后坐把自己推走是否过强。
- 通用类别枪与具体型号的差距是否合理。

### 6.3 工程

- `dist-weapon-preview` 是本地产物，不提交。
- 预览端口 4180 是临时验收，不是产品服务器。
- 工作区外部改动未合并，整体测试数量会随外部文件变化。
- 没有后端 / 联机 / 权威同步；全部是本地确定性模拟。

## 7. 交接建议

1. 先跑 `pnpm typecheck` / `pnpm test` / `pnpm build`。
2. 用 `4180` 独立构建验收，不要用旧的 `4173`。
3. 先看 [枪口与弹道表现](../presentation/04-muzzle-and-projectiles.md)，再碰 `CombatSystem`。
4. 改枪模尺寸必须同步枪口；改枪口必须跑 `tests/muzzle.test.ts`。
5. 改霰弹 / 火箭必须跑 `tests/knockback.test.ts`。
6. 提交前检查 `git status`，不要把并行 Cowboy / 外观工作带进去。

# 模块六：测试、构建与发布

本模块记录**怎么验证**和**交付了什么**，不重复武器设计。所有命令在 `D:\code\gun-brawl` 执行。

## 1. 验证分层

| 层级 | 工具 | 覆盖 |
| --- | --- | --- |
| 类型 | `tsc --noEmit` | 严格类型、接口、导入 |
| 单元 / 集成 | Vitest | 武器数据、换弹、击退、枪口、爆炸、地图、AI、存档 |
| 构建 | Vite | 生产 bundle |
| 浏览器 | Playwright smoke | 菜单、画布、键盘、训练、暂停、设置、双人、持久化 |
| 手动 | Chrome preview | 手感、枪模比例、弹道表现 |

## 2. 常用命令

```bash
# 类型
pnpm typecheck

# 全部 Vitest
pnpm test

# 只跑武器相关
pnpm exec vitest run tests/weapons.test.ts tests/weapons-models.test.ts \
  tests/reload.test.ts tests/knockback.test.ts tests/muzzle.test.ts

# 生产构建
pnpm build

# 独立预览构建（本轮使用）
pnpm exec vite build --outDir dist-weapon-preview
pnpm exec vite preview --host 127.0.0.1 --port 4180 --strictPort --outDir dist-weapon-preview

# Chrome smoke
GAME_TEST_URL=http://127.0.0.1:4180 pnpm test:browser
```

Windows PowerShell 设置环境变量：

```powershell
$env:GAME_TEST_URL='http://127.0.0.1:4180'
pnpm test:browser
```

## 3. 测试矩阵

### 3.1 武器数据

| 文件 | 关键断言 |
| --- | --- |
| `tests/weapons-models.test.ts` | 17 型号注册、弹匣 / 备弹 / 换弹、定位、单发 / 持续排序、训练预选、支撑手、投放池 |
| `tests/weapons.test.ts` | 8 类别别名、切枪、补弹、霰弹 5 弹道 / 单发扣弹、火箭命中 / 射程耗尽 / 爆炸快照、重炮、加特林、耗尽回退、AI 射程 |
| `tests/reload.test.ts` | 最后一发同帧自动换弹、手动换弹、备弹不足部分装填、无限弹拒绝、换弹禁射、备弹只扣一次 |
| `tests/knockback.test.ts` | 手枪 < 步枪 < 狙击；霰弹 / 火箭一枪出屏；通用型号 |
| `tests/muzzle.test.ts` | 25 个 id 的弹丸 / 火光起点；朝左镜像；`origin` 保存 |
| `tests/explosions.test.ts` | 爆炸中心 / 边缘衰减、保护、实体阻挡、自伤归因 |
| `tests/map-combat.test.ts` | 地图内实际击出、回台、四场景 |
| `tests/character-motion.test.ts` | 角色帧、持枪姿态、移动 / 换弹 |

### 3.2 本轮关键回归

1. **自动换弹**
   - 最后一发后立即 `reloadRemaining > 0`；
   - `reload-start` 事件带正确 `weaponId`；
   - 松开扳机也能完成。

2. **出屏**
   - 目标 x=750，视口 1280；
   - S686 / S1897 / S12K / 通用霰弹 / RPG-7 / AT4 / 通用火箭均满足 `750 + push > 1280`。

3. **枪口**
   - 每把枪的 `projectile.previous` = `origin` = 枪口；
   - `shot.position` 与弹丸起点一致；
   - 朝左 X 取反。

4. **手枪比例**
   - 浏览器截图确认手枪约 58—64 px，不再是 43—51 px 的小点。

## 4. 本轮实际结果

最后一次完整回归快照：

```text
Test Files  24 passed (24)
Tests       215 passed (215)
tsc         passed
build       passed
smoke       passed
```

> 工作区后来并行加入了 Cowboy 骨架测试（`tests/character-rig.test.ts` 等），全项目会变成 25 文件 / 221 项左右；那是另一条未提交工作线，不属于本模块的提交范围。

### 4.1 浏览器 smoke 覆盖

`scripts/smoke.mjs` 当前验证：

- 主菜单“进入战场”可见 / 可点。
- `#game-canvas canvas` 存在且键盘移动改变画面。
- 训练模式、倒计时隐藏、开火。
- 暂停 / 恢复、失焦暂停。
- 设置音量、减少震动。
- 本地双人、重开、返回菜单。
- 刷新后设置持久化。
- localStorage 被阻塞时显示“本地保存不可用”，不崩溃。

### 4.2 额外浏览器验证

本轮额外做了两个临时 Playwright 检查（不提交脚本）：

1. **自动换弹 HUD**
   - 训练场按 `6` 切火箭筒；
   - 开一枪；
   - HUD 立即显示 `火箭筒 · 0/3 · 换弹 2.1s · 炸弹 2`。

2. **火箭弹体渲染**
   - 训练场发射火箭；
   - 页面无 `pageerror`；
   - 看到橙色尾焰 + 深色弹体，而不是单根黄线。

## 5. 构建与预览

### 5.1 为什么单独建 `dist-weapon-preview`

工作区同时有其他并行构建 / 旧预览占用 `4173`，为了不让用户看到旧 bundle：

```bash
vite build --outDir dist-weapon-preview
vite preview --host 127.0.0.1 --port 4180 --strictPort --outDir dist-weapon-preview
```

- `dist-weapon-preview` 是独立产物。
- `4180` 是独立端口。
- 用户地址带版本参数 `?v=20261018i` 绕过缓存。
- `dist-weapon-preview/` 不提交到 Git（本地构建产物）。

### 5.2 构建失败排查

- `TS1490 File appears to be binary`：不要用 PowerShell `Set-Content` 直接改中文 TS 文件；用编辑器 / 文件工具。
- Vite 4173 页面旧：检查实际 `index.html` 的 asset hash，不要假设端口对应新构建。
- Playwright 找不到按钮：先确认服务是否为新 dist，再检查 smoke 的 localStorage 隔离上下文。

## 6. 提交记录

本轮武器 / 战斗 / 表现相关提交（从旧到新）：

| 提交 | 内容 |
| --- | --- |
| `2ee931a` | CF 式角色分工与人物尺度模型 |
| `7d91064` | SMG 射速整帧对齐、左右镜像模型 |
| `5dddd7e` | 3 倍画布缩放修正、镜像 grip origin |
| `defc300` | 持枪轮廓可读、手枪 / 枪身尺寸 |
| `fb4c437` | 前景持枪臂、武器表面细节 |
| `0467a75` | 自动换弹、霰弹 / 火箭一枪出屏 |
| `5837f7c` | 逐型号枪口、弹丸 / 火光同点 |
| `09f0b38` | 按威力分档弹道、手枪放大 |
| `3cf8707` | 拖尾裁剪到枪口 origin |

远端验证：

```text
local  = 3cf8707
origin = 3cf8707
```

### 6.1 未提交内容

以下属于并行工作，**不在本轮提交**：

- `src/presentation/characters/`（Cowboy 骨架）
- `ArenaRenderer.ts` 的 Cowboy rig 接线
- `CharacterArt.ts` / `CharacterPainter.ts` / `WeaponLayer.ts` / `ArenaScene.ts` 的并行改动
- `src/ui/appearance/`、`AppearanceMotionPreview.ts`
- `tests/character-rig.test.ts`
- `docs/PARALLEL_PLAN.md`
- `dist-weapon-preview/`

`ArenaRenderer.ts` 的提交采用了**隔离补丁**：只把武器弹道 / 枪口 / 拖尾改动写入 index，没有把工作区的 Cowboy 接线一起提交。后续合并时不要整文件覆盖。

## 7. 发布检查清单

- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 全绿。
- [ ] `pnpm build` 通过。
- [ ] 独立预览 `4180` 加载新 asset hash。
- [ ] Chrome smoke 通过。
- [ ] 手动试：手枪比例、左右持枪、枪口、自动换弹、霰弹 / 火箭出屏。
- [ ] 确认没有把并行 Cowboy / 外观工作带入提交。
- [ ] `git status` 中只剩已知的外部改动。
- [ ] `git push origin main` 成功，`origin/main` 与本地一致。

## 8. 本轮未完成的验证

- 真人逐枪手感平衡（尤其 S686 / S1897 / AT4 是否过强）。
- 1280 之外的自定义分辨率下“出屏”感知。
- 手绘换弹 / 枪口火光帧、真实音色素材。
- 外观 / 骨架并行工作合并后的整体回归。

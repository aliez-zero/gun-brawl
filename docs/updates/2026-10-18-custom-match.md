# T07 交付：自定义 2—4 人对局

更新：2026-10-18（北京时间）。状态：核心完成；完整 4 人淘汰 / 观战 / 加时实战验收仍待 T11。负责人：当前会话。工作区：`D:\code\gun-brawl`（`main`）。

## 实际交付

### 配置模型

- 菜单新增第 4 个模式“自定义对局”；点击“配置对局”打开配置面板。
- 支持：
  - 地图：四张已注册地图。
  - 人数：2—4 个参战槽位；槽位 1 固定玩家 1，槽位 2 可选玩家 2 / AI / 关闭，槽位 3—4 可选 AI / 关闭。
  - 本地玩家：最多两名，输入槽位不能重复，玩家 1 必须参战。
  - AI：每个 AI 槽位独立选择简单 / 普通 / 困难。
  - 生命：1—9 条。
  - 时限：30—600 秒。
  - 武器池：全部（含终极）/ 仅标准 / 关闭特殊投放。
- 共享 `validateCustomMatch` 同时供 UI、应用和测试使用；非法地图 / 人数 / 槽位 / 人类重复 / 数值越界会显示错误并禁用开始。
- 标准池显式排除加特林和重炮；关闭投放时 `DropSystem` 使用空池，不生成箱子。

### 接入

- `GameMode` 增加 `custom`；`MODE_LABELS`、存档 `lastMode`、结算 / 战绩均识别自定义模式。
- `createCustomMatchConfig` 构建 2—4 个角色，保持玩家 1 / 玩家 2 ID 与输入槽位，AI 使用 `bot-1…3` 和逐槽难度。
- 4 人 HUD 使用紧凑卡片，计时器不再和卡片重叠；自定义模式显示“自定义对局”。
- 重赛复用 `SaveData.customMatch`，不会退回训练台。
- 最近配置写入现有 v1 存档 `customMatch`，旧档 / 损坏配置自动补默认。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **162 项 / 16 文件**通过（新增 match-config 6 项；含 4 人构建、2 人类 + 2 AI、校验、标准池、关闭投放、存档归一） |
| `pnpm build` | 通过 |
| 浏览器 smoke | 通过（四模式入口、设置、训练、暂停、双人、刷新、禁用存储） |
| 浏览器自定义实测 | 空槽位时显示“实际参战人数需为 2—4”且开始禁用；配置为 P1 + P2 + 简单 AI + 困难 AI、5 命、60 秒、霓虹天际后成功开局，HUD 显示 4 张角色卡；暂停重赛后仍为 4 人 / 01:00；存档 `lastMode=custom` 且槽位 / 难度完整 |
| 移动端 | 390 宽自定义配置无横向溢出；4 人 HUD 紧凑布局仍待专门验收 |
| 截图 | `artifacts/custom-setup.png`、`artifacts/custom-setup-4p.png`、`artifacts/custom-match-4p.png` |

## 变更文件

- `src/content/matches.ts`：自定义配置类型、默认值、校验、归一、构建器；`MODE_LABELS` 四模式。
- `src/game/core/types.ts`、`BattleSimulation.ts`、`src/content/drops.ts`：`custom` 模式、`dropMode`、标准池。
- `src/ui/GameUI.ts`、`src/style.css`：菜单第 4 模式、配置表单、实时校验、4 人紧凑 HUD。
- `src/app/GameApplication.ts`：自定义开始 / 重赛 / 最近配置保存。
- `src/storage/SaveStore.ts`：`customMatch` 字段与容错。
- `tests/match-config.test.ts`（新）、`tests/storage.test.ts`。
- README、ARCHITECTURE、DEVELOPMENT、PARALLEL_PLAN、T07 模块。

## 仍待

1. 完整 4 人淘汰、观战到结算、多人加时和重赛的人工实战验收。
2. 配置页“返回”目前回主菜单；未开始编辑的选择不会单独保留，只有开始后写入最近配置。
3. 4 人移动端 HUD 需要专门紧凑布局；当前桌面 1440 已验证。

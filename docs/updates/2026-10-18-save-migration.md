# T12 交付：v2 迁移、清档与有界结果去重

更新：2026-10-18（北京时间）。状态：核心完成；战役字段保留给 T09。负责人：当前会话。工作区：`D:\code\gun-brawl`（`main`）。

## 实际交付

### v1 → v2 迁移

- `SaveData.version` 升为 `2`，**继续使用原 key `gun-brawl:save:v1`**，不换命名空间、不清空旧档。
- 读取 `version: 1` 与 `version: 2`；音量、震动、模式、统计、最后结果、地图、两位玩家外观 / 键位、自定义对局、训练完成逐项迁移。
- v1 只有 `lastResultId` 时，把它放入 `recentResults` 作为第一条历史。

### 清档

- 设置面板新增“清除本地存档”，使用浏览器确认框。
- `SaveStore.clear()` 删除 `gun-brawl:save:v1`，把音量、震动、模式、统计、结果、地图、外观、键位、自定义对局、训练完成和最近结果全部恢复默认；随后写回默认档。
- 应用清档后回到主菜单，立即应用默认键位 / 音量 / 减少震动，并提示“本地存档已清除”；存储不可写时内存默认值仍可用。

### 有界结果去重

- 新增 `recentResults`，最多 20 个结果 ID。
- `recordResult` 跳过训练；窗口内相同 ID 不再增加场次 / 胜场；交错重复 `A → B → A` 只计 2 场；相同种子但新 `matchId` 正常计新局。
- 明确边界：这是 **20 条有界去重**，不是任意历史去重；更久以前的重复 ID 不保证识别。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **168 项 / 16 文件**通过；`tests/storage.test.ts` 13 项 |
| `pnpm build` | 通过 |
| 浏览器清档 | 设置里清档确认后回到菜单，toast “本地存档已清除”，存档 `version=2`、音量 0.35、`recentResults=[]` |
| 截图 | `artifacts/clear-save.png` |

## 变更文件

- `src/storage/SaveStore.ts`：v2、迁移、`recentResults`、窗口去重、`clear()`。
- `src/ui/GameUI.ts` / `src/style.css`：清档按钮与确认。
- `src/app/GameApplication.ts`：清档后应用默认键位 / 音量 / 震动并回菜单。
- `tests/storage.test.ts`：迁移、交错重复、训练排除、清档。
- 文档：T12 模块、DEVELOPMENT、ARCHITECTURE、PARALLEL_PLAN、README、docs/README。

## 仍待

1. 战役配置 / 成绩 / 解锁字段（依赖 T09）。
2. 清档后是否保留当前对局选择；当前直接回主菜单。
3. 任意历史去重不做；若未来需要，需单独设计持久历史表并接受容量成本。

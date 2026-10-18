# T06 交付：可改键设置与持久化

更新：2026-10-18（北京时间）。状态：功能完成；独立录键组件尚未拆分。负责人：当前会话。工作区：`D:\code\gun-brawl`（`main`）。

## 实际交付

### 键位模型

- `src/content/controls.ts`：
  - `DEFAULT_KEY_BINDINGS` 与 `KeyBindings` / `ControlAction`；两名玩家各 7 个动作：左移 / 右移 / 跳跃 / 穿台 / 开火 / 换弹 / 投弹。
  - `rebind` 替换单个动作的实际按键；`validateCode` 检查同玩家重复、跨玩家冲突、系统 / 训练保留键（Esc、Tab、F5 / F11 / F12、修饰键、Digit1—8）。
  - `normalizeBindings` 对旧档 / 损坏映射做容错；冲突或非法时回退默认。
  - `keyLabel` 统一键盘码显示（KeyU → U、Numpad2 → 小键盘 2、方向键 → 箭头）。

### 输入与接线

- `KeyboardInput` 构造时接收实际映射，`setBindings` 更新允许键集合并清空旧按下状态。
- `ArenaScene` 启动时接收存档映射，运行中改键立即同步；`GameApplication` 负责写入 `SaveStore`。
- 设置面板：
  - 点击任意键位进入录键状态，按下新键即保存；Esc 取消。
  - 冲突显示具体占用者（例如“← 已被玩家 2 的「左移」占用”），不写入。
  - “恢复默认”一键复原；设置保存后刷新 / 重开仍保留。
  - 帮助弹窗与底栏读取实际映射，不再写死默认键。

### 存档

- `SaveData.bindings` 写入现有 `gun-brawl:save:v1`，不提升版本；旧档无该字段自动补默认。
- 损坏或跨动作冲突的映射回退默认，其他设置 / 外观 / 战绩不受影响。

## 验证

| 检查 | 结果 |
| --- | --- |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **150 项 / 14 文件**通过（新增 bindings 5 项、运行时映射、存档持久化 / 回退） |
| `pnpm build` | 通过 |
| 浏览器 smoke | 通过；设置、刷新保存、暂停 / 恢复、训练、双人、禁用存储均正常 |
| 改键实测 | P1 开火改为 U 后，游戏中按 J 不再开火，按 U 正常把冲锋枪从 30/90 打到 28/90 |
| 冲突实测 | P1 开火尝试绑定 ← 时提示被玩家 2 左移占用，未保存 |
| 布局 | 1440 / 390 宽实测，无横向溢出；390 宽改为单列键位并可在面板内滚动；截图 `artifacts/settings-bindings.png`、`artifacts/settings-bindings-mobile.png` |

## 变更文件

- `src/content/controls.ts`：默认映射、校验、克隆 / 容错、显示名。
- `src/storage/SaveStore.ts`：`bindings` 字段与旧档修复。
- `src/presentation/KeyboardInput.ts`、`src/scenes/ArenaScene.ts`、`src/app/GameApplication.ts`：实际映射接入。
- `src/ui/GameUI.ts`、`src/style.css`：设置面板、录键状态、冲突提示、恢复默认、响应式布局。
- `tests/bindings.test.ts`（新）、`tests/keyboard.test.ts`、`tests/storage.test.ts`。
- T06 模块、README、DEVELOPMENT、ARCHITECTURE、并行看板。

## 仍待

1. 录键 UI 仍内嵌 `GameUI`，尚未拆成独立 `ui/controls` 组件。
2. 没有手柄 / 鼠标侧键绑定和按键预览动画。
3. 改键面板仍需人工做 1024 / 720 宽度视觉复核；1440 / 390 已实测，smoke 通过。

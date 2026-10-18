# 质量与验收记录

更新：2026-10-18（北京时间）。对应 T11；环境：Windows、Chrome headless / 软件 SwiftShader（浏览器证据），Node 24.19、Vitest 4.1.12、Vite 7.3.7。当前状态：自动化主流程通过；真实显卡性能、Edge、硬件键位人工验收未完成。

## 一键检查

```text
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser   # 需要预览服务与 Chrome
pnpm test:perf      # 软件 WebGL RAF / 堆；不是参考 GPU
```

2026-10-18 软件 WebGL 实测（Chrome headless + SwiftShader，1440×1080，local-duel 6 秒 + 连续 20 局重赛）：**289 帧、平均 20.73 ms、p95 30 ms、约 48.2 FPS、画布 1280×720**；JS 堆 **32.2 → 34.6 MiB**（每 4 局采样：32.2 / 33.4 / 34.2 / 32.7 / 32.5 / 34.6），未观察到持续增长。这是软件渲染参考，不能当作真实显卡 60 FPS 结论；p95 已超过 16.7 ms。

2026-10-18 结果：类型检查通过；**183 项 / 19 文件**通过；构建通过；浏览器 smoke 通过（菜单、画布、键盘、训练、暂停 / 恢复、失焦、设置、双人、重赛、刷新、禁用存储）。

## 覆盖矩阵

| 范围 | 自动化证据 | 手工 / 待测 |
| --- | --- | --- |
| 移动 / 二段跳 / 穿台 / 复活 | `simulation.test.ts`、`map-routes.test.ts`、`map-combat.test.ts` | 最低视口与硬件键位 |
| 射击 / 击退 / 保护 / 同帧淘汰 | `simulation.test.ts`、`weapons.test.ts`、`quality.test.ts` | 四名真人同帧出界 |
| 四图路线 / 投放 / 气闸 | `map-routes.test.ts`、`map-combat.test.ts`、`maps-appearance.test.ts` | 四人多角色竞速 |
| 17 型号 / 弹匣 / 终极 | `weapons.test.ts`、`weapons-models.test.ts` | 逐枪手绘动作 / 真实音色 / 人工平衡 |
| 炸弹 / 爆炸 | `explosives.test.ts`、`ai.test.ts` | 暂停时引信冻结人工复核 |
| AI 三档 / 导航 | `ai.test.ts`、`map-routes.test.ts` | 困难档完整人工对局 |
| 自定义 2—4 人 | `match-config.test.ts`、`quality.test.ts` | **2 真人 + 2 AI 完整 1 命 / 30 秒局实测到加时结算，AI 2 获胜，重赛仍 4 人**；4 真人不可 |
| 训练 / 图鉴 | `training.test.ts`、`storage.test.ts` | 命中 / 击出假人人工 |
| 战役 | `campaign.test.ts` + 浏览器关卡页 / 开局 | 六关完整平衡 |
| 存档 / 迁档 / 清档 | `storage.test.ts` + 浏览器清档 | 跨浏览器 profile |
| 四人淘汰 / 加时 | `quality.test.ts` + 浏览器完整 4 人局 | 四人同帧出界、4 真人观战体验 |
| 暂停 / 失焦 / 设置 | 浏览器 smoke | 多显示器 / 手柄 |
| 性能 / 资源 | 20 局四人纯模拟耗时守卫（<5s）+ 软件 WebGL 6 秒 RAF / 堆 + 连续 20 局重赛堆采样 | **软件渲染 48.2 FPS / p95 30 ms / 堆 32.2→34.6 MiB；无参考机、无真实 GPU** |

## T11 新增

- 浏览器 4 人完整局：2 真人 + 2 AI、1 命、30 秒、标准池；AI 2 在加时获胜，结果含 4 名参战者，重赛仍为 4 人（`artifacts/custom-4p-result.png`）。
- `tests/quality.test.ts`：
  - 四人中一人出界后淘汰，剩余一人时结算且结果含 4 名参战者；
  - 多人进入加时，最后存活者获胜且 `overtime=true`；
  - 新局复用四槽身份但独立计时 / 无旧结果残留。

## 已知风险

1. **性能未验收**：软件渲染冒烟只证明流程可跑，不能作为真实显卡帧率 / 输入延迟结论。
2. **Edge 与硬件键位未测**：当前浏览器证据为 Chrome headless。
3. **四人真人不可自动覆盖**：只有 2 真人 + 2 AI；同帧出界 / 观战仍需人工。
4. **17 个型号已实现程序化外观**：逐枪手绘换弹 / 火光帧与真实音色仍未完成。
5. **AI 多人战术**：集火 / 掩护未做，三档差异有限。
6. **战役平衡**：配置与解锁通过，但六关人工实战未调优。

## 发布结论

**不宣布全量发布完成。** 当前达到“功能核心可玩 + 自动化回归通过”；发布门槛仍缺 T11 参考机性能、Edge / 硬件人工验收和 17 型号内容。

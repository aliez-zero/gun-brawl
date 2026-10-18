# 项目文档导航

更新：2026-10-17（北京时间）。本目录包含项目所需的产品、技术、协作与任务资料；整体复制项目即可携带这些文档，无需依赖 `D:\Code\docs`。

## 接手顺序

1. 阅读 [AI 协作约定](../AGENTS.md)，理解架构边界和共享文件归属。
2. 阅读 [开发现状](./DEVELOPMENT.md)，区分已完成、部分实现、未实现和待验证。
3. 在 [模块任务目录](./modules/README.md) 选一个模块，阅读其独立任务说明。
4. 到 [并行计划总看板](./PARALLEL_PLAN.md) 确认依赖和领取状态，登记负责人、工作区与文件范围。
5. 按模块交付清单开发、验证、交接，再由集成者接入主游戏。

文档归档与模块拆分已经完成。T00 已冻结首批武器 / 弹丸 / 投弹 / 爆炸契约与本地 Git 基线；T01 已交付八把枪（含两种终极武器）、弹匣 / 备弹 / 换弹，见 [T01 接手记录](./updates/2026-10-17-weapons.md)、[终极武器追加](./updates/2026-10-18-ultimate-weapons.md) 与 [弹匣换弹](./updates/2026-10-18-magazine-reload.md)；T06 改键 / 持久化见 [改键交付](./updates/2026-10-18-keybindings.md)，T07 自定义 2—4 人对局见 [自定义对局交付](./updates/2026-10-18-custom-match.md)，T08 训练任务 / 图鉴见 [训练交付](./updates/2026-10-18-training-expansion.md)；四图选择、投放点与多风格换装见 [地图 / 外观接手记录](./updates/2026-10-17-appearance-maps.md) 和 [适中难度交接](./updates/2026-10-18-moderate-map-difficulty.md)。17 个具体枪械型号、逐枪弹匣与后坐力方案见 [武器型号设计提案](./WEAPONS.md)，该 17 型号提案尚未实现。模块状态以总看板为准。

## 文档职责

地图后续优化见 [差异化布局与建筑交接](./updates/2026-10-17-distinct-map-layouts.md)：双塔庭院、非对称屋顶、反应堆枢纽，以及逐出生点路线检查。

最新 [适中难度调整](./updates/2026-10-18-moderate-map-difficulty.md) 按用户试玩反馈加宽落脚区与下层接应，验证内侧失足恢复和外围真实击出；取代上一轮窄底台的验收目标。

五位角色第一轮精修、22 帧动作与后续 C01—C07 任务见 [角色设计与细节方案](./CHARACTER_DESIGN.md)，实际文件、检查结果与边界见 [角色精修交接](./updates/2026-10-18-character-polish.md)。

| 文档 / 目录 | 内容 | 更新时机 |
| --- | --- | --- |
| [PRD.md](./PRD.md) | F01—F15 产品需求、A01—A30 验收、阶段目标 | 产品规则或范围调整 |
| [RESEARCH.md](./RESEARCH.md) | 参考玩法、事实来源、待核实信息 | 增补或修订调研依据 |
| `sources/` | S01—S04 网页文字留档，调研文档中有链接 | 保留原文，新增来源另建文件 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现有分层、数据流、状态与逻辑时序 | 真实架构变化后 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 已完成 / 未完成、代码入口、参数、测试证据和已知限制 | 功能集成或验证结论变化后 |
| [WEAPONS.md](./WEAPONS.md) | 17 个具体型号、弹匣 / 备弹、射速 / 弹速、后坐力与投放权重提案 | 型号、弹药或平衡方案调整；落地后转为实现文档 |
| [CHARACTER_DESIGN.md](./CHARACTER_DESIGN.md) | 五角色造型、材质、动作、调研取舍、资源预算与 C01—C07 精修任务 | 角色设计、动画或视觉验收变化后 |
| [PARALLEL_PLAN.md](./PARALLEL_PLAN.md) | 唯一认领看板、依赖、公共契约、文件归属、整合规则 | 认领 / 交接 / 集成 / 验收时 |
| [modules/README.md](./modules/README.md) | 13 个模块入口与分发方式 | 模块范围变化时 |
| `modules/00-*.md` 至 `modules/12-*.md` | 独立模块任务包、子任务、接口与验收、可复制开发指令 | 模块拆分或范围变化时 |

## 目录结构

```text
gun-brawl/
  AGENTS.md
  README.md
  docs/
    README.md
    PRD.md
    RESEARCH.md
    ARCHITECTURE.md
    DEVELOPMENT.md
    WEAPONS.md
    PARALLEL_PLAN.md
    sources/                 调研来源文字留档
    updates/                 交付与接手记录
    modules/                 可分别交给不同 AI 的模块任务包
      README.md
      00-integration.md
      01-weapons.md
      02-explosives.md
      03-drops.md
      04-maps.md
      05-ai.md
      06-controls.md
      07-match-setup.md
      08-training-encyclopedia.md
      09-campaign.md
      10-appearance.md
      11-quality.md
      12-save-data.md
```

文档中的未来源码路径是任务建议；对应模块尚未开发时，不代表该文件已经存在。当前代码事实以开发现状和实际源码为准。

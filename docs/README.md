# 项目文档导航

更新：2026-10-19（北京时间）。本目录包含项目所需的产品、技术、协作与任务资料；整体复制项目即可携带这些文档，无需依赖 `D:\Code\docs`。

## 接手顺序

1. 阅读 [AI 协作约定](../AGENTS.md)，理解架构边界和共享文件归属。
2. 阅读 [开发现状](./DEVELOPMENT.md)，区分已完成、部分实现、未实现和待验证。
3. 在 [模块任务目录](./modules/README.md) 选一个模块，阅读其独立任务说明。
4. 到 [并行计划总看板](./PARALLEL_PLAN.md) 确认依赖和领取状态，登记负责人、工作区与文件范围。
5. 按模块交付清单开发、验证、交接，再由集成者接入主游戏。

文档归档与模块拆分已经完成。T00 已冻结首批武器 / 弹丸 / 投弹 / 爆炸契约与本地 Git 基线；T01 已交付八类武器及 17 个具体型号，弹匣 / 备弹 / 换弹已接入，见 [初版武器](./updates/2026-10-17-weapons.md)、[终极武器](./updates/2026-10-18-ultimate-weapons.md)、[弹匣换弹](./updates/2026-10-18-magazine-reload.md)、[17 型号交付](./updates/2026-10-18-weapon-models.md) 与 [当前型号设计](./WEAPONS.md)。其他交付见 [改键](./updates/2026-10-18-keybindings.md)、[自定义对局](./updates/2026-10-18-custom-match.md)、[训练](./updates/2026-10-18-training-expansion.md)、[存档](./updates/2026-10-18-save-migration.md)、[战役](./updates/2026-10-18-campaign.md)、[规则 AI](./updates/2026-10-18-ai-navigation.md)、[武器表现](./updates/2026-10-18-weapon-polish.md)、[武器平衡](./updates/2026-10-18-weapon-balance.md) 与 [四人验收](./updates/2026-10-18-four-player-acceptance.md)。四图选择 / 换装和当前地图难度见 [初版地图外观](./updates/2026-10-17-appearance-maps.md) 与 [适中难度交接](./updates/2026-10-18-moderate-map-difficulty.md)。质量证据见 [QA](./QA.md)，未完成项见 [剩余清单](./REMAINING.md)；模块状态以总看板为准。

## 文档职责

地图后续优化见 [差异化布局与建筑交接](./updates/2026-10-17-distinct-map-layouts.md)：双塔庭院、非对称屋顶、反应堆枢纽，以及逐出生点路线检查。

最新 [适中难度调整](./updates/2026-10-18-moderate-map-difficulty.md) 按用户试玩反馈加宽落脚区与下层接应，验证内侧失足恢复和外围真实击出；取代上一轮窄底台的验收目标。

五位角色第一轮精修、22 帧动作与后续 C01—C07 任务见 [角色设计与细节方案](./CHARACTER_DESIGN.md)，实际文件、检查结果与边界见 [角色精修交接](./updates/2026-10-18-character-polish.md)。

五位角色及所有混搭已迁移到共用人体骨架，四套新服装 / 脸、双手 IK、附件动作和五风格动作 / 朝向 / 1× 预览见 [T10-R3 全角色交接](./updates/2026-10-18-all-character-rigs.md)。首位样板与人体修正历史见 [牛仔骨架交接](./updates/2026-10-18-cowboy-rig.md)。

免费牛仔网格动画、关键帧曲线、WebGL / Canvas 同源顶点、状态混合、制作方法与技术选型见 [角色动画制作流程](./CHARACTER_ANIMATION_PIPELINE.md)。其他四套服装保留已有分层骨架。

外部模型怎样实际参加对局，见 [外部 AI 调研与接入设计](./EXTERNAL_AI.md)。用户随后选择状态接口直接操作，首版 DeepSeek 网关、角色输入和独立入口已接入，配置及真实验证边界见 [DeepSeek 接入说明](./DEEPSEEK.md)；没有密钥时不调用模型，原有本地玩法可继续运行。

| 文档 / 目录 | 内容 | 更新时机 |
| --- | --- | --- |
| [PRD.md](./PRD.md) | F01—F15 产品需求、A01—A30 验收、阶段目标 | 产品规则或范围调整 |
| [RESEARCH.md](./RESEARCH.md) | 参考玩法、事实来源、待核实信息 | 增补或修订调研依据 |
| `sources/` | S01—S04 网页文字留档，调研文档中有链接 | 保留原文，新增来源另建文件 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 现有分层、数据流、状态与逻辑时序 | 真实架构变化后 |
| [DEVELOPMENT.md](./DEVELOPMENT.md) | 已完成 / 未完成、代码入口、参数、测试证据和已知限制 | 功能集成或验证结论变化后 |
| [WEAPONS.md](./WEAPONS.md) | 已实现的 17 型号、弹匣 / 备弹、射速 / 弹速、后坐力与投放权重设计 | 型号、弹药或平衡方案调整 |
| [CHARACTER_DESIGN.md](./CHARACTER_DESIGN.md) | 五角色造型、材质、动作、调研取舍、资源预算与 C01—C07 精修任务 | 角色设计、动画或视觉验收变化后 |
| [CHARACTER_ANIMATION_PIPELINE.md](./CHARACTER_ANIMATION_PIPELINE.md) | 免费牛仔权重蒙皮 / 关键帧 / 状态混合、制作流程、研究依据与剩余边界 | 动画管线或样板验收变化后 |
| [EXTERNAL_AI.md](./EXTERNAL_AI.md) | 外部模型控制游戏的研究归档、路线比较和 EAI-01—06 原始任务提案 | 外部 AI 方案或实验结论变化后 |
| [DEEPSEEK.md](./DEEPSEEK.md) | 已接入的 DeepSeek 直接操作、密钥配置、实际协议 / 预算、测试与限制 | DeepSeek 实现、配置或验证结论变化后 |
| [PARALLEL_PLAN.md](./PARALLEL_PLAN.md) | 唯一认领看板、依赖、公共契约、文件归属、整合规则 | 认领 / 交接 / 集成 / 验收时 |
| [modules/README.md](./modules/README.md) | 13 个模块入口与分发方式 | 模块范围变化时 |
| [implementation/README.md](./implementation/README.md) | 本轮武器 / 战斗 / 持枪 / 弹道 / HUD 的分模块实现文档 | 武器功能或口径变化时 |
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
    EXTERNAL_AI.md
    DEEPSEEK.md
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
    implementation/           本轮武器 / 战斗 / 表现 / UI 的分模块实现文档
      README.md
      combat/
        01-weapon-content.md
        02-combat-reload-knockback.md
      presentation/
        03-weapon-art-and-holding.md
        04-muzzle-and-projectiles.md
      ui/
        05-hud-armory-training.md
      engineering/
        06-tests-build-release.md
        07-files-interfaces-boundaries.md
```

文档中的未来源码路径是任务建议；对应模块尚未开发时，不代表该文件已经存在。当前代码事实以开发现状和实际源码为准。

背景音乐交接见 [BACKGROUND_MUSIC.md](./BACKGROUND_MUSIC.md)：本地 CC0 曲目、Web Audio 播放生命周期与解码回退。

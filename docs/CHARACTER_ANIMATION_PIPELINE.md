# 免费角色动画制作流程 · 牛仔样板

日期：2026-10-18。任务 T10-A，接续 [全角色分层骨架](./updates/2026-10-18-all-character-rigs.md)。用户选择免费路线、先打磨一位角色。本页记录当前实现、制作方法与边界；领取状态和负责人只在 [总看板](./PARALLEL_PLAN.md) 维护。

## 路线和实际变化

保留 TypeScript + Phaser 3.90，使用原创部件、可编辑关键帧曲线、现有双手 / 双腿 IK 和双骨权重蒙皮。WebGL 实战通过 Phaser 原生 `Rope` 三角条带渲染，不增加第三方依赖、付费工具或外部美术资源。Canvas 外观编辑器使用相同骨架和顶点，逐三角形变换小块纹理。

“专业骨骼方案”通常包含网格 / 权重、曲线编辑、动画混合、IK、换装与挂点。本项目先实现其中适合当前 2D 角色的子集，没有接入 Spine / DragonBones，也没有制作一套图形化动画编辑器。

| 能力 | 当前牛仔样板 | 边界 |
| --- | --- | --- |
| 网格和权重 | 两臂、两腿的八个肢段使用双骨权重，肘 / 膝周围平滑过渡 | 躯干、脸、帽子和附件仍为独立刚性部件；未做整身多骨蒙皮 |
| 关键帧曲线 | 足部前后移动、抬脚、脚掌角度、重心、上身、衣摆和换弹伸手均可直接调曲线 | 曲线在 TS 中编辑，无拖拽时间轴 |
| 动作混合 | 实战平滑混合起跳、下落和收腿；预览同时平滑起跑 / 停步与空中状态 | 不含转身过渡、全身通用交叉淡入淡出或根运动 |
| 二级动作 | 衣摆和头部相对步相略有延迟，领巾独立摆动 | 曲线驱动，无真实布料物理 |
| 换弹 | 副手伸向腰带区域再回到枪身，主手始终跟随真实挂点 | 通用动作，没有独立弹匣、子弹或逐枪拉栓动作 |
| 换装 | 根据 `outfit === 'cowboy'` 启用，脸 / 帽子仍可任意搭配 | 其余四套服装沿用已有连续骨架与部件渲染 |

视觉动作不改变碰撞盒、移动速度或战斗规则。足部曲线区分支撑和回摆，支撑期保持脚踝高度；它不是世界坐标锁脚，快速移动时仍可能有脚底滑动。角色图像依旧为卡通 2D。

## 文件和调用关系

| 文件 | 责任 / 修改方式 |
| --- | --- |
| `src/presentation/characters/CowboyClips.ts` | 归一化动作曲线；关键帧为 `[时间, 数值, 可选切线]`，使用三次 Hermite 插值 |
| `src/presentation/characters/HumanoidRig.ts` | 组合状态 / 曲线，求解固定骨长 IK，输出部件与牛仔 `limbs` 骨链；`HumanoidMotion` 保存每个角色的视觉混合进度 |
| `src/presentation/characters/LimbSkin.ts` | 四条骨链、八个裁片；`skinVertex` 计算双骨线性混合，`skinStrip` 写入复用顶点缓冲 |
| `src/presentation/characters/CowboyArt.ts` | 原创肢体 / 服装画稿；关节端盖延伸到裁片外，避免内部黑色封口形成环状关节 |
| `src/presentation/characters/HumanoidArt.ts` | 原部件图集和画师分流，牛仔 Canvas 绘制转交权重皮肤 |
| `src/presentation/characters/CowboySkin.ts` | 缓存小块裁片、Canvas 三角形仿射变换；按实际画布缩放扩展半像素裁剪，消除接缝 |
| `src/presentation/characters/HumanoidView.ts` | WebGL 牛仔用八个 Rope 替换原八个肢段 Image，其他部件保留 Image；UV 只采样同一图集对应裁片 |
| `src/ui/appearance/AppearanceMotionPreview.ts` | 每帧只推进一次混合，再将同一姿态画到大图和 1× 图；关闭、重绘和销毁释放 RAF / 监听器 |

数据方向：只读 `ActorState` → 曲线与状态混合 → IK 骨链 → 同源蒙皮顶点 → WebGL / Canvas。`src/game/**` 无新增动画依赖。

`HumanoidPose.limbs` 为可选展示字段，包含 `leg`、`legBack`、`arm`、`armBack`，每条记录 `root / joint / end / upper / lower`。`airWeight / fallWeight / tuckWeight` 仅是姿态采样的可选输入；静态工具可以省略它们。`WeaponMount`、核心输入、存档和武器层接口均保持原有格式。必须继续先渲染身体，再将世界挂点交给 `WeaponLayer`。

## 如何制作和调整

1. 从外观编辑器选择牛仔，分别检查待机、跑动、跳跃和换弹，再切换左右朝向；大图看关节衔接，1× 图看轮廓和动作可读性。
2. 先调 `CowboyClips` 的前后位移、抬脚高度和支撑时间，再调重心与上身。循环曲线首尾数值、切线应一致；非循环的换弹曲线保持开始 / 结束归位。数值采用角色逻辑绘图单位，时间为 0—1，切线为数值对归一化时间的导数。
3. 调美术时修改 `CowboyArt` 的对应部件。修改裁片边界或骨长时，同时核对 `LIMB_SKINS`、图集 UV、蒙皮测试和全部武器握点。不要用拉长手臂解决枪柄位置错误。
4. 权重在关节前后共 7 个单位内做 smoothstep 混合；远离关节的根 / 末端完全绑定相应骨骼。每片 8 排、16 顶点、14 个三角形，左右边缘与原裁片 UV 一一对应。加密排数前先验证关节形变和绘制成本。
5. 新服装先独立准备肢段画稿与裁片，完成混搭 / 镜像 / 握点检查，再启用对应渲染路径。盔甲更适合刚性甲片加内层关节，不应直接把金属板按布料弯曲。

例如 `footLift` 的 `[0.70, 9]` 表示步相 70% 时将脚踝抬高 9 个单位；`footTravel` 的 `[0, 10, -35]` 表示循环起点前伸 10、导数为 -35。动作相位与武器后坐分开，连续开火不会覆盖步态。

## 生命周期和资源

- 牛仔八个 Rope 替代八个 Image，每人仍有 19 个身体 / 预览枪对象，实战隐藏预览枪。四人专项总计 87 个场景对象，重赛不累积新部件。
- 沿用 1200 × 1152 图集、最多 8 套外观缓存。牛仔图集 key 使用 `humanoid-rig-v2`，其他服装仍为 v1；无需第二套全身蒙皮图集。单图 RGBA 原像素约 5.27 MiB，不等同于总内存。
- 编辑器小裁片缓存最多 64 块，按服装色 / 肤色 / 肢段复用，超过上限淘汰旧块；不会逐帧重建全身图集。
- 暂停使用零视觉步长冻结骨链和顶点；复活重建角色视觉动作，重赛和场景销毁释放 Images、Ropes 和外观图集。
- Phaser **Canvas 游戏渲染器**不支持 Rope，使用刚性 Image 回退；浏览器 Canvas **外观预览**则使用自制三角形变形，二者应区分。正常 WebGL 实战已验收。
- Rope 会增加渲染批次。对象数稳定不代表性能预算已达标；参考设备四人 FPS、GPU 和长时内存仍待测。

## 验证与复现

先启动 Vite dev。当前本机入口为 `http://127.0.0.1:5177/`，新环境以终端显示端口为准。专项脚本通过 Vite 导入源码，不用于生产 preview。

```powershell
$env:GAME_TEST_URL='http://127.0.0.1:5177'
pnpm test
pnpm build
node scripts/cowboy-animation-visuals.mjs
node scripts/character-visuals.mjs
node scripts/character-rig-visuals.mjs
pnpm test:visual
pnpm test:browser
```

浏览器脚本依次运行，避免软件 WebGL 抢占导致倒计时检查超时。`cowboy-animation-visuals.mjs --baseline` 只应用于改动前采样；不要在新实现上重写旧对照图。

动画集成快照：27 文件 / 240 项单元测试与严格生产构建通过；其中新增 6 项验证循环位置 / 速度连续、支撑期脚高、根 / 末端绑定、关节共享截面、顶点缓冲复用、空中 / 换弹几何和起跳 / 下落 / 落地 / 暂停 / 重置。专项验证四人 32 个实际 Rope、有限顶点 / 合法 UV、双向握点 / 火光、含网格顶点的暂停、复活、30 次混搭重赛、87 对象、最多 8 图集与销毁 / 预览清理。110 帧、150 混搭 / 750 姿态及五张脸检查通过。随后工作区出现并行武器调参与独立测试，不属于这份 240 项快照。完整浏览器流程结果见 [开发现状](./DEVELOPMENT.md)。

本地截图在忽略的 `artifacts/`：`cowboy-animation-before.png` / `cowboy-animation-after.png` 为 15 姿态对照（新图含真实 1×，旧图的小样为 0.8×，比较变化请看同尺度大图），`cowboy-weighted-webgl.png` 为真实 WebGL 放大持枪检查，`cowboy-rig-studio.png` 为编辑器。截图用于复核，正式源码不放在 artifacts。

## 研究依据与后续

| 方案 | 已核实信息 | 本次取舍 |
| --- | --- | --- |
| [Spine Phaser 官方运行时](https://esotericsoftware.com/spine-phaser) | 有 Phaser 3 适配；专业功能见 [Spine 功能](https://esotericsoftware.com/spine-in-depth)，使用条件见 [运行时许可证](https://esotericsoftware.com/spine-runtimes-license) | 用户优先免费，本轮没有安装或使用该运行时 / 编辑器 |
| [DragonBonesJS Phaser 3 适配](https://github.com/DragonBones/DragonBonesJS/tree/master/Phaser/3.x) | 仓库有适配与 MIT 源码，构建流程较旧 | 未在本项目 Phaser 3.90 验证兼容性，不作为本轮依赖 |
| [Phaser Rope](https://docs.phaser.io/api-documentation/class/gameobjects-rope) | 引擎已有 WebGL 三角条带，支持顶点 / UV / 颜色 | 当前样板使用；自制权重和曲线，不冒充 Spine 接入 |

后续按可独立交付的顺序：先做预览时间轴 / 慢放 / 武器切换，再做转身、专属表情和可见弹匣动作，之后按服装材质逐个推广蒙皮。世界锁脚和参考机性能需单列验收。若未来改用外部编辑器，应导出带版本的独立动画资源并适配现有挂点，保持核心规则与表现层分离。

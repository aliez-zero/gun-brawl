# 背景音乐播放系统

更新：2026-10-19（北京时间）。

## 已实现

游戏使用 `src/presentation/music/MusicPlayer.ts` 管理背景音乐，采用浏览器 Web Audio API 播放本地资源。首次点击或按键后才解锁 `AudioContext`，符合浏览器自动播放策略；菜单、地图、对局、暂停、失焦和销毁都有明确的播放状态。切换曲目使用短淡入 / 淡出，暂停会保存当前偏移，恢复时从原位置继续。最多缓存 3 首解码后的音频，快速切换不会无限创建声源。

设置位于“设置 → 背景音乐”，包括独立开关、音量、自动 / 手动选曲和实时状态。自动模式在菜单使用菜单曲，对局按地图选择古城、都市、飞船或训练曲；音效音量仍由原有“音效音量”单独控制。偏好写入 v2 存档，旧 v1/v2 存档缺少音乐字段时使用默认值。

## 曲目与授权

曲目已下载到 `public/audio/` 随项目分发，不依赖运行时网络。以下曲目来自 [OpenGameArt.org](https://opengameart.org/)，页面标记为 **CC0 1.0**；项目不对这些作品主张著作权，保留来源记录便于追溯。

| 场景 | 本地文件 | 来源页面 |
| --- | --- | --- |
| 菜单 | `menu-awesomeness.wav` | [Menu Music](https://opengameart.org/content/menu-music) |
| 古城 | `citadel-montage.ogg` | [Free Music Pack](https://opengameart.org/content/free-music-pack) |
| 都市 | `city-warped.mp3` | [Free Music Pack](https://opengameart.org/content/free-music-pack) |
| 飞船 | `space-out-there.ogg` | [Space Music: Out There](https://opengameart.org/content/space-music-out-there) |
| 训练 | `training-fight.ogg` | [Fast fight / battle music](https://opengameart.org/content/fast-fight-battle-music) |

页面上的作者和授权信息以来源站点为准；如果未来发布渠道要求完整的第三方归属文本，发布包应同时带上本页和这些来源链接。

## 兼容与回退

播放器优先下载并解码上述本地文件。若浏览器不支持某种编码、文件损坏或资源被替换，会使用 `MusicSynth.ts` 的确定性 PCM 合成回退，因此无法解码音频不会让游戏启动失败。回退曲目仍支持相同的循环、音量、暂停和场景切换逻辑。

音频只在用户手势后启动；静音、暂停、隐藏标签页和失焦时不创建持续播放声源。存档只保存开关、音量和选曲，不保存音频二进制。

## 验证

- `tests/music.test.ts`：曲目选择 / 设置修复、PCM 回退的有限值 / RMS / 峰值 / 循环接缝、懒加载解锁、暂停偏移、切歌和销毁。
- `tests/storage.test.ts`：音乐偏好持久化、旧 v2 缺失字段迁移、损坏字段逐项修复和清档恢复。
- 浏览器检查应在首次点击后确认设置页状态为“正在播放”，并检查切换曲目、暂停 / 恢复、刷新保存和禁用音乐后不再启动。

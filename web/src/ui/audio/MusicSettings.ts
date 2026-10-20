import { MUSIC_TRACKS } from '../../content/music';
import type { MusicSettings } from '../../content/music';
import type { MusicStatus } from '../../presentation/music/MusicPlayer';

export function musicStatusText(status: MusicStatus): string {
  const name = MUSIC_TRACKS.find((track) => track.id === status.track)!.name;
  const state = { waiting: '点击页面后播放', playing: '正在播放', paused: '已暂停', muted: '已静音', unavailable: '音频暂不可用' }[status.state];
  return `${state} · ${name}`;
}

export function musicSettings(settings: MusicSettings, status: MusicStatus): string {
  return `<section class="music-settings" aria-labelledby="music-heading">
    <div class="music-settings-heading"><h3 id="music-heading">背景音乐</h3><label class="music-switch"><input type="checkbox" id="music-enabled" ${settings.enabled ? 'checked' : ''}>开启音乐</label></div>
    <p id="music-status" class="music-status" data-state="${status.state}" data-track="${status.track}" role="status">${musicStatusText(status)}</p>
    <label class="music-track-label" for="music-track">播放曲目</label>
    <select id="music-track"><option value="auto" ${settings.track === 'auto' ? 'selected' : ''}>自动 · 随菜单与地图切换</option>${MUSIC_TRACKS.map((track) => `<option value="${track.id}" ${settings.track === track.id ? 'selected' : ''}>${track.name} / ${track.mood}</option>`).join('')}</select>
    <div class="setting-row"><label for="music-volume">音乐音量</label><output for="music-volume">${Math.round(settings.volume * 100)}%</output><input id="music-volume" type="range" min="0" max="100" value="${Math.round(settings.volume * 100)}"></div>
    <p class="music-hint">本地 CC0 曲目。随对局暂停，切出窗口时停播，返回后续播。</p>
  </section>`;
}

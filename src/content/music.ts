export const MUSIC_TRACKS = [
  { id: 'menu', name: '荒野开场', mood: '轻快拨弦 · 菜单', bpm: 104, asset: '/audio/menu-awesomeness.gbm' },
  { id: 'citadel', name: '云城行军', mood: '五声音阶 · 古城', bpm: 108, asset: '/audio/citadel-montage.gbm' },
  { id: 'city', name: '夜行霓虹', mood: '合成器律动 · 都市', bpm: 124, asset: '/audio/city-warped.gbm' },
  { id: 'space', name: '方舟脉冲', mood: '空灵琶音 · 飞船', bpm: 94, asset: '/audio/space-out-there.gbm' },
  { id: 'training', name: '热身节拍', mood: '轻松节奏 · 训练', bpm: 112, asset: '/audio/training-fight.gbm' },
] as const;
export type MusicTrackId = typeof MUSIC_TRACKS[number]['id'];
export type MusicSelection = 'auto' | MusicTrackId;
export interface MusicSettings { enabled: boolean; volume: number; track: MusicSelection }
export const DEFAULT_MUSIC: Readonly<MusicSettings> = { enabled: true, volume: 0.28, track: 'auto' };

export function isMusicTrack(id: unknown): id is MusicTrackId {
  return MUSIC_TRACKS.some((track) => track.id === id);
}

export function normalizeMusic(value: unknown): MusicSettings {
  const data = value && typeof value === 'object' ? value as Partial<MusicSettings> : {};
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_MUSIC.enabled,
    volume: typeof data.volume === 'number' && Number.isFinite(data.volume) ? Math.max(0, Math.min(1, data.volume)) : DEFAULT_MUSIC.volume,
    track: data.track === 'auto' || isMusicTrack(data.track) ? data.track : DEFAULT_MUSIC.track,
  };
}

export function sceneMusic(selection: MusicSelection, inBattle: boolean, mapId: string): MusicTrackId {
  if (selection !== 'auto') return selection;
  if (!inBattle) return 'menu';
  switch (mapId) {
    case 'sky-citadel': return 'citadel';
    case 'neon-city': return 'city';
    case 'alien-starship': return 'space';
    default: return 'training';
  }
}

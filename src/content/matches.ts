import type { ActorConfig, CharacterAppearance, GameMode, HumanSlot, MatchConfig } from '../game/core/types';
import { getArena, TRAINING_ARENA } from './maps';
import { presetAppearance } from './appearances';

export const MODE_LABELS: Record<GameMode, string> = {
  'duel-ai': '人机对战', 'local-duel': '本地双人', training: '自由练习',
};

export interface MatchSelections { mapId?: string; appearances?: Record<HumanSlot, CharacterAppearance> }

export function createMatchConfig(mode: GameMode, seed: number, selections: MatchSelections = {}): MatchConfig {
  const first: ActorConfig = { id: 'p1', name: '玩家 1', control: 'human', inputSlot: 1, color: 0xc4f56b };
  const second: ActorConfig = mode === 'local-duel'
    ? { id: 'p2', name: '玩家 2', control: 'human', inputSlot: 2, color: 0x72d5e5 }
    : mode === 'training'
      ? { id: 'dummy', name: '训练假人', control: 'dummy', color: 0xf3ac78 }
      : { id: 'bot', name: '对手 AI', control: 'bot', difficulty: 'normal', color: 0xf3ac78 };
  const map = selections.mapId ? getArena(selections.mapId) : TRAINING_ARENA;
  first.appearance = { ...(selections.appearances?.[1] ?? presetAppearance('cowboy')) };
  second.appearance = { ...(mode === 'local-duel'
    ? selections.appearances?.[2] ?? presetAppearance('ronin')
    : presetAppearance(map.theme === 'starship' ? 'astronaut' : map.theme === 'city' ? 'operative' : 'knight')) };
  return {
    mode, map, actors: [first, second],
    stocks: 3, duration: 180, countdown: 3, seed,
  };
}

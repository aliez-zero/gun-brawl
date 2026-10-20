import type { ActorConfig, CharacterAppearance, Difficulty, DropMode, HumanSlot, MatchConfig, MatchResult } from '../game/core/types';
import { getArena, isMapId } from './maps';
import { presetAppearance } from './appearances';
import { BASIC_PISTOL } from './weapons';

export interface CampaignLevel {
  id: string;
  order: number;
  name: string;
  brief: string;
  mapId: string;
  difficulty: Difficulty;
  stocks: number;
  duration: number;
  dropMode: DropMode;
}

/** Six hand-authored levels; unlocks are sequential and only a human win advances. */
export const CAMPAIGN_LEVELS: readonly CampaignLevel[] = [
  { id: 'level-1', order: 1, name: '第一战：云上试枪', brief: '在云上古城击败普通 AI，熟悉击退与回场。', mapId: 'sky-citadel', difficulty: 'easy', stocks: 3, duration: 120, dropMode: 'all' },
  { id: 'level-2', order: 2, name: '第二战：霓虹追猎', brief: '屋顶窄，少一条命；只投放标准武器。', mapId: 'neon-city', difficulty: 'easy', stocks: 2, duration: 100, dropMode: 'standard' },
  { id: 'level-3', order: 3, name: '第三战：中城封锁', brief: '普通 AI，标准武器池，学会用掩体接近。', mapId: 'neon-city', difficulty: 'normal', stocks: 3, duration: 120, dropMode: 'standard' },
  { id: 'level-4', order: 4, name: '第四战：沉默货舱', brief: '飞船货舱没有特殊投放，两命定胜负。', mapId: 'alien-starship', difficulty: 'normal', stocks: 2, duration: 90, dropMode: 'none' },
  { id: 'level-5', order: 5, name: '第五战：高塔猎杀', brief: '困难 AI 回到古城；两条命，标准投放。', mapId: 'sky-citadel', difficulty: 'hard', stocks: 2, duration: 90, dropMode: 'standard' },
  { id: 'level-6', order: 6, name: '终战：星舰王座', brief: '一命决胜，全部武器；把最终对手送进星空。', mapId: 'alien-starship', difficulty: 'hard', stocks: 1, duration: 120, dropMode: 'all' },
];

export const CAMPAIGN_LEVEL_IDS = CAMPAIGN_LEVELS.map((level) => level.id);

export function getCampaignLevel(id: string): CampaignLevel | undefined {
  return CAMPAIGN_LEVELS.find((level) => level.id === id);
}

export interface CampaignProgress {
  /** Number of levels unlocked, 1—6. */
  unlocked: number;
  bestScores: Record<string, number>;
  completed: string[];
}

export const defaultCampaignProgress = (): CampaignProgress => ({ unlocked: 1, bestScores: {}, completed: [] });

export function normalizeCampaignProgress(value: unknown): CampaignProgress {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const unlocked = typeof record.unlocked === 'number' && Number.isInteger(record.unlocked)
    ? Math.max(1, Math.min(CAMPAIGN_LEVELS.length, record.unlocked))
    : 1;
  const scores = typeof record.bestScores === 'object' && record.bestScores !== null && !Array.isArray(record.bestScores)
    ? record.bestScores as Record<string, unknown>
    : {};
  const bestScores: Record<string, number> = {};
  for (const id of CAMPAIGN_LEVEL_IDS) {
    const score = scores[id];
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0) bestScores[id] = Math.round(score);
  }
  const completed = Array.isArray(record.completed)
    ? [...new Set(record.completed.filter((id): id is string => typeof id === 'string' && CAMPAIGN_LEVEL_IDS.includes(id)))]
    : [];
  return { unlocked, bestScores, completed };
}

export function campaignScore(result: Pick<MatchResult, 'winner' | 'duration' | 'overtime' | 'actors'>): number {
  if (result.winner !== 'p1') return 0;
  const stocks = result.actors.find((actor) => actor.id === 'p1')?.stocks ?? 0;
  // Remaining stocks dominate; duration only breaks ties within the same stock count.
  return stocks * 10_000 + Math.max(100, Math.round(2000 - result.duration * 5 + (result.overtime ? 150 : 0)));
}

export function createCampaignConfig(
  level: CampaignLevel,
  seed: number,
  selections: { appearances?: Record<HumanSlot, CharacterAppearance>; matchId?: string } = {},
): MatchConfig {
  const map = isMapId(level.mapId) ? getArena(level.mapId) : getArena('sky-citadel');
  const botLook = map.theme === 'starship' ? 'astronaut' : map.theme === 'city' ? 'operative' : 'knight';
  const first: ActorConfig = {
    id: 'p1', name: '玩家 1', control: 'human', inputSlot: 1, color: 0xc4f56b,
    appearance: { ...(selections.appearances?.[1] ?? presetAppearance('cowboy')) },
  };
  const second: ActorConfig = {
    id: 'bot', name: `战役对手 · ${level.order}`, control: 'bot', difficulty: level.difficulty,
    color: 0xf3ac78, appearance: presetAppearance(botLook),
  };
  return {
    mode: 'campaign', map, actors: [first, second], startingWeapon: BASIC_PISTOL,
    stocks: level.stocks, duration: level.duration, countdown: 3, seed,
    dropMode: level.dropMode, campaignLevelId: level.id,
    ...(selections.matchId ? { matchId: selections.matchId } : {}),
  };
}

import type {
  ActorConfig, CharacterAppearance, Difficulty, DropMode, GameMode, HumanSlot, MatchConfig, TrainingTaskId,
} from '../game/core/types';
import { ARENAS, getArena, isMapId, TRAINING_ARENA } from './maps';
import { presetAppearance } from './appearances';
import { BASIC_PISTOL } from './weapons';

export const MODE_LABELS: Record<GameMode, string> = {
  'duel-ai': '人机对战', 'local-duel': '本地双人', training: '自由练习', custom: '自定义对局',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单', normal: '普通', hard: '困难',
};

export interface MatchSelections {
  mapId?: string;
  appearances?: Record<HumanSlot, CharacterAppearance>;
  matchId?: string;
  trainingCompleted?: readonly TrainingTaskId[];
}

export type CustomSlot =
  | { kind: 'human'; inputSlot: HumanSlot }
  | { kind: 'bot'; difficulty: Difficulty }
  | { kind: 'empty' };

export interface CustomMatchSettings {
  mapId: string;
  stocks: number;
  duration: number;
  dropMode: DropMode;
  /** Exactly four choices; empty slots are ignored by the builder. */
  slots: CustomSlot[];
}

export const CUSTOM_MATCH_LIMITS = {
  minStocks: 1,
  maxStocks: 9,
  minDuration: 30,
  maxDuration: 600,
  minPlayers: 2,
  maxPlayers: 4,
} as const;

export const DEFAULT_CUSTOM_MATCH: CustomMatchSettings = {
  mapId: 'sky-citadel',
  stocks: 3,
  duration: 180,
  dropMode: 'all',
  slots: [
    { kind: 'human', inputSlot: 1 },
    { kind: 'bot', difficulty: 'normal' },
    { kind: 'empty' },
    { kind: 'empty' },
  ],
};

export function cloneCustomMatch(settings: CustomMatchSettings = DEFAULT_CUSTOM_MATCH): CustomMatchSettings {
  const slots = settings.slots.slice(0, 4).map((slot) => ({ ...slot }));
  while (slots.length < 4) slots.push({ kind: 'empty' });
  return {
    mapId: settings.mapId,
    stocks: settings.stocks,
    duration: settings.duration,
    dropMode: settings.dropMode,
    slots,
  };
}

/** Pure validation shared by the setup UI, application and tests. */
export function validateCustomMatch(settings: CustomMatchSettings): string[] {
  const errors: string[] = [];
  if (!isMapId(settings.mapId)) errors.push('地图无效。');
  if (!Number.isInteger(settings.stocks) || settings.stocks < CUSTOM_MATCH_LIMITS.minStocks || settings.stocks > CUSTOM_MATCH_LIMITS.maxStocks) {
    errors.push(`每人生命需为 ${CUSTOM_MATCH_LIMITS.minStocks}—${CUSTOM_MATCH_LIMITS.maxStocks} 的整数。`);
  }
  if (!Number.isFinite(settings.duration) || settings.duration < CUSTOM_MATCH_LIMITS.minDuration || settings.duration > CUSTOM_MATCH_LIMITS.maxDuration) {
    errors.push(`时限需在 ${CUSTOM_MATCH_LIMITS.minDuration}—${CUSTOM_MATCH_LIMITS.maxDuration} 秒之间。`);
  }
  if (!['all', 'standard', 'none'].includes(settings.dropMode)) errors.push('武器池选项无效。');
  if (!Array.isArray(settings.slots) || settings.slots.length < CUSTOM_MATCH_LIMITS.minPlayers || settings.slots.length > CUSTOM_MATCH_LIMITS.maxPlayers) {
    errors.push('槽位数量需为 2—4。');
    return errors;
  }

  const active = settings.slots.filter((slot) => slot.kind !== 'empty');
  if (active.length < CUSTOM_MATCH_LIMITS.minPlayers || active.length > CUSTOM_MATCH_LIMITS.maxPlayers) {
    errors.push('实际参战人数需为 2—4。');
  }
  const humans = active.filter((slot): slot is Extract<CustomSlot, { kind: 'human' }> => slot.kind === 'human');
  if (humans.length < 1) errors.push('至少需要一名本地玩家。');
  if (humans.length > 2) errors.push('最多只能有两名本地玩家。');
  if (new Set(humans.map((slot) => slot.inputSlot)).size !== humans.length) errors.push('人类输入槽位不能重复。');
  if (!humans.some((slot) => slot.inputSlot === 1)) errors.push('玩家 1 必须参战。');
  const first = active[0];
  if (!first || first.kind !== 'human' || first.inputSlot !== 1) errors.push('第一个参战槽位必须是玩家 1。');
  if (active.filter((slot) => slot.kind === 'bot').some((slot) => !['easy', 'normal', 'hard'].includes(slot.difficulty))) {
    errors.push('AI 难度无效。');
  }
  return errors;
}

/** Saved settings are normalized field-by-field; an impossible layout falls back to the default. */
export function normalizeCustomMatch(value: unknown): CustomMatchSettings {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const slots: CustomSlot[] = [{ kind: 'human', inputSlot: 1 }];
  const rawSlots = Array.isArray(record.slots) ? record.slots.slice(0, 4) : [];
  for (let index = 1; index < 4; index++) {
    const raw = typeof rawSlots[index] === 'object' && rawSlots[index] !== null
      ? rawSlots[index] as Record<string, unknown>
      : {};
    if (index === 1 && raw.kind === 'human') {
      slots.push({ kind: 'human', inputSlot: 2 });
    } else if (raw.kind === 'bot' && ['easy', 'normal', 'hard'].includes(raw.difficulty as string)) {
      slots.push({ kind: 'bot', difficulty: raw.difficulty as Difficulty });
    } else if (index === 1 && raw.kind !== 'empty' && raw.kind !== 'bot') {
      slots.push({ kind: 'bot', difficulty: 'normal' });
    } else {
      slots.push({ kind: 'empty' });
    }
  }
  if (slots.filter((slot) => slot.kind !== 'empty').length < 2) slots[1] = { kind: 'bot', difficulty: 'normal' };

  const next: CustomMatchSettings = {
    mapId: isMapId(record.mapId) ? record.mapId : DEFAULT_CUSTOM_MATCH.mapId,
    stocks: typeof record.stocks === 'number' && Number.isInteger(record.stocks) && record.stocks >= 1 && record.stocks <= 9 ? record.stocks : 3,
    duration: typeof record.duration === 'number' && Number.isFinite(record.duration) && record.duration >= 30 && record.duration <= 600 ? record.duration : 180,
    dropMode: record.dropMode === 'standard' || record.dropMode === 'none' ? record.dropMode : 'all',
    slots,
  };
  return validateCustomMatch(next).length === 0 ? next : cloneCustomMatch();
}

export function createCustomMatchConfig(
  settings: CustomMatchSettings,
  seed: number,
  selections: MatchSelections = {},
): MatchConfig {
  const errors = validateCustomMatch(settings);
  if (errors.length) throw new Error(errors.join(' '));
  const map = getArena(settings.mapId);
  const active = settings.slots.filter((slot) => slot.kind !== 'empty');
  const botColors = [0xf3ac78, 0xe58cc0, 0x9d8cff];
  const botLooks = ['knight', 'operative', 'astronaut'] as const;
  let botIndex = 0;
  const actors: ActorConfig[] = active.map((slot) => {
    if (slot.kind === 'human') {
      const inputSlot = slot.inputSlot;
      return {
        id: inputSlot === 1 ? 'p1' : 'p2',
        name: `玩家 ${inputSlot}`,
        control: 'human',
        inputSlot,
        color: inputSlot === 1 ? 0xc4f56b : 0x72d5e5,
        appearance: { ...(selections.appearances?.[inputSlot] ?? presetAppearance(inputSlot === 1 ? 'cowboy' : 'ronin')) },
      };
    }
    const index = botIndex++;
    return {
      id: `bot-${index + 1}`,
      name: `AI ${index + 1}`,
      control: 'bot',
      difficulty: slot.difficulty,
      color: botColors[index] ?? 0xf3ac78,
      appearance: presetAppearance(botLooks[index] ?? 'knight'),
    };
  });
  return {
    mode: 'custom',
    map,
    actors,
    startingWeapon: BASIC_PISTOL,
    stocks: settings.stocks,
    duration: settings.duration,
    countdown: 3,
    seed,
    dropMode: settings.dropMode,
    ...(selections.matchId ? { matchId: selections.matchId } : {}),
  };
}

export function createMatchConfig(mode: GameMode, seed: number, selections: MatchSelections = {}): MatchConfig {
  if (mode === 'custom') throw new Error('自定义对局请使用 createCustomMatchConfig');
  const first: ActorConfig = { id: 'p1', name: '玩家 1', control: 'human', inputSlot: 1, color: 0xc4f56b };
  const second: ActorConfig = mode === 'local-duel'
    ? { id: 'p2', name: '玩家 2', control: 'human', inputSlot: 2, color: 0x72d5e5 }
    : mode === 'training'
      ? { id: 'dummy', name: '训练假人', control: 'dummy', color: 0xf3ac78 }
      : { id: 'bot', name: '对手 AI', control: 'bot', difficulty: 'normal', color: 0xf3ac78 };
  // Practice always uses the dedicated training deck; themed maps are for matches.
  const map = mode === 'training' ? TRAINING_ARENA : selections.mapId ? getArena(selections.mapId) : TRAINING_ARENA;
  first.appearance = { ...(selections.appearances?.[1] ?? presetAppearance('cowboy')) };
  second.appearance = { ...(mode === 'local-duel'
    ? selections.appearances?.[2] ?? presetAppearance('ronin')
    : presetAppearance(map.theme === 'starship' ? 'astronaut' : map.theme === 'city' ? 'operative' : 'knight')) };
  return {
    mode, map, actors: [first, second], startingWeapon: BASIC_PISTOL,
    stocks: 3, duration: 180, countdown: 3, seed,
    ...(selections.matchId ? { matchId: selections.matchId } : {}),
    ...(mode === 'training' && selections.trainingCompleted ? { trainingCompleted: [...selections.trainingCompleted] } : {}),
  };
}

export const CUSTOM_MAP_OPTIONS = ARENAS;

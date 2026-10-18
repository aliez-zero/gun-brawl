import { normalizeAppearance, presetAppearance } from '../content/appearances';
import { cloneBindings, normalizeBindings } from '../content/controls';
import type { KeyBindings } from '../content/controls';
import { cloneCustomMatch, normalizeCustomMatch } from '../content/matches';
import type { CustomMatchSettings } from '../content/matches';
import { isMapId } from '../content/maps';
import type { CharacterAppearance, GameMode, HumanSlot, MatchResult } from '../game/core/types';

export interface SaveData {
  version: 1;
  settings: { volume: number; reducedMotion: boolean };
  lastMode: GameMode;
  stats: { completed: number; p1Wins: number; p2Wins: number; draws: number };
  lastResultId: string | null;
  selectedMapId: string;
  appearances: Record<HumanSlot, CharacterAppearance>;
  bindings: KeyBindings;
  customMatch: CustomMatchSettings;
}

export interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const SAVE_KEY = 'gun-brawl:save:v1';
const defaults = (): SaveData => ({
  version: 1, settings: { volume: 0.35, reducedMotion: false },
  lastMode: 'duel-ai', stats: { completed: 0, p1Wins: 0, p2Wins: 0, draws: 0 }, lastResultId: null,
  selectedMapId: 'sky-citadel', appearances: { 1: presetAppearance('cowboy'), 2: presetAppearance('ronin') },
  bindings: cloneBindings(), customMatch: cloneCustomMatch(),
});

const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
export const isGameMode = (value: unknown): value is GameMode => value === 'duel-ai' || value === 'local-duel' || value === 'training' || value === 'custom';

export class SaveStore {
  readonly data: SaveData;
  available = true;

  constructor(private readonly storage: StoragePort | null) {
    this.data = defaults();
    if (!storage) { this.available = false; return; }
    try {
      const raw = storage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = record(JSON.parse(raw));
      if (parsed.version !== 1) return;
      const settings = record(parsed.settings);
      const stats = record(parsed.stats);
      if (typeof settings.volume === 'number' && Number.isFinite(settings.volume)) this.data.settings.volume = Math.max(0, Math.min(1, settings.volume));
      if (typeof settings.reducedMotion === 'boolean') this.data.settings.reducedMotion = settings.reducedMotion;
      if (isGameMode(parsed.lastMode)) this.data.lastMode = parsed.lastMode;
      this.data.stats = { completed: count(stats.completed), p1Wins: count(stats.p1Wins), p2Wins: count(stats.p2Wins), draws: count(stats.draws) };
      if (typeof parsed.lastResultId === 'string') this.data.lastResultId = parsed.lastResultId;
      if (isMapId(parsed.selectedMapId)) this.data.selectedMapId = parsed.selectedMapId;
      const appearances = record(parsed.appearances);
      this.data.appearances[1] = normalizeAppearance(appearances['1'], this.data.appearances[1]);
      this.data.appearances[2] = normalizeAppearance(appearances['2'], this.data.appearances[2]);
      this.data.bindings = normalizeBindings(parsed.bindings);
      this.data.customMatch = normalizeCustomMatch(parsed.customMatch);
    } catch (error) { this.available = error instanceof SyntaxError; }
  }

  persist(): void {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
      this.available = true;
    } catch { this.available = false; }
  }

  recordResult(result: MatchResult): void {
    if (result.mode === 'training' || result.id === this.data.lastResultId) return;
    this.data.lastResultId = result.id;
    this.data.stats.completed++;
    if (result.winner === 'p1') this.data.stats.p1Wins++;
    else if (result.winner === 'p2') this.data.stats.p2Wins++;
    else if (result.winner === null) this.data.stats.draws++;
    this.persist();
  }
}

export function browserStorage(): StoragePort | null {
  try { return window.localStorage; } catch { return null; }
}

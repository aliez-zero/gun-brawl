import { describe, expect, it } from 'vitest';
import { cloneBindings, DEFAULT_KEY_BINDINGS, rebind } from '../src/content/controls';
import { SaveStore } from '../src/storage/SaveStore';
import { presetAppearance } from '../src/content/appearances';
import type { StoragePort } from '../src/storage/SaveStore';
import type { MatchResult } from '../src/game/core/types';

function memoryStorage(initial: string | null = null): StoragePort {
  let current = initial;
  return { getItem: () => current, setItem: (_key, value) => { current = value; } };
}
const result: MatchResult = { id: 'match-1', mode: 'duel-ai', winner: 'p1', duration: 20, overtime: false, actors: [] };

describe('versioned local saves', () => {
  it('adds map and appearance defaults to an old v1 save without losing settings or results', () => {
    const store = new SaveStore(memoryStorage(JSON.stringify({ version: 1, settings: { volume: 0.68, reducedMotion: true }, stats: { completed: 9, p1Wins: 6, p2Wins: 2, draws: 1 }, lastMode: 'local-duel', lastResultId: 'old-result' })));
    expect(store.data.selectedMapId).toBe('sky-citadel');
    expect(store.data.appearances).toEqual({ 1: presetAppearance('cowboy'), 2: presetAppearance('ronin') });
    expect(store.data.settings).toEqual({ volume: 0.68, reducedMotion: true });
    expect(store.data.stats.completed).toBe(9);
    expect(store.data.lastResultId).toBe('old-result');
    expect(store.data.lastMode).toBe('local-duel');
  });

  it('persists independent mixed outfits and map selection across reloads', () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    store.data.selectedMapId = 'alien-starship';
    store.data.appearances[1] = { ...presetAppearance('cowboy'), hat: 'space', outfit: 'knight', color: 0x6464a8, skin: 0x855744 };
    store.data.appearances[2] = presetAppearance('operative');
    store.persist();
    const restored = new SaveStore(storage);
    expect(restored.data.appearances).toEqual(store.data.appearances);
    expect(restored.data.selectedMapId).toBe('alien-starship');
    restored.data.appearances[1].hat = 'none';
    expect(restored.data.appearances[2].hat).toBe('beret');
  });

  it('persists custom bindings and restores defaults from damaged mappings', () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    store.data.bindings = rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'KeyU').bindings;
    store.persist();
    const restored = new SaveStore(storage);
    expect(restored.data.bindings[1].shoot).toEqual({ codes: ['KeyU'], label: 'U' });

    const damaged = new SaveStore(memoryStorage(JSON.stringify({
      version: 1, bindings: { 1: { shoot: { codes: ['KeyK'], label: 'K' } } },
    })));
    expect(damaged.data.bindings).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('keeps default bindings for old saves', () => {
    const store = new SaveStore(memoryStorage(JSON.stringify({ version: 1, settings: { volume: 0.5 } })));
    expect(store.data.bindings).toEqual(DEFAULT_KEY_BINDINGS);
    store.data.bindings = cloneBindings();
    expect(store.data.bindings[1].shoot.codes).toEqual(['KeyJ']);
  });

  it('repairs invalid map and cosmetic fields independently', () => {
    const store = new SaveStore(memoryStorage(JSON.stringify({ version: 1, selectedMapId: '../../invalid', appearances: { 1: { style: '<bad>', hat: 'space', outfit: 'missing', color: 123, skin: null }, 2: [] } })));
    expect(store.data.selectedMapId).toBe('sky-citadel');
    expect(store.data.appearances[1]).toEqual({ ...presetAppearance('cowboy'), hat: 'space' });
    expect(store.data.appearances[2]).toEqual(presetAppearance('ronin'));
  });

  it('restores valid values and normalizes invalid fields', () => {
    const store = new SaveStore(memoryStorage(JSON.stringify({
      version: 1, settings: { volume: 50, reducedMotion: true }, lastMode: 'not-a-mode',
      stats: { completed: -4, p1Wins: '5', p2Wins: 1.2, draws: 2 },
    })));
    expect(store.data.settings).toEqual({ volume: 1, reducedMotion: true });
    expect(store.data.lastMode).toBe('duel-ai');
    expect(store.data.stats).toEqual({ completed: 0, p1Wins: 0, p2Wins: 0, draws: 2 });
  });

  it('falls back for damaged or unsupported saves', () => {
    for (const raw of ['{broken', '{"version":999}', 'null']) {
      expect(new SaveStore(memoryStorage(raw)).data.stats.completed).toBe(0);
    }
  });

  it('keeps in-memory state usable when localStorage reads or writes throw', () => {
    const store = new SaveStore({ getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } });
    store.data.settings.volume = 0.8;
    expect(() => store.persist()).not.toThrow();
    expect(store.available).toBe(false);
    expect(store.data.settings.volume).toBe(0.8);
  });

  it('records a result once across reloads and excludes practice', () => {
    const storage = memoryStorage();
    const store = new SaveStore(storage);
    store.recordResult(result);
    store.recordResult(result);
    const restored = new SaveStore(storage);
    restored.recordResult(result);
    restored.recordResult({ ...result, id: 'practice', mode: 'training' });
    expect(restored.data.stats.completed).toBe(1);
    expect(restored.data.stats.p1Wins).toBe(1);
    expect(restored.data.stats.draws).toBe(0);
  });
});

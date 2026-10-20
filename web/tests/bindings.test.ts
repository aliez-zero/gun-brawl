import { describe, expect, it } from 'vitest';
import {
  BINDING_ACTIONS, DEFAULT_KEY_BINDINGS, cloneBindings, keyLabel, normalizeBindings, rebind,
} from '../src/content/controls';

describe('T06 key binding model', () => {
  it('has a unique default code map and labels every action', () => {
    const seen = new Map<string, string>();
    for (const slot of [1, 2] as const) {
      for (const { action } of BINDING_ACTIONS) {
        expect(DEFAULT_KEY_BINDINGS[slot][action].label.length).toBeGreaterThan(0);
        for (const code of DEFAULT_KEY_BINDINGS[slot][action].codes) {
          expect(seen.has(code), `${code} is assigned twice`).toBe(false);
          seen.set(code, `${slot}:${action}`);
        }
      }
    }
    expect(keyLabel('KeyQ')).toBe('Q');
    expect(keyLabel('Numpad2')).toBe('小键盘 2');
    expect(keyLabel('ArrowLeft')).toBe('←');
  });

  it('rebinds one action without mutating the current bindings', () => {
    const result = rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'KeyU');
    expect(result.error).toBeNull();
    expect(result.bindings[1].shoot).toEqual({ codes: ['KeyU'], label: 'U' });
    expect(DEFAULT_KEY_BINDINGS[1].shoot.codes).toEqual(['KeyJ']);
  });

  it('rejects same-player, cross-player and reserved keys', () => {
    expect(rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'KeyK').error).toMatch(/投弹/);
    expect(rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'ArrowLeft').error).toMatch(/玩家 2/);
    expect(rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'Escape').error).toMatch(/保留/);
    expect(rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'Digit3').error).toMatch(/训练/);
    expect(rebind(DEFAULT_KEY_BINDINGS, 1, 'shoot', 'ShiftLeft').error).toMatch(/保留/);
  });

  it('normalizes saved bindings and falls back when a saved map conflicts', () => {
    const valid = normalizeBindings({ 1: { jump: { codes: ['KeyZ'], label: 'Z' }, shoot: { codes: ['KeyU'], label: '<img>' } } });
    expect(valid[1].jump).toEqual({ codes: ['KeyZ'], label: 'Z' });
    expect(valid[1].shoot).toEqual({ codes: ['KeyU'], label: 'U' });
    expect(valid[1].bomb.label).toBe('K');

    const conflicting = normalizeBindings({ 1: { shoot: { codes: ['KeyK'], label: 'K' } } });
    expect(conflicting[1].shoot.codes).toEqual(['KeyJ']);
    expect(conflicting[1].bomb.codes).toEqual(['KeyK']);

    const malformed = normalizeBindings({ 1: { shoot: { codes: [], label: 'x' } }, 2: [] });
    expect(malformed).toEqual(DEFAULT_KEY_BINDINGS);
  });

  it('clones every alias and label', () => {
    const copy = cloneBindings();
    (copy[1].jump.codes as string[]).push('KeyZ');
    (copy[2].shoot as { label: string }).label = 'changed';
    expect(DEFAULT_KEY_BINDINGS[1].jump.codes).toEqual(['KeyW', 'Space']);
    expect(DEFAULT_KEY_BINDINGS[2].shoot.label).toBe('Enter / 小键盘 0');
  });
});

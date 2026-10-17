import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idleInput } from '../src/game/core/types';
import { KeyboardInput } from '../src/presentation/KeyboardInput';

let keyboard: KeyboardInput;
function key(type: 'keydown' | 'keyup', code: string, repeat = false): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('HTMLElement', class {});
  keyboard = new KeyboardInput(() => {});
  keyboard.enabled = true;
});
afterEach(() => { keyboard.destroy(); vi.unstubAllGlobals(); });

describe('keyboard controls', () => {
  it('keeps both players independent and supports shooting aliases without an early release', () => {
    key('keydown', 'KeyD');
    key('keydown', 'KeyJ');
    expect(keyboard.sample(1)).toEqual({ ...idleInput(), moveX: 1, shootHeld: true });
    expect(keyboard.sample(1).bombPressed).toBe(false);
    expect(keyboard.sample(2)).toEqual(idleInput());
    key('keydown', 'ArrowLeft');
    key('keydown', 'Enter');
    key('keydown', 'Numpad0');
    expect(keyboard.sample(2)).toEqual({ ...idleInput(), moveX: -1, shootHeld: true });
    key('keyup', 'Enter');
    expect(keyboard.sample(2).shootHeld).toBe(true);
    key('keyup', 'Numpad0');
    expect(keyboard.sample(2).shootHeld).toBe(false);
    key('keydown', 'NumpadEnter');
    expect(keyboard.sample(2).shootHeld).toBe(true);
    expect(keyboard.sample(1)).toEqual({ ...idleInput(), moveX: 1, shootHeld: true });
  });

  it('consumes simultaneous jump aliases once and requires a fresh press for another jump', () => {
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    key('keydown', 'KeyW');
    expect(keyboard.sample(1).jumpPressed).toBe(true);
    expect(keyboard.sample(1).jumpPressed).toBe(false);
    key('keydown', 'Space', true);
    expect(keyboard.sample(1).jumpPressed).toBe(false);
    key('keyup', 'Space');
    key('keydown', 'Space');
    expect(keyboard.sample(1).jumpPressed).toBe(true);
    key('keydown', 'KeyA');
    key('keydown', 'KeyD');
    expect(keyboard.sample(1).moveX).toBe(0);
  });

  it('exposes the default bomb edge for both players without holding it', () => {
    key('keydown', 'KeyK');
    expect(keyboard.sample(1).bombPressed).toBe(true);
    expect(keyboard.sample(1).bombPressed).toBe(false);
    key('keyup', 'KeyK');
    key('keydown', 'KeyK', true);
    expect(keyboard.sample(1).bombPressed).toBe(false);
    key('keyup', 'KeyK');
    key('keydown', 'KeyK');
    expect(keyboard.sample(1).bombPressed).toBe(true);

    expect(keyboard.sample(2).bombPressed).toBe(false);
    key('keydown', 'Numpad1');
    expect(keyboard.sample(2).bombPressed).toBe(true);
    expect(keyboard.sample(2).bombPressed).toBe(false);
  });

  it('consumes training 1-6 slots once and ignores them while disabled', () => {
    key('keydown', 'Digit3');
    expect(keyboard.consumeWeaponSlot()).toBe(3);
    expect(keyboard.consumeWeaponSlot()).toBeNull();
    keyboard.enabled = false;
    key('keydown', 'Digit6');
    expect(keyboard.consumeWeaponSlot()).toBeNull();
  });

  it('clears held inputs on blur and ignores late repeats and disabled input', () => {
    key('keydown', 'KeyJ');
    key('keydown', 'Space');
    window.dispatchEvent(new Event('blur'));
    key('keydown', 'KeyJ', true);
    key('keydown', 'Space', true);
    expect(keyboard.sample(1)).toEqual(idleInput());
    keyboard.enabled = false;
    expect(key('keydown', 'Space').defaultPrevented).toBe(false);
    expect(keyboard.sample(1)).toEqual(idleInput());
  });
});

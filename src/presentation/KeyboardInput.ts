import { KEY_BINDINGS } from '../content/controls';
import type { KeyBinding } from '../content/controls';
import type { ActorInput, HumanSlot } from '../game/core/types';

export class KeyboardInput {
  enabled = false;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly weaponCodes = Array.from({ length: 6 }, (_, index) => `Digit${index + 1}`);
  private readonly allowed = new Set([
    ...Object.values(KEY_BINDINGS).flatMap((bindings) => Object.values(bindings).flatMap((binding) => binding.codes)),
    ...this.weaponCodes,
  ]);
  private readonly onDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && !event.repeat) { this.onPause(); return; }
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, select, textarea') || target.isContentEditable)) return;
    if (!this.enabled || !this.allowed.has(event.code)) return;
    event.preventDefault();
    if (event.repeat && !this.held.has(event.code)) return;
    if (!event.repeat && !this.held.has(event.code)) this.pressed.add(event.code);
    this.held.add(event.code);
  };
  private readonly onUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    if (this.enabled && this.allowed.has(event.code)) event.preventDefault();
  };

  constructor(private readonly onPause: () => void) {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.clear);
  }

  sample(slot: HumanSlot): ActorInput {
    const binding = KEY_BINDINGS[slot];
    const held = (key: KeyBinding): boolean => key.codes.some((code) => this.held.has(code));
    const take = (key: KeyBinding): boolean => {
      let pressed = false;
      // Consume every alias together so W + Space cannot queue a second jump.
      for (const code of key.codes) if (this.pressed.delete(code)) pressed = true;
      return pressed;
    };
    return {
      moveX: ((held(binding.right) ? 1 : 0) - (held(binding.left) ? 1 : 0)) as -1 | 0 | 1,
      jumpPressed: take(binding.jump), dropPressed: take(binding.drop), shootHeld: held(binding.shoot),
      bombPressed: take(binding.bomb),
    };
  }

  /** Training-only 1-6 hotbar; returns null when no slot was pressed this frame. */
  consumeWeaponSlot(): number | null {
    for (let index = 0; index < this.weaponCodes.length; index++) {
      if (this.pressed.delete(this.weaponCodes[index]!)) return index + 1;
    }
    return null;
  }

  readonly clear = (): void => { this.held.clear(); this.pressed.clear(); };

  destroy(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.clear);
    this.clear();
  }
}

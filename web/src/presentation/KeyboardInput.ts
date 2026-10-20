import { DEFAULT_KEY_BINDINGS } from '../content/controls';
import type { KeyBinding, KeyBindings } from '../content/controls';
import type { ActorInput, HumanSlot } from '../game/core/types';

export class KeyboardInput {
  enabled = false;
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly weaponCodes = Array.from({ length: 8 }, (_, index) => `Digit${index + 1}`);
  private allowed = new Set<string>();

  private rebuildAllowed(): void {
    this.allowed = new Set([
      ...Object.values(this.bindings).flatMap((bindings) => Object.values(bindings).flatMap((binding) => binding.codes)),
      ...this.weaponCodes,
    ]);
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    this.rebuildAllowed();
    this.clear();
  }
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

  constructor(private readonly onPause: () => void, private bindings: KeyBindings = DEFAULT_KEY_BINDINGS) {
    this.rebuildAllowed();
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.clear);
  }

  sample(slot: HumanSlot): ActorInput {
    const binding = this.bindings[slot];
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
      bombPressed: take(binding.bomb), reloadPressed: take(binding.reload),
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

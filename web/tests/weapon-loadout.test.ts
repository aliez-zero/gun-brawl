import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { ARMORY_WEAPONS } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { MapDefinition, WeaponId } from '../src/game/core/types';
import { equipWeapon } from '../src/game/systems/WeaponSystem';

const map: MapDefinition = {
  id: 'loadout', name: 'loadout', width: 6000, height: 700,
  spawns: [{ x: 1200, y: 500 }, { x: 1350, y: 500 }],
  bounds: { left: -500, right: 6500, top: -500, bottom: 900 },
  platforms: [{ id: 'floor', x: 0, y: 500, width: 6000, height: 40, kind: 'solid' }],
};

/**
 * A pickup is only worth taking if its whole loadout can convert into a ring-out.
 * Fire everything (magazine, reloads, reserve) at a target that runs back, and
 * record how far it actually gets pushed before the gun runs dry.
 */
function dryLoadoutPush(id: WeaponId): number {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  shooter!.position = { x: 1200, y: 500 };
  target!.position = { x: 1350, y: 500 };
  shooter!.previous = { ...shooter!.position };
  target!.previous = { ...target!.position };
  shooter!.protectionRemaining = 0;
  target!.protectionRemaining = 0;
  equipWeapon(shooter!, id);
  const start = target!.position.x;
  let peak = 0;
  for (let frame = 0; frame < 60 * 25; frame++) {
    // Reverted to the pistol: the loadout is gone.
    if (shooter!.weapon.definition.id !== id) break;
    const gap = target!.position.x - shooter!.position.x;
    shooter!.facing = (gap >= 0 ? 1 : -1) as 1 | -1;
    simulation.step(FIXED_STEP, new Map([
      ['p1', { ...idleInput(), shootHeld: true, moveX: (gap > 220 ? 1 : gap < -220 ? -1 : 0) as -1 | 0 | 1 }],
      ['p2', { ...idleInput(), moveX: (gap >= 0 ? -1 : 1) as -1 | 1 }],
    ]));
    simulation.drainEvents();
    peak = Math.max(peak, target!.position.x - start);
  }
  return peak;
}

describe('every pickup can finish a ring-out', () => {
  it('pushes a resisting target at least half a screen with one full loadout', () => {
    for (const weapon of ARMORY_WEAPONS) {
      const push = Math.round(dryLoadoutPush(weapon.id));
      expect(push, `${weapon.id} (${weapon.maxAmmo}+${weapon.reserveAmmo ?? 0}, ${weapon.reloadTime}s reload)`).toBeGreaterThanOrEqual(640);
    }
  }, 120_000);

  it('keeps reload times short enough to matter', () => {
    for (const weapon of ARMORY_WEAPONS) {
      if (weapon.maxAmmo === null) continue;
      expect(weapon.reloadTime ?? 0, `${weapon.id} reload`).toBeLessThanOrEqual(1.8);
    }
  });
});

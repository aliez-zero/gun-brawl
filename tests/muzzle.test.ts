import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { ARMORY_WEAPONS, WEAPONS, weaponMuzzle } from '../src/content/weapons';
import type { MapDefinition, WeaponId } from '../src/game/core/types';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import { equipWeapon } from '../src/game/systems/WeaponSystem';

const flatMap: MapDefinition = {
  id: 'muzzle-flat', name: 'muzzle-flat', width: 3000, height: 700,
  spawns: [{ x: 500, y: 500 }, { x: 1300, y: 500 }],
  bounds: { left: -500, right: 3500, top: -500, bottom: 700 },
  platforms: [{ id: 'floor', x: 0, y: 500, width: 3000, height: 100, kind: 'solid' }],
};

function fired(id: WeaponId, facing: -1 | 1): { x: number; y: number; shot: { x: number; y: number } } {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 7), map: flatMap, countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  shooter!.position = { x: 500, y: 500 };
  target!.position = { x: 1300, y: 500 };
  shooter!.previous = { ...shooter!.position };
  target!.previous = { ...target!.position };
  shooter!.facing = facing;
  shooter!.protectionRemaining = 0;
  target!.protectionRemaining = 0;
  equipWeapon(shooter!, id);
  simulation.drainEvents();
  simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
  const projectile = simulation.state.projectiles.find((candidate) => candidate.owner === 'p1');
  if (!projectile) throw new Error(`${id} did not fire`);
  const shot = simulation.drainEvents().find((event) => event.type === 'shot' && event.actorId === 'p1');
  if (!shot || shot.type !== 'shot') throw new Error(`${id} did not emit a shot event`);
  expect(projectile.origin).toEqual(projectile.previous);
  return { x: projectile.previous.x, y: projectile.previous.y, shot: { x: shot.position.x, y: shot.position.y } };
}

describe('T01 muzzle alignment', () => {
  const ids = [
    ...ARMORY_WEAPONS.map((weapon) => weapon.id),
    ...Object.keys(WEAPONS) as WeaponId[],
  ];

  it('spawns every projectile and shot flash at that weapon muzzle, not a shared chest point', () => {
    for (const id of ids) {
      const muzzle = weaponMuzzle(id);
      expect(muzzle.x, `${id} muzzle x`).toBeGreaterThan(25);
      // Longer redrawn barrels push the tip out; the ceiling only has to catch
      // a muzzle that drifts past the character's own silhouette.
      expect(muzzle.x, `${id} muzzle x`).toBeLessThan(100);
      expect(muzzle.y, `${id} muzzle y`).toBeGreaterThan(-45);
      expect(muzzle.y, `${id} muzzle y`).toBeLessThan(-30);

      const result = fired(id, 1);
      expect(result.x, `${id} projectile x`).toBeCloseTo(500 + muzzle.x, 5);
      expect(result.y, `${id} projectile y`).toBeCloseTo(500 + muzzle.y, 5);
      expect(result.shot.x, `${id} flash x`).toBeCloseTo(result.x, 5);
      expect(result.shot.y, `${id} flash y`).toBeCloseTo(result.y, 5);
    }
  });

  it('mirrors the muzzle when facing left', () => {
    const muzzle = weaponMuzzle('awm');
    const result = fired('awm', -1);
    expect(result.x).toBeCloseTo(500 - muzzle.x, 5);
    expect(result.y).toBeCloseTo(500 + muzzle.y, 5);
    expect(result.shot.x).toBeCloseTo(result.x, 5);
  });
});

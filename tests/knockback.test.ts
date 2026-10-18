import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import type { WeaponId } from '../src/game/core/types';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import { equipWeapon } from '../src/game/systems/WeaponSystem';

const map = {
  id: 'knockback', name: 'knockback', width: 3000, height: 700,
  spawns: [{ x: 200, y: 500 }, { x: 800, y: 500 }],
  bounds: { left: -500, right: 3500, top: -500, bottom: 700 },
  platforms: [{ id: 'floor', x: 0, y: 500, width: 3000, height: 100, kind: 'solid' as const }],
};

/** One clean hit at mid-range, then 2.5 s of free movement; returns the push in px. */
function pushedDistance(id: WeaponId): number {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  shooter!.position = { x: 600, y: 500 };
  target!.position = { x: 750, y: 500 };
  shooter!.previous = { ...shooter!.position };
  target!.previous = { ...target!.position };
  shooter!.protectionRemaining = 0;
  target!.protectionRemaining = 0;
  equipWeapon(shooter!, id);
  const start = target!.position.x;
  simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
  for (let frame = 0; frame < 150; frame++) simulation.step(FIXED_STEP, new Map());
  return Math.abs(target!.position.x - start);
}

describe('T01 CF-style knockback roles', () => {
  it('pushes rifles harder than pistols, and snipers harder than rifles', () => {
    const pistol = pushedDistance('pistol');
    const deagle = pushedDistance('deagle');
    const m416 = pushedDistance('m416');
    const akm = pushedDistance('akm');
    const s1897 = pushedDistance('s1897');
    const kar98k = pushedDistance('kar98k');
    const m24 = pushedDistance('m24');
    const awm = pushedDistance('awm');

    expect(pistol).toBeGreaterThan(100);
    expect(pistol).toBeLessThan(200);
    expect(deagle).toBeGreaterThan(pistol);
    expect(m416).toBeGreaterThan(pistol * 1.3);
    expect(m416).toBeLessThan(320);
    expect(akm).toBeGreaterThan(m416);
    expect(s1897).toBeGreaterThan(m416);
    expect(s1897).toBeLessThan(500);
    expect(kar98k).toBeGreaterThan(akm);
    expect(m24).toBeGreaterThan(kar98k);
    expect(awm).toBeGreaterThan(m24);
    expect(awm).toBeLessThan(750);
  });
});

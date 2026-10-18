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
    const s686 = pushedDistance('s686');
    const s1897 = pushedDistance('s1897');
    const s12k = pushedDistance('s12k');
    const kar98k = pushedDistance('kar98k');
    const m24 = pushedDistance('m24');
    const awm = pushedDistance('awm');
    const rpg7 = pushedDistance('rpg7');
    const at4 = pushedDistance('at4');
    const shotgun = pushedDistance('shotgun');
    const rocket = pushedDistance('rocket');

    expect(pistol).toBeGreaterThan(100);
    expect(pistol).toBeLessThan(200);
    expect(deagle).toBeGreaterThan(pistol);
    expect(m416).toBeGreaterThan(pistol * 1.3);
    expect(m416).toBeLessThan(320);
    expect(akm).toBeGreaterThan(m416);
    expect(kar98k).toBeGreaterThan(akm);
    expect(m24).toBeGreaterThan(kar98k);
    expect(awm).toBeGreaterThan(m24);
    expect(awm).toBeLessThan(750);

    // A close-range shotgun blast and a direct rocket are one-shot screen-outs:
    // the target starts at x=750 on a 1280-wide view, so >530 px leaves the screen.
    expect(750 + s686).toBeGreaterThan(1280);
    expect(750 + s1897).toBeGreaterThan(1280);
    expect(750 + s12k).toBeGreaterThan(1280);
    expect(750 + shotgun).toBeGreaterThan(1280);
    expect(750 + rpg7).toBeGreaterThan(1280);
    expect(750 + at4).toBeGreaterThan(1280);
    expect(750 + rocket).toBeGreaterThan(1280);
    expect(s1897).toBeGreaterThan(s686);
    expect(s686).toBeGreaterThan(s12k);
    expect(at4).toBeGreaterThan(rpg7);
    expect(rpg7).toBeGreaterThan(850);
    expect(at4).toBeGreaterThan(1000);
  });
});

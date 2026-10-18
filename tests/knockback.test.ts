import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import type { WeaponId } from '../src/game/core/types';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import { BASIC_PISTOL, getWeapon, weaponSustainedImpulse } from '../src/content/weapons';
import { equipWeapon } from '../src/game/systems/WeaponSystem';

const map = {
  id: 'knockback', name: 'knockback', width: 3000, height: 700,
  spawns: [{ x: 200, y: 500 }, { x: 800, y: 500 }],
  bounds: { left: -500, right: 3500, top: -500, bottom: 700 },
  platforms: [{ id: 'floor', x: 0, y: 500, width: 3000, height: 100, kind: 'solid' as const }],
};

/** One clean hit at `distance`, then 2.5 s of free movement; returns the push in px. */
function pushedDistance(id: WeaponId, distance = 150): number {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  shooter!.position = { x: 600, y: 500 };
  target!.position = { x: 600 + distance, y: 500 };
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

/**
 * Can sustained fire shove a target that runs back at full speed a full half
 * screen (640 px) within 4 s? The window covers one magazine plus a reload, so a
 * 1200 RPM SMG is not failed purely for emptying its mag. Only automatics can do
 * it; a single heavy hit decays faster than a victim can run, so burst weapons
 * need an edge or an airborne target.
 */
function framesToPush(id: WeaponId): number {
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
  for (let frame = 0; frame < 240; frame++) {
    // Chase, but stop closing at 220 px so the shooter never walks past the
    // victim and ends up firing backwards.
    const gap = target!.position.x - shooter!.position.x;
    const inputs = new Map([
      ['p1', { ...idleInput(), shootHeld: true, moveX: (gap > 220 ? 1 : 0) as -1 | 0 | 1 }],
      ['p2', { ...idleInput(), moveX: -1 as const }],
    ]);
    simulation.step(FIXED_STEP, inputs);
    simulation.drainEvents();
    if (target!.position.x - start >= 640) return frame + 1;
  }
  return Infinity;
}

describe('sustained ring-out against a resisting target', () => {
  it('lets automatics walk a full-speed runner off the stage', () => {
    for (const id of ['ump45', 'vector', 'uzi', 'm416', 'akm', 'scar-l'] as const) {
      expect(framesToPush(id), `${id} should shove a runner`).toBeLessThan(240);
    }
  });

  it('keeps burst weapons far behind automatics at pushing a runner', () => {
    const rifle = framesToPush('m416');
    for (const id of ['pistol', 's1897', 'kar98k'] as const) {
      expect(framesToPush(id), `${id} must be slower than a rifle`).toBeGreaterThan(rifle * 1.5);
    }
  });
});

describe('weapon knockback tiers', () => {
  it('keeps the pistol as the 100–200 px baseline', () => {
    const pistol = pushedDistance('pistol');
    expect(pistol).toBeGreaterThan(100);
    expect(pistol).toBeLessThan(200);
  });

  it('orders single hits pistol < rifle < sniper < rocket', () => {
    const pistol = pushedDistance('pistol');
    const m416 = pushedDistance('m416');
    const akm = pushedDistance('akm');
    const kar98k = pushedDistance('kar98k');
    const m24 = pushedDistance('m24');
    const awm = pushedDistance('awm');
    const rpg7 = pushedDistance('rpg7');
    const at4 = pushedDistance('at4');

    expect(m416).toBeGreaterThan(pistol);
    expect(akm).toBeGreaterThan(m416);
    expect(kar98k).toBeGreaterThan(akm);
    expect(m24).toBeGreaterThan(kar98k);
    expect(awm).toBeGreaterThan(m24);
    expect(rpg7).toBeGreaterThan(awm);
    expect(at4).toBeGreaterThan(rpg7);
    expect(awm).toBeLessThan(750);
  });

  it('makes shotguns a 300–520 px close-range burst, not a one-shot screen-out', () => {
    // All pellets must connect, so measure inside each gun's range.
    const s686 = pushedDistance('s686', 100);
    const s1897 = pushedDistance('s1897', 100);
    const s12k = pushedDistance('s12k', 100);
    const shotgun = pushedDistance('shotgun', 100);

    for (const [name, push] of Object.entries({ s686, s1897, s12k, shotgun })) {
      expect(push, `${name} burst`).toBeGreaterThan(240);
      expect(push, `${name} burst`).toBeLessThan(520);
    }
    expect(s1897).toBeGreaterThan(s686);
    expect(s686).toBeGreaterThan(s12k);
  });

  it('lets heavy single shots finish at the ledge, but never a shotgun', () => {
    // Target starts at x=750 on a 1280-wide view, so >530 px leaves the screen.
    for (const id of ['m24', 'awm', 'rpg7', 'at4', 'rocket'] as const) {
      expect(750 + pushedDistance(id), `${id} ledge finish`).toBeGreaterThan(1280);
    }
    for (const id of ['s686', 's1897', 's12k'] as const) {
      expect(750 + pushedDistance(id, 100), `${id} must need a follow-up`).toBeLessThan(1280);
    }
  });

  it('trades single-hit push for sustained pressure', () => {
    const pressure = (id: WeaponId): number => weaponSustainedImpulse(getWeapon(id));
    const pistol = weaponSustainedImpulse(BASIC_PISTOL);
    // Automatics win by cadence, not by a heavier bullet.
    // Automatics win by cadence. SMGs sit below the pistol's per-shot push;
    // rifles stay slightly above it but far below one sniper round.
    for (const id of ['ump45', 'vector', 'uzi', 'm416', 'akm', 'scar-l'] as const) {
      expect(pressure(id), `${id} pressure`).toBeGreaterThan(pistol);
    }
    for (const id of ['ump45', 'vector', 'uzi'] as const) {
      expect(getWeapon(id).knockback, `${id} per-shot`).toBeLessThan(BASIC_PISTOL.knockback);
    }
    expect(getWeapon('awm').knockback).toBeGreaterThan(getWeapon('akm').knockback * 1.5);
    expect(pressure('m416')).toBeGreaterThan(pressure('ump45'));
    expect(pressure('akm')).toBeGreaterThan(pressure('m416'));
  });
});

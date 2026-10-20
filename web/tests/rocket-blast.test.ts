import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { getWeapon } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { MapDefinition } from '../src/game/core/types';
import { ExplosionSystem } from '../src/game/systems/ExplosionSystem';
import { equipWeapon } from '../src/game/systems/WeaponSystem';

const map: MapDefinition = {
  id: 'rocket-blast', name: 'rocket-blast', width: 3000, height: 800,
  spawns: [{ x: 1000, y: 500 }, { x: 1300, y: 500 }],
  bounds: { left: -500, right: 3500, top: -500, bottom: 1000 },
  platforms: [{ id: 'floor', x: 0, y: 500, width: 3000, height: 40, kind: 'solid' }],
};

function directHit(id: 'rpg7' | 'at4') {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  shooter!.position = { x: 1000, y: 500 };
  target!.position = { x: 1300, y: 500 };
  shooter!.previous = { ...shooter!.position };
  target!.previous = { ...target!.position };
  shooter!.facing = 1;
  shooter!.protectionRemaining = 0;
  target!.protectionRemaining = 0;
  equipWeapon(shooter!, id);
  const start = target!.position.x;
  const events = [];
  let peak = 0;
  for (let frame = 0; frame < 150; frame++) {
    simulation.step(FIXED_STEP, new Map([
      ['p1', { ...idleInput(), shootHeld: frame < 2 }],
      ['p2', idleInput()],
    ]));
    events.push(...simulation.drainEvents());
    peak = Math.max(peak, target!.position.x - start);
  }
  return { target, events, peak };
}

describe('rocket blast', () => {
  it.each(['rpg7', 'at4'] as const)('%s detonates on a direct hit and launches the victim', (id) => {
    const { events, peak } = directHit(id);
    expect(events.some((event) => event.type === 'explosion'), 'rocket must detonate').toBe(true);
    expect(events.some((event) => event.type === 'hit' && event.actorId === 'p2'), 'direct hit must connect').toBe(true);
    expect(peak, 'direct launch').toBeGreaterThan(700);
  });

  it.each(['rpg7', 'at4'] as const)('%s splashes a target it never touched', (id) => {
    const explosion = getWeapon(id).explosion!;
    const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0 });
    simulation.step(FIXED_STEP, new Map());
    const target = simulation.state.actors[1]!;
    target.position = { x: 1300, y: 500 };
    target.protectionRemaining = 0;
    // Blast 100 px to the right of the victim, in open air: falls inside the radius.
    const hits = new ExplosionSystem().resolve(simulation.state, {
      ownerId: 'p1', source: 'rocket', center: { x: 1400, y: 474 },
      radius: explosion.radius, centerImpulse: explosion.centerImpulse, edgeImpulse: explosion.edgeImpulse,
    });
    const hit = hits.find((entry) => entry.actorId === 'p2');
    expect(hit, 'splash must reach a nearby target').toBeTruthy();
    expect(Math.hypot(hit!.impulse.x, hit!.impulse.y), 'splash push').toBeGreaterThan(400);
    expect(hit!.impulse.x).toBeLessThan(0);
  });

  it('keeps splash radius and falloff on the weapon definition', () => {
    const rpg = getWeapon('rpg7').explosion!;
    const at4 = getWeapon('at4').explosion!;
    expect(rpg.radius).toBeGreaterThanOrEqual(200);
    expect(rpg.edgeImpulse).toBeGreaterThanOrEqual(600);
    expect(at4.centerImpulse).toBeGreaterThan(rpg.centerImpulse);
    expect(at4.radius).toBeGreaterThanOrEqual(180);
  });
});

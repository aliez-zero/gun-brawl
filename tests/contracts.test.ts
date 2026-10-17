import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BASIC_PISTOL } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { createWeaponInstance, idleInput } from '../src/game/core/types';
import type { ActorInput, MatchConfig, WeaponDefinition } from '../src/game/core/types';

const TEST_SMG: WeaponDefinition = {
  id: 'smg', name: '测试冲锋枪', interval: 0.1,
  projectileSpeed: 900, range: 600, knockback: 120, recoil: 0, maxAmmo: 12,
  pellets: 1, spreadRadians: 0,
};

function active(overrides: Partial<MatchConfig> = {}): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 1234), countdown: 0, ...overrides });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  simulation.drainEvents();
  return simulation;
}

function tick(simulation: BattleSimulation, frames: number, input?: ActorInput): void {
  for (let i = 0; i < frames; i++) simulation.step(FIXED_STEP, input ? new Map([['p1', input]]) : new Map());
}

describe('T00 first-batch contracts', () => {
  it('gives every actor a fresh starting weapon and keeps the no-op bomb input default', () => {
    expect(idleInput()).toEqual({
      moveX: 0, jumpPressed: false, dropPressed: false, shootHeld: false, bombPressed: false,
    });
    expect(createWeaponInstance(BASIC_PISTOL).ammoRemaining).toBeNull();
    expect(createWeaponInstance(TEST_SMG).ammoRemaining).toBe(12);

    const config = createMatchConfig('local-duel', 42);
    expect(config.startingWeapon).toBe(BASIC_PISTOL);
    const simulation = new BattleSimulation({ ...config, countdown: 0 });
    for (const actor of simulation.state.actors) {
      expect(actor.weapon.definition).toBe(BASIC_PISTOL);
      expect(actor.weapon.ammoRemaining).toBeNull();
    }
  });

  it('freezes projectile velocity and impulse at fire time when the actor switches guns', () => {
    const simulation = active();
    const [shooter, target] = simulation.state.actors;
    shooter!.position.x = 500;
    shooter!.facing = 1;
    shooter!.weapon = createWeaponInstance(TEST_SMG);
    target!.position.x = 700;
    target!.protectionRemaining = 0;

    simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    const projectile = simulation.state.projectiles[0]!;
    expect(projectile.weaponId).toBe('smg');
    expect(projectile.velocity).toEqual({ x: 900, y: 0 });
    expect(projectile.impulse).toEqual({ x: 120, y: -24 });
    expect(projectile.distanceRemaining).toBeCloseTo(585);

    // The in-flight round keeps the old gun's values even after the actor is back on the pistol.
    shooter!.weapon = createWeaponInstance(BASIC_PISTOL);
    simulation.drainEvents();
    let hit = false;
    for (let frame = 0; frame < 30 && !hit; frame++) {
      simulation.step(FIXED_STEP, new Map());
      hit = simulation.drainEvents().some((event) => event.type === 'hit' && event.actorId === target!.config.id);
    }
    expect(hit).toBe(true);
    expect(target!.impulse.x).toBe(120);
    expect(target!.impulse.y).toBe(-24);
  });

  it('resets the current weapon on respawn and overtime from MatchConfig.startingWeapon', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    actor.weapon = createWeaponInstance(TEST_SMG);
    actor.position.x = simulation.state.config.map.bounds.right + 100;
    tick(simulation, 1);
    expect(actor.status).toBe('respawning');
    tick(simulation, 70);
    expect(actor.status).toBe('alive');
    expect(actor.weapon.definition.id).toBe('pistol');
    expect(actor.weapon.ammoRemaining).toBeNull();

    const overtime = active();
    const leader = overtime.state.actors[0]!;
    leader.weapon = createWeaponInstance(TEST_SMG);
    overtime.state.remaining = FIXED_STEP;
    tick(overtime, 1);
    expect(overtime.state.overtime).toBe(true);
    expect(leader.weapon.definition.id).toBe('pistol');
    expect(leader.weapon.ammoRemaining).toBeNull();
  });

  it('uses an explicit match ID for result identity while preserving the legacy fallback', () => {
    const simulation = active({ stocks: 1, matchId: 'match-unique' });
    simulation.state.actors[1]!.position.y = 1000;
    tick(simulation, 1);
    expect(simulation.state.result?.id).toBe('match-unique');

    const legacy = active({ stocks: 1 });
    legacy.state.actors[1]!.position.y = 1000;
    tick(legacy, 1);
    expect(legacy.state.result?.id).toBe('1234-local-duel');
  });
});

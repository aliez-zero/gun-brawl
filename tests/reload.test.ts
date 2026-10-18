import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import { equipWeapon, refillWeapon } from '../src/game/systems/WeaponSystem';

function simulation(): BattleSimulation {
  const match = new BattleSimulation({ ...createMatchConfig('local-duel', 71), countdown: 0 });
  match.step(FIXED_STEP, new Map());
  match.step(FIXED_STEP, new Map());
  return match;
}

function step(match: BattleSimulation, frames: number, input = idleInput()): void {
  for (let frame = 0; frame < frames; frame++) match.step(FIXED_STEP, new Map([['p1', input]]));
}

describe('T01 magazine and reload', () => {
  it('auto-reloads an empty SMG from reserve and restores the magazine', () => {
    const match = simulation();
    const actor = match.state.actors[0]!;
    equipWeapon(actor, 'smg');
    actor.weapon.ammoRemaining = 1;
    step(match, 1, { ...idleInput(), shootHeld: true });
    expect(actor.weapon.ammoRemaining).toBe(0);
    expect(actor.reloadRemaining).toBe(0);

    // Holding fire starts the reload after the SMG cadence, without a free round.
    step(match, 10, { ...idleInput(), shootHeld: true });
    expect(actor.reloadRemaining).toBeGreaterThan(0);
    expect(actor.weapon.ammoRemaining).toBe(0);
    expect(actor.weapon.reserveRemaining).toBe(90);
    expect(match.drainEvents().some((event) => event.type === 'reload-start' && event.weaponId === 'smg')).toBe(true);

    step(match, 100);
    expect(actor.reloadRemaining).toBe(0);
    expect(actor.weapon.ammoRemaining).toBe(30);
    expect(actor.weapon.reserveRemaining).toBe(60);
  });

  it('starts a manual reload and only loads what the reserve can provide', () => {
    const match = simulation();
    const actor = match.state.actors[0]!;
    equipWeapon(actor, 'shotgun');
    actor.weapon.ammoRemaining = 1;
    actor.weapon.reserveRemaining = 2;

    step(match, 1, { ...idleInput(), reloadPressed: true });
    expect(actor.reloadRemaining).toBeCloseTo(2);
    step(match, 1, { ...idleInput(), reloadPressed: true });
    expect(actor.reloadRemaining).toBeCloseTo(2 - FIXED_STEP);

    step(match, 130);
    expect(actor.reloadRemaining).toBe(0);
    expect(actor.weapon.ammoRemaining).toBe(3);
    expect(actor.weapon.reserveRemaining).toBe(0);
  });

  it('does not reload the infinite pistol and refill restores both pools', () => {
    const match = simulation();
    const actor = match.state.actors[0]!;
    expect(actor.weapon.ammoRemaining).toBeNull();
    step(match, 1, { ...idleInput(), reloadPressed: true });
    expect(actor.reloadRemaining).toBe(0);
    expect(actor.weapon.ammoRemaining).toBeNull();

    equipWeapon(actor, 'gatling');
    actor.weapon.ammoRemaining = 0;
    actor.weapon.reserveRemaining = 0;
    refillWeapon(actor);
    expect(actor.weapon.ammoRemaining).toBe(100);
    expect(actor.weapon.reserveRemaining).toBe(100);
    expect(actor.reloadRemaining).toBe(0);
  });

  it('blocks firing while reloading and does not consume reserve twice', () => {
    const match = simulation();
    const actor = match.state.actors[0]!;
    equipWeapon(actor, 'rifle');
    actor.weapon.ammoRemaining = 10;
    actor.weapon.reserveRemaining = 20;
    step(match, 1, { ...idleInput(), reloadPressed: true });
    const projectiles = match.state.projectiles.length;

    step(match, 20, { ...idleInput(), shootHeld: true });
    expect(actor.reloadRemaining).toBeGreaterThan(0);
    expect(match.state.projectiles.length).toBe(projectiles);

    step(match, 100);
    expect(actor.weapon.ammoRemaining).toBe(30);
    expect(actor.weapon.reserveRemaining).toBe(0);
  });
});

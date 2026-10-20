import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { WEAPON_SLOTS } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import { TrainingSystem } from '../src/game/systems/TrainingSystem';

function training(): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('training', 42), countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  return simulation;
}

describe('T08 training hotbar', () => {
  it('maps 1-8 to the eight real definitions and refills the human player', () => {
    for (let slot = 1; slot <= WEAPON_SLOTS.length; slot++) {
      const simulation = training();
      const actor = simulation.state.actors[0]!;
      actor.weapon.ammoRemaining = 0;
      expect(simulation.selectTrainingWeapon(slot)).toBe(true);
      expect(actor.weapon.definition.id).toBe(WEAPON_SLOTS[slot - 1]);
      expect(actor.weapon.ammoRemaining).toBe(actor.weapon.definition.maxAmmo);
      expect(actor.weapon.reserveRemaining).toBe(actor.weapon.definition.reserveAmmo ?? 0);
    }
  });

  it('leaves the training dummy alone and rejects invalid slots', () => {
    const simulation = training();
    const [player, dummy] = simulation.state.actors;
    expect(simulation.selectTrainingWeapon(4)).toBe(true);
    expect(player!.weapon.definition.id).toBe('shotgun');
    expect(dummy!.weapon.definition.id).toBe('pistol');
    expect(simulation.selectTrainingWeapon(0)).toBe(false);
    expect(simulation.selectTrainingWeapon(9)).toBe(false);
  });

  it('is a no-op outside training mode', () => {
    const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), countdown: 0 });
    simulation.step(FIXED_STEP, new Map());
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.selectTrainingWeapon(2)).toBe(false);
    expect(simulation.state.actors[0]!.weapon.definition.id).toBe('pistol');
  });

  it('advances movement, double jump and drop from real simulation input only', () => {
    const simulation = training();
    expect(simulation.state.training).toBeDefined();
    const move = new Map([['p1', { ...idleInput(), moveX: 1 as const }]]);
    for (let i = 0; i < 40; i++) simulation.step(FIXED_STEP, move);
    expect(simulation.state.training?.completed.move).toBe(true);

    const jump = new Map([['p1', { ...idleInput(), jumpPressed: true }]]);
    simulation.step(FIXED_STEP, jump);
    simulation.step(FIXED_STEP, new Map());
    simulation.step(FIXED_STEP, jump);
    expect(simulation.state.training?.completed['double-jump']).toBe(true);

    const dropSimulation = training();
    const drop = new Map([['p1', { ...idleInput(), dropPressed: true }]]);
    dropSimulation.step(FIXED_STEP, drop);
    expect(dropSimulation.state.training?.completed.drop).toBe(true);
  });

  it('marks hit, ringout and bomb only from matching events', () => {
    const simulation = training();
    const system = new TrainingSystem();
    const state = simulation.state;
    const at = { x: 600, y: 500 };
    state.actors.find((actor) => actor.config.id === 'dummy')!.protectionRemaining = 1;
    system.update(state, new Map(), FIXED_STEP, [{ type: 'hit', actorId: 'dummy', position: at }]);
    expect(system.state.completed.hit).toBe(false);
    state.actors.find((actor) => actor.config.id === 'dummy')!.protectionRemaining = 0;
    system.update(state, new Map(), FIXED_STEP, [{ type: 'hit', actorId: 'dummy', position: at }]);
    expect(system.state.completed.hit).toBe(true);
    system.update(state, new Map(), FIXED_STEP, [{ type: 'ringout', actorId: 'dummy', position: at, creditedTo: 'p1' }]);
    expect(system.state.completed.ringout).toBe(true);
    system.update(state, new Map(), FIXED_STEP, [{ type: 'bomb', actorId: 'p1', position: at, bombId: 1 }]);
    expect(system.state.completed.bomb).toBe(true);

    const invalid = new TrainingSystem();
    invalid.update(state, new Map(), FIXED_STEP, [{ type: 'hit', actorId: 'p1', position: at }]);
    expect(invalid.state.completed.hit).toBe(false);
  });

  it('resets hazards and positions without clearing completed tasks', () => {
    const simulation = training();
    const state = simulation.state;
    state.training!.completed.move = true;
    state.training!.completedTasks.push('move');
    state.bombs.push({ id: 1, owner: 'p1', position: { x: 1, y: 2 }, previous: { x: 1, y: 2 }, velocity: { x: 0, y: 0 }, fuseRemaining: 1, radius: 10 });
    state.drops.push({ id: 2, weaponId: 'rifle', position: { x: 1, y: 2 }, state: 'active', timer: 4, warning: false });
    state.projectiles.push({ id: 3, owner: 'p1', weaponId: 'pistol', position: { x: 1, y: 2 }, previous: { x: 1, y: 2 }, direction: 1, velocity: { x: 10, y: 0 }, impulse: { x: 10, y: 0 }, distanceRemaining: 10 });
    expect(simulation.resetTraining()).toBe(true);
    expect(state.projectiles).toHaveLength(0);
    expect(state.bombs).toHaveLength(0);
    expect(state.drops).toHaveLength(0);
    expect(state.phase).toBe('countdown');
    expect(state.actors[0]!.position).toEqual(state.config.map.spawns[0]);
    simulation.setDummyMoving(false);
    expect(simulation.state.training?.dummyMoving).toBe(false);
    expect(simulation.state.training?.completedTasks).toContain('move');
    expect(simulation.resetTraining()).toBe(true);
  });
});

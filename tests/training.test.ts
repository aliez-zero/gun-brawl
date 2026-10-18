import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { WEAPON_SLOTS } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';

function training(): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('training', 42), countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  return simulation;
}

describe('T08 training hotbar', () => {
  it('maps 1-6 to the six real definitions and refills the human player', () => {
    for (let slot = 1; slot <= WEAPON_SLOTS.length; slot++) {
      const simulation = training();
      const actor = simulation.state.actors[0]!;
      actor.weapon.ammoRemaining = 0;
      expect(simulation.selectTrainingWeapon(slot)).toBe(true);
      expect(actor.weapon.definition.id).toBe(WEAPON_SLOTS[slot - 1]);
      expect(actor.weapon.ammoRemaining).toBe(actor.weapon.definition.maxAmmo);
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
});

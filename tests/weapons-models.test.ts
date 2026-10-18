import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { DEFAULT_DROP_POOL, STANDARD_DROP_POOL } from '../src/content/drops';
import { ARMORY_WEAPONS, WEAPON_MODELS, createWeapon, getWeapon } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';

function training(): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('training', 42), countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  return simulation;
}

describe('T01 17 concrete weapon models', () => {
  it('registers exactly 17 unique armory entries while keeping generic aliases', () => {
    expect(ARMORY_WEAPONS).toHaveLength(17);
    expect(new Set(ARMORY_WEAPONS.map((weapon) => weapon.id)).size).toBe(17);
    expect(ARMORY_WEAPONS[0]?.id).toBe('pistol');
    for (const weapon of ARMORY_WEAPONS) {
      expect(getWeapon(weapon.id)).toBe(weapon);
      expect(weapon.name.length).toBeGreaterThan(0);
    }
    expect(Object.keys(WEAPON_MODELS)).toHaveLength(16);
  });

  it('uses per-model magazines, reserves and reload times', () => {
    expect(createWeapon('vector')).toMatchObject({ ammoRemaining: 19, reserveRemaining: 95 });
    expect(createWeapon('awm')).toMatchObject({ ammoRemaining: 5, reserveRemaining: 15 });
    expect(createWeapon('s686')).toMatchObject({ ammoRemaining: 2, reserveRemaining: 10 });
    expect(getWeapon('awm').reloadTime).toBe(2.6);
    expect(getWeapon('vector').reloadTime).toBe(1.5);
    expect(getWeapon('rpg7').explosion).toEqual({ radius: 140, centerImpulse: 330, edgeImpulse: 80 });
    expect(getWeapon('at4').recoilY).toBe(24);
  });

  it('selects a concrete model directly in training without changing the dummy', () => {
    const simulation = training();
    expect(simulation.selectTrainingWeapon('akm')).toBe(true);
    expect(simulation.state.actors[0]?.weapon.definition.id).toBe('akm');
    expect(simulation.state.actors[1]?.weapon.definition.id).toBe('pistol');
  });

  it('places every concrete standard model in drops and keeps ultimates out of standard-only', () => {
    const pool = new Set(STANDARD_DROP_POOL.map((entry) => entry.weaponId));
    for (const weapon of ARMORY_WEAPONS) {
      if (weapon.tier === 'ultimate') continue;
      if (weapon.id === 'pistol') continue;
      expect(pool.has(weapon.id), `${weapon.id} missing from standard pool`).toBe(true);
    }
    expect(pool.has('gatling')).toBe(false);
    expect(pool.has('cannon')).toBe(false);
    expect(DEFAULT_DROP_POOL.some((entry) => entry.weaponId === 'gatling')).toBe(true);
  });
});

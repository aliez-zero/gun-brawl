import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { DEFAULT_DROP_POOL, STANDARD_DROP_POOL } from '../src/content/drops';
import { ARMORY_WEAPONS, BASIC_PISTOL, WEAPON_MODELS, createWeapon, getWeapon, weaponBurstImpulse, weaponSustainedImpulse } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { supportGrip } from '../src/presentation/WeaponSupport';

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
    expect(createWeapon('vector')).toMatchObject({ ammoRemaining: 22, reserveRemaining: 66 });
    expect(createWeapon('awm')).toMatchObject({ ammoRemaining: 5, reserveRemaining: 25 });
    expect(createWeapon('s686')).toMatchObject({ ammoRemaining: 2, reserveRemaining: 20 });
    expect(getWeapon('awm').reloadTime).toBe(1.6);
    expect(getWeapon('vector').reloadTime).toBe(1.1);
    expect(getWeapon('rpg7').explosion).toEqual({ radius: 220, centerImpulse: 2000, edgeImpulse: 700 });
    expect(getWeapon('at4').recoilY).toBe(18);
  });

  it('separates models by burst impulse, sustained pressure and role', () => {
    const burst = (id: Parameters<typeof getWeapon>[0]): number => weaponBurstImpulse(getWeapon(id));
    const pressure = (id: Parameters<typeof getWeapon>[0]): number => weaponSustainedImpulse(getWeapon(id));
    expect(burst('deagle')).toBeGreaterThan(burst('p1911'));
    expect(burst('awm')).toBeGreaterThan(burst('m24'));
    expect(burst('m24')).toBeGreaterThan(burst('kar98k'));
    expect(burst('s1897')).toBeGreaterThan(burst('s686'));
    expect(burst('s686')).toBeGreaterThan(burst('s12k'));
    expect(burst('m416')).toBeGreaterThan(burst('pistol'));
    expect(burst('akm')).toBeGreaterThan(burst('m416'));
    expect(burst('awm')).toBeGreaterThan(burst('akm'));
    expect(pressure('akm')).toBeGreaterThan(pressure('scar-l'));
    expect(pressure('scar-l')).toBeGreaterThan(pressure('m416'));
    expect(pressure('vector')).toBeGreaterThan(pressure('uzi'));
    expect(pressure('uzi')).toBeGreaterThan(pressure('ump45'));
    expect(pressure('m416')).toBeGreaterThan(weaponSustainedImpulse(BASIC_PISTOL));
    expect(pressure('ump45')).toBeGreaterThan(weaponSustainedImpulse(BASIC_PISTOL));
  });

  it('selects a concrete model directly in training without changing the dummy', () => {
    const simulation = training();
    expect(simulation.selectTrainingWeapon('akm')).toBe(true);
    expect(simulation.state.actors[0]?.weapon.definition.id).toBe('akm');
    expect(simulation.state.actors[1]?.weapon.definition.id).toBe('pistol');
  });

  it('keeps pistols one-handed and gives every long-gun family a support grip', () => {
    expect(supportGrip('pistol')).toBeNull();
    expect(supportGrip('deagle')).toBeNull();
    for (const id of ['ump45', 'm416', 's686', 'awm', 'rpg7', 'gatling', 'cannon'] as const) {
      expect(supportGrip(id), `${id} needs a support hand`).not.toBeNull();
    }
    expect(supportGrip('m416')).toEqual(supportGrip('akm'));
    expect(supportGrip('awm')).toEqual(supportGrip('m24'));
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

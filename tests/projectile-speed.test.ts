import { describe, expect, it } from 'vitest';
import { ARMORY_WEAPONS, getWeapon } from '../src/content/weapons';
import type { WeaponId } from '../src/game/core/types';

const SCREEN = 1280;
const cross = (id: WeaponId): number => SCREEN / getWeapon(id).projectileSpeed;

describe('projectile speed tiers', () => {
  it('separates families by screen-crossing time', () => {
    expect(cross('awm')).toBeLessThan(cross('m416'));
    expect(cross('m416')).toBeLessThan(cross('ump45'));
    expect(cross('ump45')).toBeLessThan(cross('rpg7'));
  });

  it('keeps every bullet fast enough to read as a gunshot', () => {
    for (const weapon of ARMORY_WEAPONS) {
      if (weapon.family === 'rocket') continue;
      expect(weapon.projectileSpeed, `${weapon.id} speed`).toBeGreaterThanOrEqual(1400);
      expect(cross(weapon.id), `${weapon.id} crossing`).toBeLessThan(1);
    }
    for (const id of ['kar98k', 'm24', 'awm'] as const) {
      expect(getWeapon(id).projectileSpeed, `${id} sniper speed`).toBeGreaterThanOrEqual(2800);
    }
    // Rockets stay slow on purpose: they must be dodgeable.
    expect(cross('rpg7')).toBeGreaterThan(1.4);
  });

  it('orders the sniper and SMG trios by muzzle velocity', () => {
    expect(getWeapon('awm').projectileSpeed).toBeGreaterThan(getWeapon('m24').projectileSpeed);
    expect(getWeapon('m24').projectileSpeed).toBeGreaterThan(getWeapon('kar98k').projectileSpeed);
    expect(getWeapon('vector').projectileSpeed).toBeGreaterThan(getWeapon('uzi').projectileSpeed);
  });
});

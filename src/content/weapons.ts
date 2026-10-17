import { createWeaponInstance } from '../game/core/types';
import type { WeaponDefinition, WeaponId, WeaponInstance } from '../game/core/types';

const DEG = Math.PI / 180;

export const BASIC_PISTOL: WeaponDefinition = {
  id: 'pistol', name: '基础手枪', interval: 0.28,
  // Sustained hits must beat inward running, while one hit still permits recovery.
  projectileSpeed: 1200, range: 750, knockback: 480, recoil: 12, maxAmmo: null,
  pellets: 1, spreadRadians: 0,
};

export const SMG: WeaponDefinition = {
  id: 'smg', name: '冲锋枪', interval: 0.1,
  projectileSpeed: 1200, range: 500, knockback: 60, recoil: 7, maxAmmo: 60,
  pellets: 1, spreadRadians: 0,
};

export const RIFLE: WeaponDefinition = {
  id: 'rifle', name: '突击步枪', interval: 0.18,
  projectileSpeed: 1200, range: 850, knockback: 95, recoil: 12, maxAmmo: 30,
  pellets: 1, spreadRadians: 0,
};

export const SHOTGUN: WeaponDefinition = {
  id: 'shotgun', name: '霰弹枪', interval: 0.7,
  projectileSpeed: 1200, range: 260, knockback: 55, recoil: 40, maxAmmo: 8,
  pellets: 5, spreadRadians: 12 * DEG,
};

export const SNIPER: WeaponDefinition = {
  id: 'sniper', name: '狙击枪', interval: 0.95,
  projectileSpeed: 1800, range: 1200, knockback: 360, recoil: 55, maxAmmo: 5,
  pellets: 1, spreadRadians: 0,
};

export const ROCKET: WeaponDefinition = {
  id: 'rocket', name: '火箭筒', interval: 1.1,
  projectileSpeed: 600, range: 900, knockback: 330, recoil: 65, maxAmmo: 3,
  pellets: 1, spreadRadians: 0,
  explosion: { radius: 140, centerImpulse: 330, edgeImpulse: 80 },
};

/** Six families are registered; the rocket payload is resolved by ExplosionSystem. */
export const WEAPONS: Readonly<Partial<Record<WeaponId, WeaponDefinition>>> = {
  pistol: BASIC_PISTOL, smg: SMG, rifle: RIFLE, shotgun: SHOTGUN, sniper: SNIPER, rocket: ROCKET,
};

export function getWeapon(id: WeaponId): WeaponDefinition {
  const weapon = WEAPONS[id];
  if (!weapon) throw new Error(`Weapon ${id} is not implemented`);
  return weapon;
}

export function createWeapon(id: WeaponId): WeaponInstance {
  return createWeaponInstance(getWeapon(id));
}

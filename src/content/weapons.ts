import { createWeaponInstance } from '../game/core/types';
import type { WeaponDefinition, WeaponId, WeaponInstance } from '../game/core/types';

const DEG = Math.PI / 180;

/**
 * Pistol stays the reference (480 impulse / 0.28 s). Standard specials now beat
 * that per trigger (shotgun counts all pellets), while the two ultimates are
 * deliberately stronger and rarer than the starting pistol.
 */
export const BASIC_PISTOL: WeaponDefinition = {
  id: 'pistol', name: '基础手枪', tier: 'standard', interval: 0.28,
  // Sustained hits must beat inward running, while one hit still permits recovery.
  projectileSpeed: 1200, range: 750, knockback: 480, recoil: 12, maxAmmo: null,
  pellets: 1, spreadRadians: 0,
};

export const SMG: WeaponDefinition = {
  id: 'smg', name: '冲锋枪', tier: 'standard', interval: 0.09,
  projectileSpeed: 1200, range: 520, knockback: 150, recoil: 7, maxAmmo: 30,
  reserveAmmo: 90, reloadTime: 1.5, pellets: 1, spreadRadians: 0,
};

export const RIFLE: WeaponDefinition = {
  id: 'rifle', name: '突击步枪', tier: 'standard', interval: 0.22,
  projectileSpeed: 1200, range: 850, knockback: 520, recoil: 18, maxAmmo: 30,
  reserveAmmo: 90, reloadTime: 1.8, pellets: 1, spreadRadians: 0,
};

export const SHOTGUN: WeaponDefinition = {
  id: 'shotgun', name: '霰弹枪', tier: 'standard', interval: 0.75,
  projectileSpeed: 1200, range: 300, knockback: 120, recoil: 48, maxAmmo: 6,
  reserveAmmo: 18, reloadTime: 2, pellets: 5, spreadRadians: 12 * DEG,
};

export const SNIPER: WeaponDefinition = {
  id: 'sniper', name: '狙击枪', tier: 'standard', interval: 1,
  projectileSpeed: 1800, range: 1200, knockback: 1100, recoil: 70, maxAmmo: 5,
  reserveAmmo: 15, reloadTime: 2.2, pellets: 1, spreadRadians: 0,
};

export const ROCKET: WeaponDefinition = {
  id: 'rocket', name: '火箭筒', tier: 'standard', interval: 1.2,
  projectileSpeed: 600, range: 900, knockback: 650, recoil: 70, maxAmmo: 1,
  reserveAmmo: 3, reloadTime: 2.4, pellets: 1, spreadRadians: 0,
  explosion: { radius: 150, centerImpulse: 650, edgeImpulse: 200 },
};

/** Ultimate: fastest fire rate in the game, 100-round magazine + 100 reserve. */
export const GATLING: WeaponDefinition = {
  id: 'gatling', name: '加特林', tier: 'ultimate', interval: 0.06,
  projectileSpeed: 1500, range: 700, knockback: 160, recoil: 6, maxAmmo: 100,
  reserveAmmo: 100, reloadTime: 3.2, pellets: 1, spreadRadians: 1.2 * DEG,
};

/** Ultimate: very slow anti-materiel cannon; one clean hit launches a full stock. */
export const CANNON: WeaponDefinition = {
  id: 'cannon', name: '重炮狙击枪', tier: 'ultimate', interval: 2.4,
  projectileSpeed: 2200, range: 1800, knockback: 2600, recoil: 120, maxAmmo: 1,
  reserveAmmo: 2, reloadTime: 2.6, pellets: 1, spreadRadians: 0, impulseCap: 3200,
};

/** Training hotbar order; also the stable 1-8 selection order. */
export const WEAPON_SLOTS: readonly WeaponId[] = [
  'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rocket', 'gatling', 'cannon',
];

/** Eight families are registered; the rocket payload is resolved by ExplosionSystem. */
export const WEAPONS: Readonly<Partial<Record<WeaponId, WeaponDefinition>>> = {
  pistol: BASIC_PISTOL, smg: SMG, rifle: RIFLE, shotgun: SHOTGUN, sniper: SNIPER, rocket: ROCKET,
  gatling: GATLING, cannon: CANNON,
};

export function getWeapon(id: WeaponId): WeaponDefinition {
  const weapon = WEAPONS[id];
  if (!weapon) throw new Error(`Weapon ${id} is not implemented`);
  return weapon;
}

export function createWeapon(id: WeaponId): WeaponInstance {
  return createWeaponInstance(getWeapon(id));
}

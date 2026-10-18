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

/**
 * Concrete 17-model catalog. Generic family ids above remain valid aliases for
 * training / old saves; drops and the armory use these named models.
 */
export const P1911: WeaponDefinition = {
  id: 'p1911', name: 'P1911', family: 'pistol', tier: 'standard', interval: 0.22,
  projectileSpeed: 1100, range: 600, knockback: 300, recoil: 18, recoilY: 3,
  maxAmmo: 7, reserveAmmo: 28, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const DEAGLE: WeaponDefinition = {
  id: 'deagle', name: 'Deagle', family: 'pistol', tier: 'standard', interval: 0.45,
  projectileSpeed: 1400, range: 800, knockback: 650, recoil: 48, recoilY: 10,
  maxAmmo: 7, reserveAmmo: 21, reloadTime: 1.7, pellets: 1, spreadRadians: 0,
};

export const UMP45: WeaponDefinition = {
  id: 'ump45', name: 'UMP45', family: 'smg', tier: 'standard', interval: 0.11,
  projectileSpeed: 1100, range: 520, knockback: 55, recoil: 6, recoilY: 2,
  maxAmmo: 25, reserveAmmo: 100, reloadTime: 1.6, pellets: 1, spreadRadians: 0,
};

export const VECTOR: WeaponDefinition = {
  id: 'vector', name: 'Vector', family: 'smg', tier: 'standard', interval: 0.055,
  projectileSpeed: 1000, range: 420, knockback: 38, recoil: 4, recoilY: 1.5,
  maxAmmo: 19, reserveAmmo: 95, reloadTime: 1.5, pellets: 1, spreadRadians: 0,
};

export const UZI: WeaponDefinition = {
  id: 'uzi', name: 'UZI', family: 'smg', tier: 'standard', interval: 0.07,
  projectileSpeed: 1000, range: 380, knockback: 32, recoil: 3, recoilY: 1,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const M416: WeaponDefinition = {
  id: 'm416', name: 'M416', family: 'rifle', tier: 'standard', interval: 0.086,
  projectileSpeed: 1300, range: 850, knockback: 85, recoil: 12, recoilY: 4,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.8, pellets: 1, spreadRadians: 0,
};

export const AKM: WeaponDefinition = {
  id: 'akm', name: 'AKM', family: 'rifle', tier: 'standard', interval: 0.1,
  projectileSpeed: 1250, range: 800, knockback: 120, recoil: 24, recoilY: 8,
  maxAmmo: 30, reserveAmmo: 90, reloadTime: 2, pellets: 1, spreadRadians: 0,
};

export const SCAR_L: WeaponDefinition = {
  id: 'scar-l', name: 'SCAR-L', family: 'rifle', tier: 'standard', interval: 0.096,
  projectileSpeed: 1300, range: 900, knockback: 95, recoil: 15, recoilY: 5,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.9, pellets: 1, spreadRadians: 0,
};

export const S686: WeaponDefinition = {
  id: 's686', name: 'S686', family: 'shotgun', tier: 'standard', interval: 0.35,
  projectileSpeed: 1100, range: 260, knockback: 55, recoil: 40, recoilY: 12,
  maxAmmo: 2, reserveAmmo: 10, reloadTime: 2.2, pellets: 5, spreadRadians: 12 * DEG,
};

export const S1897: WeaponDefinition = {
  id: 's1897', name: 'S1897', family: 'shotgun', tier: 'standard', interval: 0.75,
  projectileSpeed: 1100, range: 280, knockback: 50, recoil: 35, recoilY: 10,
  maxAmmo: 5, reserveAmmo: 25, reloadTime: 2.4, pellets: 6, spreadRadians: 14 * DEG,
};

export const S12K: WeaponDefinition = {
  id: 's12k', name: 'S12K', family: 'shotgun', tier: 'standard', interval: 0.45,
  projectileSpeed: 1150, range: 240, knockback: 45, recoil: 30, recoilY: 8,
  maxAmmo: 5, reserveAmmo: 25, reloadTime: 2, pellets: 4, spreadRadians: 10 * DEG,
};

export const KAR98K: WeaponDefinition = {
  id: 'kar98k', name: 'Kar98k', family: 'sniper', tier: 'standard', interval: 0.95,
  projectileSpeed: 1800, range: 1200, knockback: 360, recoil: 55, recoilY: 14,
  maxAmmo: 5, reserveAmmo: 20, reloadTime: 2.2, pellets: 1, spreadRadians: 0,
};

export const M24: WeaponDefinition = {
  id: 'm24', name: 'M24', family: 'sniper', tier: 'standard', interval: 0.85,
  projectileSpeed: 1850, range: 1250, knockback: 380, recoil: 50, recoilY: 12,
  maxAmmo: 5, reserveAmmo: 20, reloadTime: 2.1, pellets: 1, spreadRadians: 0,
};

export const AWM: WeaponDefinition = {
  id: 'awm', name: 'AWM', family: 'sniper', tier: 'standard', interval: 1.1,
  projectileSpeed: 2000, range: 1400, knockback: 500, recoil: 70, recoilY: 18,
  maxAmmo: 5, reserveAmmo: 15, reloadTime: 2.6, pellets: 1, spreadRadians: 0,
};

export const RPG7: WeaponDefinition = {
  id: 'rpg7', name: 'RPG-7', family: 'rocket', tier: 'standard', interval: 1.1,
  projectileSpeed: 600, range: 900, knockback: 330, recoil: 65, recoilY: 20,
  maxAmmo: 1, reserveAmmo: 3, reloadTime: 2.8, pellets: 1, spreadRadians: 0,
  explosion: { radius: 140, centerImpulse: 330, edgeImpulse: 80 },
};

export const AT4: WeaponDefinition = {
  id: 'at4', name: 'AT4', family: 'rocket', tier: 'standard', interval: 1.3,
  projectileSpeed: 700, range: 1000, knockback: 360, recoil: 75, recoilY: 24,
  maxAmmo: 1, reserveAmmo: 2, reloadTime: 3, pellets: 1, spreadRadians: 0,
  explosion: { radius: 150, centerImpulse: 360, edgeImpulse: 90 },
};

export const WEAPON_MODELS: Readonly<Partial<Record<WeaponId, WeaponDefinition>>> = {
  p1911: P1911, deagle: DEAGLE,
  ump45: UMP45, vector: VECTOR, uzi: UZI,
  m416: M416, akm: AKM, 'scar-l': SCAR_L,
  s686: S686, s1897: S1897, s12k: S12K,
  kar98k: KAR98K, m24: M24, awm: AWM,
  rpg7: RPG7, at4: AT4,
};

/** The 17 concrete models in armory order; P92 is the baseline pistol. */
export const ARMORY_WEAPONS: readonly WeaponDefinition[] = [
  BASIC_PISTOL, P1911, DEAGLE,
  UMP45, VECTOR, UZI,
  M416, AKM, SCAR_L,
  S686, S1897, S12K,
  KAR98K, M24, AWM,
  RPG7, AT4,
];

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
  const weapon = WEAPONS[id] ?? WEAPON_MODELS[id];
  if (!weapon) throw new Error(`Weapon ${id} is not implemented`);
  return weapon;
}

export function createWeapon(id: WeaponId): WeaponInstance {
  return createWeaponInstance(getWeapon(id));
}

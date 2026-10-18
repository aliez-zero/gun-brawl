import { createWeaponInstance } from '../game/core/types';
import type { WeaponDefinition, WeaponId, WeaponInstance } from '../game/core/types';

const DEG = Math.PI / 180;

/**
 * CF-inspired standard roster: the pistol (360 / 0.30 s) is a sidearm, every
 * rifle hits harder per trigger, SMGs trade per-shot push for 600–1091 RPM,
 * shotguns / snipers own close and long one-trigger bursts. The two ultimates
 * stay above the whole standard roster. Numbers are designed for ring-out
 * knockback, not CF damage values.
 */
export const BASIC_PISTOL: WeaponDefinition = {
  id: 'pistol', name: '基础手枪', tier: 'standard', interval: 0.3,
  // Sidearm: one hit nudges; sustained fire still contests an approach.
  projectileSpeed: 1200, range: 750, knockback: 360, recoil: 12, maxAmmo: null,
  pellets: 1, spreadRadians: 0,
};

export const SMG: WeaponDefinition = {
  id: 'smg', name: '冲锋枪', tier: 'standard', interval: 0.05,
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
  projectileSpeed: 1200, range: 320, knockback: 320, recoil: 48, maxAmmo: 6,
  reserveAmmo: 18, reloadTime: 2, pellets: 5, spreadRadians: 12 * DEG,
  impulseCap: 1600,
};

export const SNIPER: WeaponDefinition = {
  id: 'sniper', name: '狙击枪', tier: 'standard', interval: 1,
  projectileSpeed: 1800, range: 1200, knockback: 1100, recoil: 70, maxAmmo: 5,
  reserveAmmo: 15, reloadTime: 2.2, pellets: 1, spreadRadians: 0,
};

export const ROCKET: WeaponDefinition = {
  id: 'rocket', name: '火箭筒', tier: 'standard', interval: 1.2,
  projectileSpeed: 600, range: 900, knockback: 2400, recoil: 70, maxAmmo: 1,
  reserveAmmo: 3, reloadTime: 2.4, pellets: 1, spreadRadians: 0,
  explosion: { radius: 170, centerImpulse: 2400, edgeImpulse: 680 },
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
  projectileSpeed: 2200, range: 1800, knockback: 3400, recoil: 120, maxAmmo: 1,
  reserveAmmo: 2, reloadTime: 2.6, pellets: 1, spreadRadians: 0, impulseCap: 4000,
};

/**
 * Concrete 17-model catalog. Generic family ids above remain valid aliases for
 * training / old saves; drops and the armory use these named models.
 */
export const P1911: WeaponDefinition = {
  id: 'p1911', name: 'P1911', family: 'pistol', tier: 'standard', interval: 0.2,
  projectileSpeed: 1150, range: 620, knockback: 300, recoil: 20, recoilY: 3,
  maxAmmo: 7, reserveAmmo: 28, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const DEAGLE: WeaponDefinition = {
  id: 'deagle', name: 'Deagle', family: 'pistol', tier: 'standard', interval: 0.46,
  projectileSpeed: 1450, range: 820, knockback: 700, recoil: 52, recoilY: 12,
  maxAmmo: 7, reserveAmmo: 21, reloadTime: 1.7, pellets: 1, spreadRadians: 0,
};

export const UMP45: WeaponDefinition = {
  id: 'ump45', name: 'UMP45', family: 'smg', tier: 'standard', interval: 0.075,
  projectileSpeed: 1150, range: 560, knockback: 420, recoil: 8, recoilY: 2.5,
  maxAmmo: 25, reserveAmmo: 100, reloadTime: 1.6, pellets: 1, spreadRadians: 0,
};

export const VECTOR: WeaponDefinition = {
  id: 'vector', name: 'Vector', family: 'smg', tier: 'standard', interval: 0.05,
  projectileSpeed: 1050, range: 430, knockback: 320, recoil: 5, recoilY: 1.5,
  maxAmmo: 19, reserveAmmo: 95, reloadTime: 1.5, pellets: 1, spreadRadians: 0,
};

export const UZI: WeaponDefinition = {
  id: 'uzi', name: 'UZI', family: 'smg', tier: 'standard', interval: 0.055,
  projectileSpeed: 1050, range: 390, knockback: 320, recoil: 4, recoilY: 1,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const M416: WeaponDefinition = {
  id: 'm416', name: 'M416', family: 'rifle', tier: 'standard', interval: 1 / 12,
  projectileSpeed: 1350, range: 860, knockback: 520, recoil: 14, recoilY: 4,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.8, pellets: 1, spreadRadians: 0,
};

export const AKM: WeaponDefinition = {
  id: 'akm', name: 'AKM', family: 'rifle', tier: 'standard', interval: 0.1,
  projectileSpeed: 1300, range: 780, knockback: 700, recoil: 28, recoilY: 9,
  maxAmmo: 30, reserveAmmo: 90, reloadTime: 2, pellets: 1, spreadRadians: 0,
};

export const SCAR_L: WeaponDefinition = {
  id: 'scar-l', name: 'SCAR-L', family: 'rifle', tier: 'standard', interval: 0.1,
  projectileSpeed: 1350, range: 920, knockback: 640, recoil: 16, recoilY: 5,
  maxAmmo: 30, reserveAmmo: 120, reloadTime: 1.9, pellets: 1, spreadRadians: 0,
};

export const S686: WeaponDefinition = {
  id: 's686', name: 'S686', family: 'shotgun', tier: 'standard', interval: 0.4,
  projectileSpeed: 1150, range: 270, knockback: 350, recoil: 42, recoilY: 12,
  maxAmmo: 2, reserveAmmo: 10, reloadTime: 2.2, pellets: 6, spreadRadians: 12 * DEG,
  impulseCap: 2100,
};

export const S1897: WeaponDefinition = {
  id: 's1897', name: 'S1897', family: 'shotgun', tier: 'standard', interval: 0.85,
  projectileSpeed: 1150, range: 300, knockback: 400, recoil: 38, recoilY: 10,
  maxAmmo: 5, reserveAmmo: 25, reloadTime: 2.4, pellets: 7, spreadRadians: 10 * DEG,
  impulseCap: 2800,
};

export const S12K: WeaponDefinition = {
  id: 's12k', name: 'S12K', family: 'shotgun', tier: 'standard', interval: 0.4,
  projectileSpeed: 1200, range: 250, knockback: 360, recoil: 32, recoilY: 8,
  maxAmmo: 5, reserveAmmo: 25, reloadTime: 2, pellets: 5, spreadRadians: 10 * DEG,
  impulseCap: 1800,
};

export const KAR98K: WeaponDefinition = {
  id: 'kar98k', name: 'Kar98k', family: 'sniper', tier: 'standard', interval: 1,
  projectileSpeed: 1850, range: 1250, knockback: 1150, recoil: 58, recoilY: 14,
  maxAmmo: 5, reserveAmmo: 20, reloadTime: 2.2, pellets: 1, spreadRadians: 0,
};

export const M24: WeaponDefinition = {
  id: 'm24', name: 'M24', family: 'sniper', tier: 'standard', interval: 0.9,
  projectileSpeed: 1900, range: 1300, knockback: 1300, recoil: 52, recoilY: 12,
  maxAmmo: 5, reserveAmmo: 20, reloadTime: 2.1, pellets: 1, spreadRadians: 0,
};

export const AWM: WeaponDefinition = {
  id: 'awm', name: 'AWM', family: 'sniper', tier: 'standard', interval: 1.25,
  projectileSpeed: 2050, range: 1450, knockback: 1500, recoil: 72, recoilY: 18,
  maxAmmo: 5, reserveAmmo: 15, reloadTime: 2.6, pellets: 1, spreadRadians: 0,
};

export const RPG7: WeaponDefinition = {
  id: 'rpg7', name: 'RPG-7', family: 'rocket', tier: 'standard', interval: 1.2,
  projectileSpeed: 650, range: 950, knockback: 2400, recoil: 68, recoilY: 20,
  maxAmmo: 1, reserveAmmo: 3, reloadTime: 2.8, pellets: 1, spreadRadians: 0,
  explosion: { radius: 170, centerImpulse: 2400, edgeImpulse: 680 },
};

export const AT4: WeaponDefinition = {
  id: 'at4', name: 'AT4', family: 'rocket', tier: 'standard', interval: 1.4,
  projectileSpeed: 750, range: 1050, knockback: 2800, recoil: 78, recoilY: 24,
  maxAmmo: 1, reserveAmmo: 2, reloadTime: 3, pellets: 1, spreadRadians: 0,
  explosion: { radius: 160, centerImpulse: 2800, edgeImpulse: 800 },
};

export const WEAPON_MODELS: Readonly<Partial<Record<WeaponId, WeaponDefinition>>> = {
  p1911: P1911, deagle: DEAGLE,
  ump45: UMP45, vector: VECTOR, uzi: UZI,
  m416: M416, akm: AKM, 'scar-l': SCAR_L,
  s686: S686, s1897: S1897, s12k: S12K,
  kar98k: KAR98K, m24: M24, awm: AWM,
  rpg7: RPG7, at4: AT4,
};

const ARMORY_IDS = [
  'pistol', 'p1911', 'deagle',
  'ump45', 'vector', 'uzi',
  'm416', 'akm', 'scar-l',
  's686', 's1897', 's12k',
  'kar98k', 'm24', 'awm',
  'rpg7', 'at4',
] as const;

/** Short, player-facing role labels shown in the armory. */
export const WEAPON_ROLES: Readonly<Record<(typeof ARMORY_IDS)[number], string>> = {
  pistol: '基准 · 全能', p1911: '快速点射', deagle: '重手炮',
  ump45: '稳健压制', vector: '极速爆发', uzi: '弹幕压制',
  m416: '均衡步枪', akm: '重击步枪', 'scar-l': '远距精准',
  s686: '双管爆发', s1897: '泵动重击', s12k: '半自动霰弹',
  kar98k: '精准狙击', m24: '快速狙击', awm: '重狙',
  rpg7: '范围重击', at4: '高爆重击',
};

/** One trigger's total impulse, counting pellets or the explosion center. */
export function weaponBurstImpulse(weapon: WeaponDefinition): number {
  return weapon.explosion ? weapon.explosion.centerImpulse : weapon.knockback * Math.max(1, weapon.pellets);
}

/** Sustained impulse per second; useful for comparing spray guns with hand cannons. */
export function weaponSustainedImpulse(weapon: WeaponDefinition): number {
  return Math.round(weaponBurstImpulse(weapon) / Math.max(0.01, weapon.interval));
}

export function weaponRole(id: WeaponId): string {
  return WEAPON_ROLES[id as keyof typeof WEAPON_ROLES] ?? '标准';
}

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

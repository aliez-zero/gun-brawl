import { createWeaponInstance } from '../game/core/types';
import type { WeaponDefinition, WeaponId, WeaponInstance } from '../game/core/types';

const DEG = Math.PI / 180;

/**
 * Gun Mayhem-style knockback roster.
 *
 * The stage is 1280 wide, so 640 px is "half a screen": the distance a target
 * must travel to be ringed out from the middle. Knockback is a velocity impulse
 * with a 0.3 s half-life, so one hit displaces roughly `0.433 × knockback`.
 * Values are tuned against that unit; measured numbers live in docs/WEAPONS.md.
 *
 *   role        single trigger   sustained (target runs back, lab)
 *   pistol      152 px           ~2.0 s
 *   SMG          89–106 px       1.5–2.0 s   (chip push, needs contact)
 *   rifle       161–220 px       ~1.05 s     (best sustained pressure)
 *   shotgun     245–370 px       close range only; falls out of its own range
 *   sniper      487–614 px       1.6–1.8 s   (launch, slow follow-up)
 *   rocket      600–700 px       burst tool; 3–4 rounds, 2.8–3.0 s reloads
 *   minigun      39 px           ~1.1 s      (suppression, 200-round belt)
 *   cannon     1200 px           one shot    (3 rounds, 2.4 s cadence)
 *
 * Per-shot values above the 900 impulse cap are deliberate: burst weapons must
 * exceed the cap to launch, automatics must stay under it long enough for the
 * target to fight back.
 *
 * Projectile speed is its own tier axis, measured as "seconds to cross the
 * 1280 px screen": pistol 0.80–0.67, SMG 0.88–0.78, rifle 0.64–0.58, shotgun
 * 0.88–0.80, sniper 0.43–0.38, rocket 1.78–1.60, gatling 0.64, cannon 0.36.
 * Rifle and sniper rounds are fast enough that leading a target is almost
 * unnecessary; rockets stay slow enough to be dodged.
 */
export const BASIC_PISTOL: WeaponDefinition = {
  id: 'pistol', name: '基础手枪', tier: 'standard', interval: 0.3,
  // Sidearm: one hit nudges; sustained fire still contests an approach.
  projectileSpeed: 1600, range: 750, knockback: 360, recoil: 12, maxAmmo: null,
  pellets: 1, spreadRadians: 0,
};

export const SMG: WeaponDefinition = {
  id: 'smg', name: '冲锋枪', tier: 'standard', interval: 0.075,
  projectileSpeed: 1650, range: 520, knockback: 200, recoil: 9, maxAmmo: 30,
  reserveAmmo: 90, reloadTime: 1.5, pellets: 1, spreadRadians: 0,
};

export const RIFLE: WeaponDefinition = {
  id: 'rifle', name: '突击步枪', tier: 'standard', interval: 0.2,
  projectileSpeed: 2100, range: 860, knockback: 400, recoil: 16, maxAmmo: 30,
  reserveAmmo: 90, reloadTime: 1.8, pellets: 1, spreadRadians: 0,
};

export const SHOTGUN: WeaponDefinition = {
  id: 'shotgun', name: '霰弹枪', tier: 'standard', interval: 0.75,
  projectileSpeed: 1500, range: 300, knockback: 120, recoil: 32, maxAmmo: 6,
  reserveAmmo: 18, reloadTime: 2, pellets: 5, spreadRadians: 9 * DEG,
  impulseCap: 620,
};

export const SNIPER: WeaponDefinition = {
  id: 'sniper', name: '狙击枪', tier: 'standard', interval: 1,
  projectileSpeed: 3200, range: 1200, knockback: 1150, recoil: 50, maxAmmo: 5,
  reserveAmmo: 15, reloadTime: 2.2, pellets: 1, spreadRadians: 0,
};

export const ROCKET: WeaponDefinition = {
  id: 'rocket', name: '火箭筒', tier: 'standard', interval: 1.2,
  projectileSpeed: 760, range: 950, knockback: 1800, recoil: 54, maxAmmo: 1,
  reserveAmmo: 3, reloadTime: 2.8, pellets: 1, spreadRadians: 0,
  explosion: { radius: 170, centerImpulse: 1800, edgeImpulse: 480 },
};

/** Ultimate: fastest fire rate in the game, 100-round magazine + 100 reserve. */
export const GATLING: WeaponDefinition = {
  id: 'gatling', name: '加特林', tier: 'ultimate', interval: 0.06,
  projectileSpeed: 2000, range: 700, knockback: 90, recoil: 5, maxAmmo: 100,
  reserveAmmo: 100, reloadTime: 3.2, pellets: 1, spreadRadians: 1.2 * DEG,
};

/** Ultimate: very slow anti-materiel cannon; one clean hit launches a full stock. */
export const CANNON: WeaponDefinition = {
  id: 'cannon', name: '重炮狙击枪', tier: 'ultimate', interval: 2.4,
  projectileSpeed: 3600, range: 1800, knockback: 2800, recoil: 110, maxAmmo: 1,
  reserveAmmo: 2, reloadTime: 2.6, pellets: 1, spreadRadians: 0, impulseCap: 3200,
};

/**
 * Concrete 17-model catalog. Generic family ids above remain valid aliases for
 * training / old saves; drops and the armory use these named models.
 */
export const P1911: WeaponDefinition = {
  id: 'p1911', name: 'P1911', family: 'pistol', tier: 'standard', interval: 0.2,
  projectileSpeed: 1550, range: 620, knockback: 300, recoil: 22, recoilY: 3,
  maxAmmo: 10, reserveAmmo: 40, reloadTime: 1, pellets: 1, spreadRadians: 0,
};

export const DEAGLE: WeaponDefinition = {
  id: 'deagle', name: 'Deagle', family: 'pistol', tier: 'standard', interval: 0.46,
  projectileSpeed: 1900, range: 820, knockback: 620, recoil: 46, recoilY: 10,
  maxAmmo: 8, reserveAmmo: 32, reloadTime: 1.2, pellets: 1, spreadRadians: 0,
};

export const UMP45: WeaponDefinition = {
  id: 'ump45', name: 'UMP45', family: 'smg', tier: 'standard', interval: 0.075,
  projectileSpeed: 1600, range: 560, knockback: 250, recoil: 10, recoilY: 2.5,
  maxAmmo: 30, reserveAmmo: 90, reloadTime: 1.3, pellets: 1, spreadRadians: 0,
};

export const VECTOR: WeaponDefinition = {
  id: 'vector', name: 'Vector', family: 'smg', tier: 'standard', interval: 0.05,
  projectileSpeed: 1500, range: 470, knockback: 210, recoil: 4, recoilY: 1.2,
  maxAmmo: 22, reserveAmmo: 66, reloadTime: 1.1, pellets: 1, spreadRadians: 0,
};

export const UZI: WeaponDefinition = {
  id: 'uzi', name: 'UZI', family: 'smg', tier: 'standard', interval: 0.055,
  projectileSpeed: 1450, range: 440, knockback: 220, recoil: 4, recoilY: 1,
  maxAmmo: 32, reserveAmmo: 96, reloadTime: 1.1, pellets: 1, spreadRadians: 0,
};

export const M416: WeaponDefinition = {
  id: 'm416', name: 'M416', family: 'rifle', tier: 'standard', interval: 1 / 12,
  projectileSpeed: 2100, range: 860, knockback: 380, recoil: 13, recoilY: 3.5,
  maxAmmo: 30, reserveAmmo: 90, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const AKM: WeaponDefinition = {
  id: 'akm', name: 'AKM', family: 'rifle', tier: 'standard', interval: 0.1,
  projectileSpeed: 2000, range: 780, knockback: 520, recoil: 24, recoilY: 8,
  maxAmmo: 30, reserveAmmo: 75, reloadTime: 1.5, pellets: 1, spreadRadians: 0,
};

export const SCAR_L: WeaponDefinition = {
  id: 'scar-l', name: 'SCAR-L', family: 'rifle', tier: 'standard', interval: 0.1,
  projectileSpeed: 2200, range: 920, knockback: 480, recoil: 15, recoilY: 4.5,
  maxAmmo: 30, reserveAmmo: 90, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const S686: WeaponDefinition = {
  id: 's686', name: 'S686', family: 'shotgun', tier: 'standard', interval: 0.3,
  projectileSpeed: 1500, range: 360, knockback: 145, recoil: 30, recoilY: 9,
  maxAmmo: 2, reserveAmmo: 20, reloadTime: 1, pellets: 6, spreadRadians: 8 * DEG,
  impulseCap: 880,
};

export const S1897: WeaponDefinition = {
  id: 's1897', name: 'S1897', family: 'shotgun', tier: 'standard', interval: 0.85,
  projectileSpeed: 1450, range: 340, knockback: 140, recoil: 30, recoilY: 8,
  maxAmmo: 7, reserveAmmo: 35, reloadTime: 1.5, pellets: 7, spreadRadians: 7 * DEG,
  impulseCap: 1000,
};

export const S12K: WeaponDefinition = {
  id: 's12k', name: 'S12K', family: 'shotgun', tier: 'standard', interval: 0.4,
  projectileSpeed: 1600, range: 290, knockback: 145, recoil: 26, recoilY: 7,
  maxAmmo: 8, reserveAmmo: 40, reloadTime: 1.3, pellets: 5, spreadRadians: 8 * DEG,
  impulseCap: 740,
};

export const KAR98K: WeaponDefinition = {
  id: 'kar98k', name: 'Kar98k', family: 'sniper', tier: 'standard', interval: 1,
  projectileSpeed: 3000, range: 1250, knockback: 1150, recoil: 50, recoilY: 12,
  maxAmmo: 5, reserveAmmo: 30, reloadTime: 1.4, pellets: 1, spreadRadians: 0,
};

export const M24: WeaponDefinition = {
  id: 'm24', name: 'M24', family: 'sniper', tier: 'standard', interval: 0.9,
  projectileSpeed: 3200, range: 1300, knockback: 1300, recoil: 54, recoilY: 13,
  maxAmmo: 5, reserveAmmo: 30, reloadTime: 1.3, pellets: 1, spreadRadians: 0,
};

export const AWM: WeaponDefinition = {
  id: 'awm', name: 'AWM', family: 'sniper', tier: 'standard', interval: 1.25,
  projectileSpeed: 3400, range: 1450, knockback: 1450, recoil: 64, recoilY: 16,
  maxAmmo: 5, reserveAmmo: 25, reloadTime: 1.6, pellets: 1, spreadRadians: 0,
};

export const RPG7: WeaponDefinition = {
  id: 'rpg7', name: 'RPG-7', family: 'rocket', tier: 'standard', interval: 1.2,
  projectileSpeed: 720, range: 950, knockback: 1800, recoil: 54, recoilY: 16,
  maxAmmo: 1, reserveAmmo: 6, reloadTime: 1.6, pellets: 1, spreadRadians: 0,
  explosion: { radius: 170, centerImpulse: 1800, edgeImpulse: 480 },
};

export const AT4: WeaponDefinition = {
  id: 'at4', name: 'AT4', family: 'rocket', tier: 'standard', interval: 1.4,
  projectileSpeed: 800, range: 1050, knockback: 2000, recoil: 60, recoilY: 18,
  maxAmmo: 1, reserveAmmo: 5, reloadTime: 1.8, pellets: 1, spreadRadians: 0,
  explosion: { radius: 160, centerImpulse: 2000, edgeImpulse: 540 },
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

/**
 * World-space muzzle position relative to the actor's feet, facing right.
 * Values are derived from the 160x80 art: grip (46,46), muzzle x 145-158,
 * y 31-35, converted through each model's display scale. Matching these to the
 * rendered tip is what makes the tracer/flash leave the barrel instead of the
 * chest.
 */
export interface MuzzleOffset { x: number; y: number }

const FAMILY_MUZZLE: Record<string, MuzzleOffset> = {
  pistol: { x: 36, y: -38 },
  smg: { x: 48, y: -38 },
  rifle: { x: 70, y: -38 },
  shotgun: { x: 72, y: -38 },
  sniper: { x: 79, y: -39 },
  rocket: { x: 75, y: -38 },
  gatling: { x: 78, y: -39 },
  cannon: { x: 84, y: -39 },
};

const MODEL_MUZZLE: Readonly<Partial<Record<WeaponId, MuzzleOffset>>> = {
  p1911: { x: 38, y: -38 }, deagle: { x: 43, y: -38 },
  ump45: { x: 48, y: -38 }, vector: { x: 44, y: -38 }, uzi: { x: 38, y: -38 },
  m416: { x: 70, y: -38 }, akm: { x: 70, y: -38 }, 'scar-l': { x: 73, y: -38 },
  s686: { x: 67, y: -38 }, s1897: { x: 73, y: -38 }, s12k: { x: 63, y: -38 },
  kar98k: { x: 79, y: -39 }, m24: { x: 79, y: -39 }, awm: { x: 80, y: -39 },
  rpg7: { x: 75, y: -38 }, at4: { x: 78, y: -38 },
};

/** Facing-right muzzle offset from the actor's feet; mirror x for facing left. */
export function weaponMuzzle(id: WeaponId): MuzzleOffset {
  const model = MODEL_MUZZLE[id];
  if (model) return { ...model };
  const family = getWeapon(id).family ?? id;
  return { ...(FAMILY_MUZZLE[family] ?? FAMILY_MUZZLE.pistol!) };
}

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

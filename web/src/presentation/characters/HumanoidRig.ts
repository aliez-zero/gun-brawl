import type { ActorState, CharacterAppearance, CharacterStyle, Vec2, WeaponId } from '../../game/core/types';
import { weaponMuzzle } from '../../content/weapons';
import { weaponPose } from '../CharacterMotion';
import type { CharacterPose } from '../CharacterMotion';
import { WEAPON_ART, weaponDisplayScale } from '../WeaponArt';
import { supportGrip } from '../WeaponSupport';
import { clamp01, offset, solveLimb } from './RigMath';
import { COWBOY_CLIPS, cowboyBody, cowboyStep, sampleCurve } from './CowboyClips';
import type { LimbChains } from './LimbSkin';

export const HUMANOID_PARTS = [
  'coatBack', 'thighBack', 'shinBack', 'bootBack', 'thigh', 'shin', 'boot',
  'torso', 'coatFront', 'scarfTail', 'head', 'hat',
  'upperBack', 'foreBack', 'handBack', 'upper', 'fore', 'hand', 'previewGun',
] as const;
export type HumanoidPart = typeof HUMANOID_PARTS[number];

/** Bone lengths stay constant across speed, poses and weapon families. */
export const HUMANOID_BONES = { thigh: 15.5, shin: 14.5, upperArm: 16.5, forearm: 15.5 } as const;

/** A close hold at the receiver is reachable without stretching the support arm. */
export function humanoidSupportGrip(id: WeaponId): Vec2 | null {
  const grip = supportGrip(id);
  if (!grip) return null;
  const scale = weaponDisplayScale(id) * 3;
  return { x: WEAPON_ART.gripX + Math.min(grip.x - WEAPON_ART.gripX, 6 / scale), y: Math.min(grip.y, 39) };
}

export interface RigPartPose extends Vec2 {
  part: HumanoidPart;
  rotation: number;
  scaleY: number;
  depth: number;
}
export interface WeaponMount extends Vec2 { rotation: number; alpha: number }
export interface HumanoidPose {
  parts: RigPartPose[];
  /** Facing-right, feet-relative coordinates. The view mirrors the whole assembly. */
  weapon: WeaponMount;
  triggerHand: Vec2;
  supportHand: Vec2;
  /** The cowboy pilot uses these same solved bones for weighted limb meshes. */
  limbs?: LimbChains;
}

export interface HumanoidMotionInput {
  outfit?: CharacterStyle;
  time: number;
  cycle: number;
  run: number;
  airborne: boolean;
  falling: boolean;
  doubleJump: boolean;
  landing: number;
  hurt: number;
  reload: number;
  recoil: number;
  weaponId: WeaponId;
  weapon?: WeaponMount;
  airWeight?: number;
  fallWeight?: number;
  tuckWeight?: number;
}

/** Layered poses are evaluated continuously; firing and reloading do not replace the legs. */
export function sampleHumanoid(input: HumanoidMotionInput): HumanoidPose {
  const { time, cycle, run, airborne, falling, doubleJump, landing, hurt, reload, recoil, weaponId } = input;
  const outfit = input.outfit ?? 'cowboy';
  const pilot = outfit === 'cowboy';
  const authored = cowboyBody(cycle);
  const airWeight = pilot ? input.airWeight ?? Number(airborne) : Number(airborne);
  const fallWeight = pilot ? input.fallWeight ?? Number(falling) : Number(falling);
  const tuckWeight = pilot ? input.tuckWeight ?? Number(doubleJump) : Number(doubleJump);
  const weight = outfit === 'astronaut' ? 0.65 : outfit === 'knight' ? 0.8 : 1;
  const cloth = outfit === 'ronin' ? 1.2 : outfit === 'knight' ? 1.35 : outfit === 'operative' || outfit === 'astronaut' ? 0.35 : 1;
  const phase = cycle * Math.PI * 2;
  const bounce = pilot ? -airWeight * 0.4 + authored.compression * run * (1 - airWeight)
    : airborne ? -0.4 : -(Math.sin(phase) ** 2) * 1.15 * run;
  const breath = Math.sin(time * 2.5) * 0.2 * (1 - run);
  const waist = { x: run * 0.6 - hurt * 1.1, y: -34.5 + run * (pilot ? 3.7 : 4) + bounce + breath + landing * 2.8 };
  const lean = run * (0.075 * weight + (pilot ? authored.lean : 0)) - hurt * 0.045 - recoil * 0.02;
  const body = (point: Vec2): Vec2 => offset(point, waist, lean);
  const parts: RigPartPose[] = [];
  const limbs = {} as LimbChains;
  const add = (part: HumanoidPart, point: Vec2, rotation: number, depth: number, scaleY = 1): void => {
    parts.push({ part, ...point, rotation, depth, scaleY });
  };
  const segment = (part: HumanoidPart, a: Vec2, b: Vec2, length: number, depth: number): void => {
    add(part, a, Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2, depth, Math.hypot(b.x - a.x, b.y - a.y) / length);
  };
  const sway = (pilot ? authored.coat * run + airWeight * (0.08 - fallWeight * 0.14)
    : Math.sin(phase - 0.65) * run * 0.055 + (airborne ? (falling ? -0.06 : 0.08) : 0)) * cloth;
  add('coatBack', body({ x: -2, y: -1 }), lean + sway, 1.80);
  for (const side of [-1, 1] as const) {
    const back = side < 0;
    const step = cycle + (back ? 0.5 : 0);
    const t = step - Math.floor(step);
    // Stance occupies most of the step; a smooth return lifts the foot behind us.
    const returnAge = clamp01((t - 0.58) / 0.42);
    const swing = Math.sin(returnAge * Math.PI);
    const ease = returnAge * returnAge * (3 - 2 * returnAge);
    const travel = t < 0.58 ? 1 - 2 * t / 0.58 : -1 + ease * 2;
    const keyStep = cowboyStep(step);
    const hip = body({ x: side * 3, y: 0 });
    let ankle = { x: side * 6 + (pilot ? keyStep.travel : travel * 10.5) * run, y: -5 - (pilot ? keyStep.lift : swing * 10) * run };
    if (airWeight > 0) {
      const rise = { x: back ? -11 : 6, y: back ? -15 : -9 };
      const fall = { x: back ? -6 : 8, y: back ? -7 : -5 };
      const tuck = { x: back ? -10 : 3, y: back ? -22 : -17 };
      const target = { x: rise.x + (fall.x - rise.x) * fallWeight, y: rise.y + (fall.y - rise.y) * fallWeight };
      target.x += (tuck.x - target.x) * tuckWeight; target.y += (tuck.y - target.y) * tuckWeight;
      ankle = { x: ankle.x + (target.x - ankle.x) * airWeight, y: ankle.y + (target.y - ankle.y) * airWeight };
    }
    // Both knees bend forwards. Mirroring the actor must not reverse one knee.
    const limb = solveLimb(hip, ankle, HUMANOID_BONES.thigh, HUMANOID_BONES.shin, -1);
    limbs[back ? 'legBack' : 'leg'] = { root: hip, joint: limb.joint, end: limb.end, upper: HUMANOID_BONES.thigh, lower: HUMANOID_BONES.shin };
    const z = back ? 1.90 : 2.02;
    segment(back ? 'thighBack' : 'thigh', hip, limb.joint, HUMANOID_BONES.thigh, z);
    segment(back ? 'shinBack' : 'shin', limb.joint, limb.end, HUMANOID_BONES.shin, z + 0.01);
    // The boot rotates around the ankle, keeping it attached throughout the step.
    const roll = pilot ? keyStep.roll * run * (1 - airWeight) - airWeight * 0.08 : airborne ? -0.08 : -swing * run * 0.18;
    add(back ? 'bootBack' : 'boot', limb.end, roll, z + 0.02);
  }
  add('torso', waist, lean, 2.12);
  add('coatFront', body({ x: 7, y: 0 }), lean - sway * 0.55, 2.16);
  add('scarfTail', body({ x: -5, y: -22 }), lean + sway * 1.2 + Math.sin(time * 5 - 0.8) * 0.012, 2.10);
  const head = body({ x: 0, y: -29 });
  const headTilt = -lean * 0.35 + Math.sin(time * 2.5 - 0.2) * 0.006 + (pilot ? authored.head * run : 0);
  add('head', head, headTilt, 2.30);
  add('hat', offset({ x: 0, y: -12 }, head, headTilt), headTilt - sway * 0.12, 2.31);

  const attachment = humanoidSupportGrip(weaponId);
  const reloadReach = reload > 0 ? pilot ? sampleCurve(COWBOY_CLIPS.reloadReach, reload) : Math.sin(reload * Math.PI) ** 2 : 0;
  const base = input.weapon ?? { x: 22 - recoil * 1.6, y: -32 + Math.sin(reload * Math.PI) * 2, rotation: -recoil * 0.08 - Math.sin(reload * Math.PI) * 0.4, alpha: 1 };
  // Bring the stock towards the shoulder instead of making the other arm longer.
  const weapon = { ...base, x: base.x + waist.x - (attachment ? 9 : 0), y: base.y + (waist.y + 34.5) * 0.45 - reloadReach * 4 };
  // Grip coordinates use logical art units; displayScale is for its 3x canvas.
  const artScale = weaponDisplayScale(weaponId) * 3;
  const support = attachment ? offset({ x: (attachment.x - WEAPON_ART.gripX) * artScale, y: (attachment.y - WEAPON_ART.gripY) * artScale }, weapon, weapon.rotation) : body({ x: -10, y: 9 });
  const reloadTarget = { x: weapon.x + (attachment ? 1 : -7), y: weapon.y + 4 };
  if (pilot && reload > 0) {
    const reachDown = body({ x: -4, y: 5 }), insert = sampleCurve(COWBOY_CLIPS.reloadInsert, reload);
    reloadTarget.x = reachDown.x + (reloadTarget.x - reachDown.x) * insert;
    reloadTarget.y = reachDown.y + (reloadTarget.y - reachDown.y) * insert;
  }
  const supportHand = { x: support.x + (reloadTarget.x - support.x) * reloadReach, y: support.y + (reloadTarget.y - support.y) * reloadReach };
  const backShoulder = body({ x: -4, y: -20 });
  const foreShoulder = body({ x: 8, y: -20 });
  const back = solveLimb(backShoulder, supportHand, HUMANOID_BONES.upperArm, HUMANOID_BONES.forearm, 1);
  const front = solveLimb(foreShoulder, weapon, HUMANOID_BONES.upperArm, HUMANOID_BONES.forearm, 1);
  limbs.arm = { root: foreShoulder, joint: front.joint, end: front.end, upper: HUMANOID_BONES.upperArm, lower: HUMANOID_BONES.forearm };
  limbs.armBack = { root: backShoulder, joint: back.joint, end: back.end, upper: HUMANOID_BONES.upperArm, lower: HUMANOID_BONES.forearm };
  segment('upperBack', backShoulder, back.joint, HUMANOID_BONES.upperArm, 1.98);
  segment('foreBack', back.joint, back.end, HUMANOID_BONES.forearm, attachment || reload > 0 ? 2.75 : 1.99);
  add('handBack', back.end, weapon.rotation, 3.20);
  segment('upper', foreShoulder, front.joint, HUMANOID_BONES.upperArm, 2.45);
  segment('fore', front.joint, front.end, HUMANOID_BONES.forearm, 3.31);
  add('hand', front.end, weapon.rotation, 3.40);
  add('previewGun', weapon, weapon.rotation, 3);
  return { parts: parts.sort((a, b) => a.depth - b.depth), weapon, triggerHand: front.end, supportHand: back.end, ...(pilot ? { limbs } : {}) };
}

export function previewHumanoidPose(pose: CharacterPose = {}, look?: CharacterAppearance): HumanoidPose {
  return sampleHumanoid({
    outfit: look?.outfit,
    time: (pose.breath ?? 0) * 0.5, cycle: pose.cycle ?? 0,
    run: pose.cycle === undefined ? 0 : 1, airborne: Boolean(pose.airborne), falling: Boolean(pose.falling),
    doubleJump: Boolean(pose.doubleJump), landing: pose.landing ? 1 : 0,
    hurt: pose.hurt ? 1 : 0, reload: pose.reload ?? 0, recoil: pose.recoil ?? 0, weaponId: 'pistol',
  });
}

export class HumanoidMotion {
  private time = 0;
  private cycle = 0;
  private run = 0;
  private air = 0;
  private fall = 0;
  private tuck = 0;
  private initialized = false;

  sample(actor: Readonly<ActorState>, delta: number, hurtAge: number, landingAge: number): HumanoidPose {
    const dt = Math.max(0, Math.min(delta, 0.1));
    this.time += dt;
    const air = Number(actor.groundedOn === null), fall = Number(actor.verticalVelocity >= -40);
    const tuck = Number(actor.jumpsRemaining === 0 && actor.verticalVelocity < -80);
    if (!this.initialized) { this.air = air; this.fall = fall; this.tuck = tuck; this.initialized = true; }
    const blend = 1 - Math.exp(-dt * 22);
    this.air += (air - this.air) * blend; this.fall += (fall - this.fall) * blend; this.tuck += (tuck - this.tuck) * blend;
    const target = actor.groundedOn === null ? 0 : clamp01(Math.abs(actor.moveVelocity) / 260);
    this.run += (target - this.run) * (1 - Math.exp(-dt * 18));
    this.cycle = (this.cycle + Math.abs(actor.moveVelocity) / 145 * dt) % 1;
    const duration = actor.weapon.definition.reloadTime ?? 1;
    const pose = weaponPose(actor);
    const sinceShot = actor.weapon.definition.interval - actor.fireCooldown;
    return sampleHumanoid({
      outfit: actor.config.appearance?.outfit,
      airWeight: this.air, fallWeight: this.fall, tuckWeight: this.tuck,
      time: this.time, cycle: this.cycle, run: this.run,
      airborne: actor.groundedOn === null, falling: actor.verticalVelocity >= -40,
      doubleJump: actor.jumpsRemaining === 0 && actor.verticalVelocity < -80,
      landing: landingAge >= 0 ? Math.sin(clamp01(landingAge / 0.18) * Math.PI) : 0,
      hurt: hurtAge >= 0 ? Math.max(0, 1 - hurtAge / 0.16) : 0,
      reload: actor.reloadRemaining > 0 ? clamp01(1 - actor.reloadRemaining / duration) : 0,
      recoil: actor.fireCooldown > 0 && sinceShot >= 0 ? clamp01(1 - sinceShot / 0.11) : 0,
      weaponId: actor.weapon.definition.id,
      weapon: { x: 22 + pose.x, y: -32 + pose.y, rotation: pose.rotation * actor.facing, alpha: pose.alpha },
    });
  }
}

export function worldWeaponMount(pose: HumanoidPose, feet: Vec2, facing: -1 | 1, scale = 1): WeaponMount {
  return { x: feet.x + facing * pose.weapon.x * scale, y: feet.y + pose.weapon.y * scale, rotation: pose.weapon.rotation * facing, alpha: pose.weapon.alpha };
}

/** Cosmetic flash follows the rendered stock/arms; projectile collision stays in the core. */
export function mountedWeaponMuzzle(mount: WeaponMount, id: WeaponId, facing: -1 | 1): Vec2 {
  const muzzle = weaponMuzzle(id);
  return offset({ x: (muzzle.x - 22) * facing, y: muzzle.y + 32 }, mount, mount.rotation);
}

import type { ActorState } from '../game/core/types';

/** Visual poses only. Feet, collision and the simulation never depend on these. */
export interface CharacterPose {
  stride?: number;
  cycle?: number;
  breath?: number;
  airborne?: boolean;
  falling?: boolean;
  doubleJump?: boolean;
  landing?: boolean;
  reload?: number;
  recoil?: number;
  hurt?: boolean;
}

export const CHARACTER_ANIMATION = {
  frames: 22, columns: 8,
  idle: 0, run: 4, rise: 12, fall: 13, doubleJump: 14,
  land: 15, reload: 16, hurt: 20,
} as const;

/** Frame layout is shared by the atlas and the runtime, including its preview tool. */
export function characterPoseForFrame(frame: number): CharacterPose {
  if (frame < 4) return { breath: [0, 0.5, 1, 0.5][frame] ?? 0 };
  if (frame < 12) {
    const cycle = (frame - 4) / 8;
    return { cycle, stride: Math.sin(cycle * Math.PI * 2) * 6 };
  }
  if (frame === 12) return { airborne: true };
  if (frame === 13) return { airborne: true, falling: true };
  if (frame === 14) return { airborne: true, doubleJump: true };
  if (frame === 15) return { landing: true };
  if (frame < 20) return { reload: (frame - 15) / 4 };
  return { hurt: true, breath: frame === 20 ? 0 : 0.5 };
}

export function characterFrame(actor: Readonly<ActorState>, time: number, hurtAge = Infinity, landingAge = Infinity): number {
  if (hurtAge >= 0 && hurtAge < 0.14) return CHARACTER_ANIMATION.hurt + (hurtAge < 0.07 ? 0 : 1);
  // Shooting never replaces the running/jumping body frame. WeaponLayer handles
  // its recoil around a stable grip, so rapid fire cannot freeze the legs.
  if (actor.groundedOn === null) return actor.jumpsRemaining === 0 && actor.verticalVelocity < -80
    ? CHARACTER_ANIMATION.doubleJump : actor.verticalVelocity < -40 ? CHARACTER_ANIMATION.rise : CHARACTER_ANIMATION.fall;
  if (Math.abs(actor.moveVelocity) > 15) return CHARACTER_ANIMATION.run + Math.floor(time * 12) % 8;
  if (landingAge >= 0 && landingAge < 0.1) return CHARACTER_ANIMATION.land;
  if (actor.reloadRemaining > 0) {
    const duration = actor.weapon.definition.reloadTime ?? 1;
    const progress = Math.max(0, Math.min(0.999, 1 - actor.reloadRemaining / duration));
    return CHARACTER_ANIMATION.reload + Math.floor(progress * 4);
  }
  return CHARACTER_ANIMATION.idle + Math.floor(time * 3) % 4;
}

export const CHARACTER_GRIP = { x: 16, y: -24 } as const;

const RELOAD_TILT: Partial<Record<string, number>> = {
  pistol: 0.34, smg: 0.48, rifle: 0.55, shotgun: 0.78, sniper: 0.64, rocket: 0.72,
};

/** Rotation is cosmetic and pivots at the same hand in all poses and facings. */
export function weaponPose(actor: Readonly<ActorState>): { rotation: number; alpha: number } {
  const duration = actor.weapon.definition.reloadTime ?? 1;
  const family = actor.weapon.definition.family ?? actor.weapon.definition.id;
  const reload = actor.reloadRemaining > 0 ? Math.max(0, Math.min(1, 1 - actor.reloadRemaining / duration)) : 0;
  const reloadTilt = actor.reloadRemaining > 0 ? Math.sin(reload * Math.PI) * (RELOAD_TILT[family] ?? 0.48) : 0;
  const sinceShot = actor.weapon.definition.interval - actor.fireCooldown;
  const recoil = actor.fireCooldown > 0 && sinceShot >= 0 ? Math.max(0, Math.min(1, 1 - sinceShot / 0.11)) : 0;
  return { rotation: (-reloadTilt - recoil * 0.08) * actor.facing, alpha: actor.protectionRemaining > 0 ? 0.78 : 1 };
}

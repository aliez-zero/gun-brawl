import { describe, expect, it } from 'vitest';
import { APPEARANCE_PRESETS, presetAppearance } from '../src/content/appearances';
import { createMatchConfig } from '../src/content/matches';
import { WEAPONS, WEAPON_MODELS } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import type { Vec2, WeaponId } from '../src/game/core/types';
import { humanoidSupportGrip, HumanoidMotion, sampleHumanoid, worldWeaponMount } from '../src/presentation/characters/HumanoidRig';
import type { HumanoidMotionInput, HumanoidPose } from '../src/presentation/characters/HumanoidRig';
import { WEAPON_ART, weaponDisplayScale } from '../src/presentation/WeaponArt';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const input: HumanoidMotionInput = {
  time: 0, cycle: 0, run: 0, airborne: false, falling: false, doubleJump: false,
  landing: 0, hurt: 0, reload: 0, recoil: 0, weaponId: 'pistol',
};
const variants: Partial<HumanoidMotionInput>[] = [
  {}, ...Array.from({ length: 8 }, (_, i) => ({ run: 1, cycle: i / 8 })),
  { airborne: true }, { airborne: true, falling: true }, { airborne: true, doubleJump: true },
  { landing: 1 }, { hurt: 1 }, { reload: 0.25 }, { reload: 0.5 }, { reload: 0.75 }, { recoil: 1 },
];
const part = (pose: HumanoidPose, name: string) => pose.parts.find((p) => p.part === name)!;

describe.each(APPEARANCE_PRESETS)('$id shared human anatomy', ({ id }) => {
  it('keeps fixed limbs, forward knees and reachable weapon grips through every weapon and action', () => {
    for (const weaponId of Object.keys({ ...WEAPONS, ...WEAPON_MODELS }) as WeaponId[]) for (const variant of variants) {
      const pose = sampleHumanoid({ ...input, outfit: id, weaponId, ...variant });
      for (const back of [false, true]) {
        const hip = part(pose, back ? 'thighBack' : 'thigh');
        const knee = part(pose, back ? 'shinBack' : 'shin');
        const ankle = part(pose, back ? 'bootBack' : 'boot');
        expect(distance(hip, knee)).toBeCloseTo(15.5, 5);
        expect(distance(knee, ankle)).toBeCloseTo(14.5, 5);
        expect((ankle.x - hip.x) * (knee.y - hip.y) - (ankle.y - hip.y) * (knee.x - hip.x)).toBeLessThan(0);
        const shoulder = part(pose, back ? 'upperBack' : 'upper');
        const elbow = part(pose, back ? 'foreBack' : 'fore');
        expect(distance(shoulder, elbow)).toBeCloseTo(16.5, 5);
        expect(distance(elbow, back ? pose.supportHand : pose.triggerHand)).toBeCloseTo(15.5, 5);
      }
      expect(distance(pose.triggerHand, pose.weapon)).toBeLessThan(0.01);
      const grip = humanoidSupportGrip(weaponId);
      if (grip && !variant.reload) {
        const scale = weaponDisplayScale(weaponId) * 3;
        const dx = (grip.x - WEAPON_ART.gripX) * scale, dy = (grip.y - WEAPON_ART.gripY) * scale;
        const a = pose.weapon.rotation;
        expect(distance(pose.supportHand, { x: pose.weapon.x + dx * Math.cos(a) - dy * Math.sin(a), y: pose.weapon.y + dx * Math.sin(a) + dy * Math.cos(a) }), `${weaponId}/${JSON.stringify(variant)}`).toBeLessThan(0.01);
      }
      for (const facing of [-1, 1] as const) {
        const mount = worldWeaponMount(pose, { x: 500, y: 620 }, facing);
        expect(mount.x).toBeCloseTo(500 + facing * pose.triggerHand.x);
        expect(mount.y).toBeCloseTo(620 + pose.triggerHand.y);
      }
    }
  });

  it('animates mixed identities without altering combat state, freezes and resets the whole body', () => {
    const simulation = new BattleSimulation({ ...createMatchConfig('training', 23), countdown: 0 });
    const actor = simulation.state.actors[0]!;
    for (const identity of APPEARANCE_PRESETS) {
      actor.config = { ...actor.config, appearance: { ...presetAppearance(identity.id), outfit: id } };
      actor.groundedOn = 'floor'; actor.moveVelocity = 260;
      const before = structuredClone(actor), motion = new HumanoidMotion();
      const first = motion.sample(actor, 0.1, Infinity, Infinity);
      const next = motion.sample(actor, 0.1, Infinity, Infinity);
      expect(next.parts).not.toEqual(first.parts);
      expect(motion.sample(actor, 0, Infinity, Infinity)).toEqual(next);
      expect(actor).toEqual(before);
      expect(new HumanoidMotion().sample(actor, 0, Infinity, Infinity)).toEqual(new HumanoidMotion().sample(actor, 0, Infinity, Infinity));
    }
  });
});

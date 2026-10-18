import { describe, expect, it } from 'vitest';
import { presetAppearance } from '../src/content/appearances';
import { createMatchConfig } from '../src/content/matches';
import { createWeapon, weaponMuzzle, WEAPONS, WEAPON_MODELS } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { Vec2, WeaponId } from '../src/game/core/types';
import { CowboyMotion, cowboySupportGrip, hasCowboyRig, mountedWeaponMuzzle, sampleCowboy, worldWeaponMount } from '../src/presentation/characters/CowboyRig';
import type { CowboyMotionInput } from '../src/presentation/characters/CowboyRig';
import { solveLimb } from '../src/presentation/characters/RigMath';
import { weaponDisplayScale, WEAPON_ART } from '../src/presentation/WeaponArt';

const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
const input: CowboyMotionInput = {
  time: 0, cycle: 0, run: 0, airborne: false, falling: false, doubleJump: false,
  landing: 0, hurt: 0, reload: 0, recoil: 0, weaponId: 'pistol',
};
function active() {
  const simulation = new BattleSimulation({ ...createMatchConfig('training', 345), countdown: 0 });
  for (let i = 0; i < 2; i++) simulation.step(FIXED_STEP, new Map());
  return simulation;
}

describe('layered cowboy rig', () => {
  it('solves both elbow bends, mirrored targets and unreachable targets without invalid bone lengths', () => {
    const root = { x: 2, y: -40 };
    for (const target of [{ x: 22, y: -32 }, { x: -22, y: -32 }, root, { x: 200, y: -40 }]) {
      for (const bend of [-1, 1] as const) {
        const result = solveLimb(root, target, 16, 16, bend);
        expect(distance(root, result.joint)).toBeCloseTo(16, 5);
        expect(distance(result.joint, result.end)).toBeCloseTo(16, 5);
        expect(distance(root, result.end)).toBeLessThanOrEqual(32);
        if (distance(root, target) > 0 && distance(root, target) < 32) expect(distance(result.end, target)).toBeLessThan(0.001);
      }
    }
  });

  it('keeps trigger and support hands on the actual art grips for every weapon, both directions', () => {
    for (const id of Object.keys({ ...WEAPONS, ...WEAPON_MODELS }) as WeaponId[]) {
      for (const cycle of [0, 0.25, 0.5, 0.75]) for (const recoil of [0, 1]) {
        const pose = sampleCowboy({ ...input, weaponId: id, run: 1, cycle, recoil });
        expect(distance(pose.triggerHand, pose.weapon), `trigger ${id}`).toBeLessThan(0.01);
        const attachment = cowboySupportGrip(id);
        if (attachment) {
          const scale = weaponDisplayScale(id) * 3;
          const dx = (attachment.x - WEAPON_ART.gripX) * scale;
          const dy = (attachment.y - WEAPON_ART.gripY) * scale;
          const angle = pose.weapon.rotation;
          const desired = { x: pose.weapon.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: pose.weapon.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
          expect(distance(pose.supportHand, desired), `support ${id}`).toBeLessThan(0.01);
        }
        for (const facing of [-1, 1] as const) {
          const mount = worldWeaponMount(pose, { x: 500, y: 400 }, facing);
          expect(mount.x).toBeCloseTo(500 + pose.triggerHand.x * facing);
          expect(mount.y).toBeCloseTo(400 + pose.triggerHand.y);
          expect(mount.rotation).toBe(pose.weapon.rotation * facing);
        }
      }
    }
  });

  it('keeps running through real continuous fire and running reload without modifying game state', () => {
    const simulation = active();
    simulation.selectTrainingWeapon('m416');
    const actor = simulation.state.actors[0]!;
    const motion = new CowboyMotion();
    const strides = new Set<string>();
    let shots = 0, reloadSeen = false;
    for (let i = 0; i < 45; i++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), moveX: 1, shootHeld: true, reloadPressed: i === 18 }]]));
      shots += simulation.drainEvents().filter((event) => event.type === 'shot').length;
      reloadSeen ||= actor.reloadRemaining > 0;
      const before = structuredClone(actor);
      const pose = motion.sample(actor, FIXED_STEP, Infinity, Infinity);
      strides.add(pose.parts.find((part) => part.part === 'thigh')!.rotation.toFixed(3));
      expect(distance(pose.triggerHand, pose.weapon)).toBeLessThan(0.01);
      expect(actor).toEqual(before);
    }
    expect(shots).toBeGreaterThan(1);
    expect(reloadSeen).toBe(true);
    expect(strides.size).toBeGreaterThan(20);
  });

  it('freezes every layer at zero visual delta and resets without carrying a previous life gait', () => {
    const actor = active().state.actors[0]!;
    const running = { ...actor, moveVelocity: 300, fireCooldown: 0 };
    const motion = new CowboyMotion();
    let pose = motion.sample(running, 0.1, Infinity, Infinity);
    for (let i = 0; i < 20; i++) expect(motion.sample(running, 0, Infinity, Infinity)).toEqual(pose);
    const resumed = motion.sample(running, 0.1, Infinity, Infinity);
    expect(resumed.parts).not.toEqual(pose.parts);
    pose = new CowboyMotion().sample(actor, 0, Infinity, Infinity);
    expect(pose).toEqual(new CowboyMotion().sample(actor, 0, Infinity, Infinity));
  });

  it('compresses on landing, settles, tucks in the air and independently moves coat and scarf', () => {
    const rest = sampleCowboy(input);
    const land = sampleCowboy({ ...input, landing: 1 });
    const double = sampleCowboy({ ...input, airborne: true, doubleJump: true });
    const run = sampleCowboy({ ...input, cycle: 0.3, run: 1 });
    const part = (pose: typeof rest, name: string) => pose.parts.find((entry) => entry.part === name)!;
    expect(part(land, 'torso').y).toBeGreaterThan(part(rest, 'torso').y);
    expect(part(double, 'bootBack').y).toBeLessThan(part(rest, 'bootBack').y - 10);
    expect(part(run, 'coatBack').rotation).not.toBe(part(run, 'torso').rotation);
    expect(part(run, 'scarfTail').rotation).not.toBe(part(run, 'coatBack').rotation);
    // Boots pivot at the ankle; the painted sole is five units beneath it.
    for (const name of ['boot', 'bootBack']) expect(part(rest, name).y + 5).toBeCloseTo(0);
    const actor = active().state.actors[0]!;
    const motion = new CowboyMotion();
    expect(part(motion.sample(actor, 0, Infinity, 0.09), 'torso').y).toBeGreaterThan(part(motion.sample(actor, 0, Infinity, 0.3), 'torso').y);
  });

  it('keeps anatomical bone lengths identical through running, jumps, landing, reload and every weapon', () => {
    const poses: Partial<CowboyMotionInput>[] = [
      {}, { airborne: true }, { airborne: true, falling: true }, { airborne: true, doubleJump: true },
      { landing: 1 }, { hurt: 1 }, { reload: 0.25 }, { reload: 0.5 }, { reload: 0.75 },
      ...Array.from({ length: 12 }, (_, index) => ({ run: 1, cycle: index / 12 })),
    ];
    const lengths = (pose: ReturnType<typeof sampleCowboy>) => {
      const part = (name: string) => pose.parts.find((entry) => entry.part === name)!;
      return [
        distance(part('thigh'), part('shin')), distance(part('shin'), part('boot')),
        distance(part('thighBack'), part('shinBack')), distance(part('shinBack'), part('bootBack')),
        distance(part('upper'), part('fore')), distance(part('fore'), pose.triggerHand),
        distance(part('upperBack'), part('foreBack')), distance(part('foreBack'), pose.supportHand),
      ];
    };
    const reference = lengths(sampleCowboy(input));
    for (const weaponId of Object.keys({ ...WEAPONS, ...WEAPON_MODELS }) as WeaponId[]) for (const override of poses) {
      const pose = sampleCowboy({ ...input, weaponId, ...override });
      const measured = lengths(pose);
      measured.forEach((length, index) => expect(length, `${weaponId} bone ${index}`).toBeCloseTo(reference[index]!, 5));
      expect(measured[4]).toBeCloseTo(measured[6]!);
      expect(measured[5]).toBeCloseTo(measured[7]!);
      expect(distance(pose.triggerHand, pose.weapon), `trigger ${weaponId} ${JSON.stringify(override)}`).toBeLessThan(0.01);
    }
  });

  it('bends both knees forwards, including the returning foot and both airborne legs', () => {
    for (let frame = 0; frame < 24; frame++) for (const airborne of [false, true]) {
      const pose = sampleCowboy({ ...input, cycle: frame / 24, run: 1, airborne, doubleJump: airborne });
      for (const back of [false, true]) {
        const hip = pose.parts.find((part) => part.part === (back ? 'thighBack' : 'thigh'))!;
        const knee = pose.parts.find((part) => part.part === (back ? 'shinBack' : 'shin'))!;
        const ankle = pose.parts.find((part) => part.part === (back ? 'bootBack' : 'boot'))!;
        const bend = (ankle.x - hip.x) * (knee.y - hip.y) - (ankle.y - hip.y) * (knee.x - hip.x);
        expect(bend, `${back ? 'back' : 'front'} knee frame ${frame}`).toBeLessThan(0);
      }
    }
  });

  it('keeps the flash on the visible barrel after shouldering a long gun, on both sides', () => {
    for (const weaponId of ['pistol', 'awm', 'rpg7'] as const) for (const facing of [-1, 1] as const) {
      const pose = sampleCowboy({ ...input, weaponId });
      const mount = worldWeaponMount(pose, { x: 400, y: 620 }, facing);
      const flash = mountedWeaponMuzzle(mount, weaponId, facing);
      const muzzle = weaponMuzzle(weaponId);
      // Long guns are held closer to the body; flashes must follow that offset.
      expect(flash.x).toBeCloseTo(400 + facing * (muzzle.x - (weaponId === 'pistol' ? 0 : 9)));
      expect(flash.y).toBeCloseTo(620 + muzzle.y);
      expect(distance(mount, flash)).toBeCloseTo(Math.hypot(muzzle.x - 22, muzzle.y + 32));
    }
  });

  it('keeps the original cowboy compatibility helpers and finite reload poses', () => {
    expect(hasCowboyRig(presetAppearance('cowboy'))).toBe(true);
    expect(hasCowboyRig({ ...presetAppearance('cowboy'), hat: 'space' })).toBe(true);
    expect(hasCowboyRig({ ...presetAppearance('cowboy'), outfit: 'ronin' })).toBe(false);
    expect(hasCowboyRig(presetAppearance('ronin'))).toBe(false);
    const actor = active().state.actors[0]!;
    for (const id of ['pistol', 'awm'] as const) {
      const pose = new CowboyMotion().sample({ ...actor, weapon: createWeapon(id), reloadRemaining: 0.5 }, 0.05, 0.1, 0.05);
      expect(pose.parts.every((part) => Number.isFinite(part.x + part.y + part.rotation + part.scaleY))).toBe(true);
    }
  });
});

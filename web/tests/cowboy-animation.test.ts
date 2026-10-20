import { describe, expect, it } from 'vitest';
import { presetAppearance } from '../src/content/appearances';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import type { Vec2 } from '../src/game/core/types';
import { COWBOY_CLIPS, cowboyStep, sampleCurve } from '../src/presentation/characters/CowboyClips';
import { HumanoidMotion, sampleHumanoid } from '../src/presentation/characters/HumanoidRig';
import type { HumanoidMotionInput, HumanoidPose } from '../src/presentation/characters/HumanoidRig';
import { LIMB_SKINS, SKIN_ROWS, skinStrip, skinVertex } from '../src/presentation/characters/LimbSkin';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const input: HumanoidMotionInput = {
  outfit: 'cowboy', time: 0, cycle: 0, run: 0, airborne: false, falling: false,
  doubleJump: false, landing: 0, hurt: 0, reload: 0, recoil: 0, weaponId: 'pistol',
};
const boot = (pose: HumanoidPose) => pose.parts.find((part) => part.part === 'bootBack')!;

describe('free cowboy animation pilot', () => {
  it('loops locomotion without a positional or velocity discontinuity', () => {
    for (const name of ['footTravel', 'footLift', 'footRoll', 'compression', 'torso', 'coat'] as const) {
      const curve = COWBOY_CLIPS[name], epsilon = 0.00001;
      expect(sampleCurve(curve, 0)).toBeCloseTo(sampleCurve(curve, 1), 7);
      const entry = (sampleCurve(curve, epsilon) - sampleCurve(curve, 0)) / epsilon;
      const exit = (sampleCurve(curve, 1) - sampleCurve(curve, 1 - epsilon)) / epsilon;
      expect(Math.abs(entry - exit), name).toBeLessThan(0.03);
    }
  });

  it('keeps the stance foot flat in height, then lifts and returns smoothly', () => {
    for (let frame = 0; frame <= 56; frame++) expect(cowboyStep(frame / 100).lift).toBe(0);
    const steps = Array.from({ length: 241 }, (_, i) => cowboyStep(i / 240));
    expect(Math.max(...steps.map((step) => step.lift))).toBeGreaterThan(12);
    expect(steps.every((step) => step.lift >= 0 && step.lift <= 14)).toBe(true);
    expect(cowboyStep(0)).toEqual(cowboyStep(1));
    expect(cowboyStep(-0.25)).toEqual(cowboyStep(0.75));
    for (let frame = 1; frame < steps.length; frame++) {
      expect(Math.abs(steps[frame]!.travel - steps[frame - 1]!.travel)).toBeLessThan(0.6);
    }
  });

  it('binds skin roots and tips to solved bones, with a continuous joint surface', () => {
    for (let frame = 0; frame < 32; frame++) {
      const pose = sampleHumanoid({ ...input, run: 1, cycle: frame / 32, reload: frame / 32, weaponId: 'awm' });
      for (const chain of Object.values(pose.limbs!)) {
        expect(distance(skinVertex(chain, 0, 0), chain.root)).toBeLessThan(0.00001);
        expect(distance(skinVertex(chain, 0, chain.upper), chain.joint)).toBeLessThan(0.00001);
        expect(distance(skinVertex(chain, 0, chain.upper + chain.lower), chain.end)).toBeLessThan(0.00001);
        const upper = skinStrip(chain, { chain: 'arm', lower: false, left: -3, right: 3, top: 0, bottom: chain.upper });
        const lower = skinStrip(chain, { chain: 'arm', lower: true, left: -3, right: 3, top: 0, bottom: chain.lower });
        expect([...upper.slice(-4)]).toEqual([...lower.slice(0, 4)]);
        // Each side of the joint follows both bones, rather than a rigid cap.
        for (const x of [-3, 3]) {
          expect(distance(skinVertex(chain, x, chain.upper - 0.0001), skinVertex(chain, x, chain.upper + 0.0001))).toBeLessThan(0.001);
        }
      }
    }
  });

  it('reuses live vertex buffers and preserves finite geometry through airborne and reload poses', () => {
    const vertices = new Float32Array(SKIN_ROWS * 4);
    for (let frame = 0; frame < 60; frame++) {
      const pose = sampleHumanoid({ ...input, cycle: frame / 60, run: 1, airWeight: frame / 60,
        fallWeight: frame / 60, tuckWeight: 1 - frame / 60, reload: frame / 60 });
      for (const spec of Object.values(LIMB_SKINS)) {
        const chain = pose.limbs![spec.chain];
        expect(skinStrip(chain, spec, vertices)).toBe(vertices);
        expect([...vertices].every(Number.isFinite)).toBe(true);
        expect(distance(chain.root, chain.joint)).toBeCloseTo(chain.upper, 6);
        expect(distance(chain.joint, chain.end)).toBeCloseTo(chain.lower, 6);
      }
    }
  });

  it('blends takeoff, falling and touchdown, freezes deformation and resets on a new life', () => {
    const actor = new BattleSimulation(createMatchConfig('training', 9)).state.actors[0]!;
    actor.config = { ...actor.config, appearance: presetAppearance('cowboy') };
    actor.groundedOn = 'floor'; actor.moveVelocity = 0; actor.fireCooldown = 0;
    const motion = new HumanoidMotion();
    let previous = motion.sample(actor, 1 / 60, Infinity, Infinity);
    for (const state of [
      { groundedOn: null, verticalVelocity: -600, jumpsRemaining: 1 },
      { groundedOn: null, verticalVelocity: 400, jumpsRemaining: 1 },
      { groundedOn: 'floor', verticalVelocity: 0, jumpsRemaining: 2 },
    ]) {
      Object.assign(actor, state);
      const before = structuredClone(actor);
      const first = motion.sample(actor, 1 / 120, Infinity, Infinity);
      expect(distance(boot(first), boot(previous))).toBeLessThan(3);
      for (let i = 0; i < 20; i++) expect(motion.sample(actor, 0, Infinity, Infinity)).toEqual(first);
      for (let i = 0; i < 60; i++) previous = motion.sample(actor, 1 / 60, Infinity, Infinity);
      expect(actor).toEqual(before);
    }
    expect(distance(boot(previous), boot(sampleHumanoid(input)))).toBeLessThan(0.02);
    const reset = new HumanoidMotion().sample(actor, 0, Infinity, Infinity);
    expect(reset).toEqual(new HumanoidMotion().sample(actor, 0, Infinity, Infinity));
    expect(reset.limbs).toBeDefined();
  });

  it('moves the support hand towards the belt and back while keeping the firing hand attached', () => {
    const ready = sampleHumanoid({ ...input, weaponId: 'm416' });
    const reaching = sampleHumanoid({ ...input, weaponId: 'm416', reload: 0.3 });
    expect(reaching.supportHand.y).toBeGreaterThan(ready.supportHand.y + 2);
    for (let frame = 0; frame <= 100; frame++) {
      const pose = sampleHumanoid({ ...input, weaponId: 'm416', reload: frame / 100 });
      expect(distance(pose.triggerHand, pose.weapon)).toBeLessThan(0.01);
    }
    const finished = sampleHumanoid({ ...input, weaponId: 'm416', reload: 1 });
    expect(distance(finished.supportHand, ready.supportHand)).toBeLessThan(0.01);
  });
});

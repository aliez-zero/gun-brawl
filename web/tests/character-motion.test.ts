import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { createWeapon } from '../src/content/weapons';
import { idleInput } from '../src/game/core/types';
import { CHARACTER_ANIMATION, characterFrame, characterPoseForFrame, weaponPose } from '../src/presentation/CharacterMotion';

function active() {
  const simulation = new BattleSimulation({ ...createMatchConfig('training', 543), countdown: 0 });
  for (let i = 0; i < 2; i++) simulation.step(FIXED_STEP, new Map());
  return simulation;
}

describe('character presentation consumes movement and combat without changing them', () => {
  it('continuous fire preserves the running cycle instead of locking both legs', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    const frames = new Set<number>();
    let shots = 0;
    for (let i = 0; i < 35; i++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), moveX: 1 as const, shootHeld: true }]]));
      shots += simulation.drainEvents().filter((event) => event.type === 'shot' && event.actorId === 'p1').length;
      frames.add(characterFrame(actor, simulation.state.elapsed));
    }
    expect(shots).toBeGreaterThan(1);
    expect(frames.size).toBeGreaterThanOrEqual(6);
    expect([...frames].every((frame) => characterPoseForFrame(frame).cycle !== undefined)).toBe(true);
    expect(actor.stocks).toBe(3);
  });

  it('a legal double jump changes the tuck and falling has its own open-legged pose', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    let rise = false, tuck = false, fall = false;
    for (let i = 0; i < 95; i++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), jumpPressed: i === 0 || i === 20 }]]));
      const pose = characterPoseForFrame(characterFrame(actor, simulation.state.elapsed));
      rise ||= Boolean(pose.airborne && !pose.falling && !pose.doubleJump);
      tuck ||= Boolean(pose.doubleJump);
      fall ||= Boolean(pose.falling);
    }
    expect({ rise, tuck, fall }).toEqual({ rise: true, tuck: true, fall: true });
    expect(actor.groundedOn).not.toBeNull();
    expect(actor.stocks).toBe(3);
  });

  it('uses reload poses from a real reload and restores the resting grip afterwards', () => {
    const simulation = active();
    simulation.selectTrainingWeapon(2);
    const actor = simulation.state.actors[0]!;
    simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), reloadPressed: true }]]));
    const poses = new Set<number>();
    let tilted = false;
    let sank = false;
    for (let i = 0; i < 180 && actor.reloadRemaining > 0; i++) {
      poses.add(characterFrame(actor, simulation.state.elapsed));
      const pose = weaponPose(actor);
      tilted ||= Math.abs(pose.rotation) > 0.2;
      sank ||= pose.y > 0.1;
      simulation.step(FIXED_STEP, new Map());
    }
    expect(sank).toBe(true);
    expect(poses.size).toBe(4);
    expect([...poses].every((frame) => Boolean(characterPoseForFrame(frame).reload))).toBe(true);
    expect(tilted).toBe(true);
    expect(weaponPose(actor).rotation).toBeCloseTo(0);
    expect(actor.weapon.ammoRemaining).toBe(actor.weapon.definition.maxAmmo);
  });

  it('scales reload sink by each model reload time', () => {
    const actor = active().state.actors[0]!;
    const awm = weaponPose({ ...actor, weapon: createWeapon('awm'), reloadRemaining: 1.3 });
    const vector = weaponPose({ ...actor, weapon: createWeapon('vector'), reloadRemaining: 0.75 });
    expect(awm.y).toBeGreaterThan(vector.y);
    expect(Math.abs(awm.rotation)).toBeGreaterThan(Math.abs(vector.rotation) * 0.5);
  });

  it('mirrors recoil and reload around the grip without touching actor state', () => {
    const actor = active().state.actors[0]!;
    actor.fireCooldown = actor.weapon.definition.interval;
    const before = structuredClone(actor);
    const right = weaponPose(actor);
    const left = weaponPose({ ...actor, facing: -1 });
    expect(right.rotation).toBeLessThan(0);
    expect(left.rotation).toBe(-right.rotation);
    // A pickup preserves the old firing cooldown. It must not be interpreted as
    // an oversized recoil for a new, faster weapon and spin it around the hand.
    expect(weaponPose({ ...actor, fireCooldown: 2 }).rotation).toBeCloseTo(0);
    characterFrame(actor, 1.5, 0.05, 0.01);
    expect(actor).toEqual(before);
  });

  it('keeps all pose combinations within the atlas, including running reloads and hurt in midair', () => {
    const actor = active().state.actors[0]!;
    for (const groundedOn of [null, actor.groundedOn]) for (const moveVelocity of [-300, 0, 300]) {
      for (const verticalVelocity of [-700, 0, 700]) for (const jumpsRemaining of [0, 1, 2]) {
        for (const reloadRemaining of [0, 0.8]) for (const hurtAge of [0.03, 0.1, Infinity]) {
          const sample = { ...actor, groundedOn, moveVelocity, verticalVelocity, jumpsRemaining, reloadRemaining };
          const frame = characterFrame(sample, 2.1, hurtAge, 0.01);
          expect(frame).toBeGreaterThanOrEqual(0);
          expect(frame).toBeLessThan(CHARACTER_ANIMATION.frames);
        }
      }
    }
  });
});

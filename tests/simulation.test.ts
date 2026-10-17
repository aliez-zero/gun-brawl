import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { FixedStepLoop } from '../src/game/core/FixedStepLoop';
import { MatchRunner } from '../src/game/core/MatchRunner';
import { idleInput } from '../src/game/core/types';
import type { ActorInput, GameMode, MatchConfig } from '../src/game/core/types';

const empty = new Map<string, ActorInput>();
function active(overrides: Partial<MatchConfig> = {}, mode: GameMode = 'local-duel'): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig(mode, 1234), countdown: 0, ...overrides });
  simulation.step(FIXED_STEP, empty);
  simulation.step(FIXED_STEP, empty);
  simulation.drainEvents();
  return simulation;
}
function tick(simulation: BattleSimulation, frames: number, input?: ActorInput): void {
  for (let i = 0; i < frames; i++) simulation.step(FIXED_STEP, input ? new Map([['p1', input]]) : empty);
}

describe('movement and collision', () => {
  it('allows exactly two jumps, then resets only after landing', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    tick(simulation, 1, { ...idleInput(), jumpPressed: true });
    expect(actor.jumpsRemaining).toBe(1);
    tick(simulation, 8);
    tick(simulation, 1, { ...idleInput(), jumpPressed: true });
    expect(actor.jumpsRemaining).toBe(0);
    const beforeThird = actor.verticalVelocity;
    tick(simulation, 1, { ...idleInput(), jumpPressed: true });
    expect(actor.verticalVelocity).toBeGreaterThan(beforeThird);
    tick(simulation, 120);
    expect(actor.groundedOn).not.toBeNull();
    expect(actor.jumpsRemaining).toBe(2);
  });

  it('retains one air jump when walking off after the coyote window', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    actor.position.x = 1170;
    tick(simulation, 9);
    expect(actor.groundedOn).toBeNull();
    expect(actor.jumpsRemaining).toBe(1);
    tick(simulation, 1, { ...idleInput(), jumpPressed: true });
    expect(actor.jumpsRemaining).toBe(0);
    expect(actor.verticalVelocity).toBeLessThan(0);
  });

  it('drops through the current platform and lands on the next platform', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    actor.position = { x: 640, y: 500 };
    actor.groundedOn = 'center';
    tick(simulation, 1, { ...idleInput(), dropPressed: true });
    tick(simulation, 8);
    expect(actor.position.y).toBeGreaterThan(500);
    expect(actor.position.y).toBeLessThan(620);
    tick(simulation, 50);
    expect(actor.groundedOn).toBe('main');
    expect(actor.position.y).toBe(620);
  });

  it('does not clamp knockback to the active movement speed', () => {
    const simulation = active();
    const actor = simulation.state.actors[0]!;
    actor.impulse.x = 700;
    const before = actor.position.x;
    tick(simulation, 1, { ...idleInput(), moveX: 1 });
    expect((actor.position.x - before) / FIXED_STEP).toBeGreaterThan(300);
  });
});

describe('projectiles', () => {
  it.each([-1, 1] as const)('pushes an inward-running opponent off the %i side with sustained pistol hits', (direction) => {
    const simulation = active();
    const [shooter, target] = simulation.state.actors;
    shooter!.position.x = direction === 1 ? 780 : 500;
    shooter!.facing = direction;
    target!.position.x = direction === 1 ? 1060 : 220;
    target!.protectionRemaining = 0;
    target!.moveVelocity = -direction * 300;
    const inputs = new Map<string, ActorInput>([
      ['p1', { ...idleInput(), shootHeld: true }],
      ['p2', { ...idleInput(), moveX: direction === 1 ? -1 : 1 }],
    ]);
    let hits = 0;
    let creditedTo: string | null = null;
    for (let frame = 0; frame < 150 && target!.stocks === 3; frame++) {
      simulation.step(FIXED_STEP, inputs);
      for (const event of simulation.drainEvents()) {
        if (event.type === 'hit' && event.actorId === 'p2') hits++;
        if (event.type === 'ringout' && event.actorId === 'p2') creditedTo = event.creditedTo;
      }
    }
    expect(hits).toBeGreaterThan(1);
    expect(hits).toBeLessThanOrEqual(6);
    expect(target!.stocks).toBe(2);
    expect(creditedTo).toBe('p1');
    // Walking through the shooter and falling off the opposite edge is not a successful push.
    expect(direction * (target!.position.x - 640)).toBeGreaterThan(400);
  });

  it('allows inward movement to recover from an isolated pistol hit near an edge', () => {
    const simulation = active();
    const [shooter, target] = simulation.state.actors;
    shooter!.position.x = 780;
    target!.position.x = 1060;
    target!.protectionRemaining = 0;
    target!.moveVelocity = -300;
    let hits = 0;
    for (let frame = 0; frame < 120; frame++) {
      simulation.step(FIXED_STEP, new Map<string, ActorInput>([
        ['p1', { ...idleInput(), shootHeld: frame === 0 }],
        ['p2', { ...idleInput(), moveX: -1 }],
      ]));
      hits += simulation.drainEvents().filter((event) => event.type === 'hit' && event.actorId === 'p2').length;
    }
    expect(hits).toBe(1);
    expect(target!.stocks).toBe(3);
    expect(target!.position.x).toBeLessThan(1060);
    expect(target!.groundedOn).toBe('main');
  });

  it('sweeps fast bullets through the target instead of tunneling past it', () => {
    const simulation = active();
    const target = simulation.state.actors[1]!;
    target.position.x = 420;
    target.protectionRemaining = 0;
    simulation.step(0.1, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    expect(simulation.drainEvents().some((event) => event.type === 'hit')).toBe(true);
    expect(target.impulse.x).toBeGreaterThan(0);
    expect(target.stocks).toBe(3);
  });

  it('lets a solid wall block a bullet before reaching an actor', () => {
    const config = createMatchConfig('local-duel', 1234);
    const simulation = active({ map: { ...config.map, platforms: [...config.map.platforms, { id: 'wall', x: 390, y: 500, width: 10, height: 120, kind: 'solid' }] } });
    const target = simulation.state.actors[1]!;
    target.position.x = 430;
    target.protectionRemaining = 0;
    simulation.step(0.1, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    expect(simulation.drainEvents().some((event) => event.type === 'hit')).toBe(false);
    expect(target.impulse.x).toBe(0);
  });

  it('blocks knockback during protection and removes protection on attack', () => {
    const simulation = active();
    const [actor, target] = simulation.state.actors;
    target!.position.x = 420;
    simulation.step(0.1, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    expect(target!.impulse.x).toBe(0);
    expect(actor!.protectionRemaining).toBe(0);
  });
});

describe('life and match resolution', () => {
  it('treats simultaneous final ringouts as a draw independent of iteration order', () => {
    for (const reverse of [false, true]) {
      const simulation = active({ stocks: 1 });
      if (reverse) simulation.state.actors.reverse();
      for (const actor of simulation.state.actors) actor.position.y = 1000;
      tick(simulation, 1);
      expect(simulation.state.phase).toBe('finished');
      expect(simulation.state.result?.winner).toBeNull();
      expect(simulation.state.actors.map((actor) => actor.stocks)).toEqual([0, 0]);
      tick(simulation, 20);
      expect(simulation.state.actors.every((actor) => actor.stats.falls === 1)).toBe(true);
    }
  });

  it('does not eliminate an actor merely because they are waiting to respawn', () => {
    const simulation = active();
    simulation.state.actors[1]!.position.y = 1000;
    tick(simulation, 1);
    expect(simulation.state.actors[1]!.status).toBe('respawning');
    expect(simulation.state.phase).toBe('playing');
    tick(simulation, 61);
    expect(simulation.state.actors[1]!.status).toBe('alive');
    expect(simulation.state.actors[1]!.protectionRemaining).toBeGreaterThan(1);
  });

  it('can award victory to a remaining participant who is respawning', () => {
    const simulation = active({ stocks: 1 });
    simulation.state.actors[0]!.status = 'respawning';
    simulation.state.actors[0]!.respawnRemaining = 0.8;
    simulation.state.actors[1]!.position.y = 1000;
    tick(simulation, 1);
    expect(simulation.state.result?.winner).toBe('p1');
  });

  it('processes final-frame ringouts before comparing stocks at timeout', () => {
    const simulation = active();
    simulation.state.remaining = FIXED_STEP;
    simulation.state.actors[1]!.position.y = 1000;
    tick(simulation, 1);
    expect(simulation.state.result?.winner).toBe('p1');
    expect(simulation.state.overtime).toBe(false);
  });

  it('starts one-stock overtime for tied leaders, then draws if it times out', () => {
    const simulation = active();
    simulation.state.remaining = FIXED_STEP;
    tick(simulation, 1);
    expect(simulation.state.overtime).toBe(true);
    expect(simulation.state.phase).toBe('countdown');
    expect(simulation.state.actors.map((actor) => actor.stocks)).toEqual([1, 1]);
    tick(simulation, 1);
    simulation.state.remaining = FIXED_STEP;
    tick(simulation, 1);
    expect(simulation.state.phase).toBe('finished');
    expect(simulation.state.result?.winner).toBeNull();
  });

  it('freezes all state during pause and requires a resume countdown', () => {
    const simulation = active();
    tick(simulation, 1, { ...idleInput(), shootHeld: true });
    simulation.pause();
    const snapshot = JSON.stringify(simulation.state);
    tick(simulation, 240);
    expect(JSON.stringify(simulation.state)).toBe(snapshot);
    simulation.resume();
    expect(simulation.state.phase).toBe('countdown');
    expect(simulation.state.countdownRemaining).toBe(3);
    const time = simulation.state.remaining;
    tick(simulation, 120);
    expect(simulation.state.remaining).toBe(time);
  });

  it('uses only valid opponent hits within five seconds for knockout credit', () => {
    const simulation = active();
    const target = simulation.state.actors[1]!;
    target.lastHit = { by: 'p1', at: simulation.state.elapsed };
    target.position.y = 1000;
    tick(simulation, 1);
    expect(simulation.state.actors[0]!.stats.knockouts).toBe(1);
    expect(target.stats.selfFalls).toBe(0);
    tick(simulation, 61);
    target.lastHit = { by: 'p1', at: simulation.state.elapsed - 6 };
    target.position.y = 1000;
    tick(simulation, 1);
    expect(target.stats.selfFalls).toBe(1);
    expect(simulation.state.actors[0]!.stats.knockouts).toBe(1);
  });

  it('keeps practice unlimited and excludes falls from formal match statistics', () => {
    const simulation = active({}, 'training');
    simulation.state.actors[0]!.position.y = 1000;
    simulation.state.remaining = 0;
    tick(simulation, 32);
    expect(simulation.state.actors[0]!.stocks).toBe(3);
    expect(simulation.state.actors[0]!.status).toBe('alive');
    expect(simulation.state.actors[0]!.stats.falls).toBe(0);
    expect(simulation.state.result).toBeNull();
  });
});

describe('fixed-step integration', () => {
  it.each([1, 42, 1234])('lets a player chase and shoot the recovering AI out of the arena (seed %i)', (seed) => {
    const runner = new MatchRunner({ ...createMatchConfig('duel-ai', seed), countdown: 0 });
    let hits = 0;
    for (let frame = 0; frame < 60 * 10 && runner.state.actors[0]!.stats.knockouts === 0; frame++) {
      const events = runner.advance(1000 / 60, () => {
        const [player, bot] = runner.state.actors;
        const dx = bot!.position.x - player!.position.x;
        const direction = dx > 0 ? 1 : -1;
        return {
          ...idleInput(), shootHeld: true,
          moveX: Math.abs(dx) > 330 || player!.facing !== direction ? direction : 0,
        };
      });
      hits += events.filter((event) => event.type === 'hit' && event.actorId === 'bot').length;
    }
    expect(hits).toBeGreaterThan(1);
    expect(hits).toBeLessThanOrEqual(16);
    expect(runner.state.actors[0]!.stats.knockouts).toBeGreaterThan(0);
    expect(runner.state.actors[1]!.stocks).toBeLessThan(3);
  });

  it('lets the AI complete a real match through ordinary input and knockout rules', () => {
    const runner = new MatchRunner({ ...createMatchConfig('duel-ai', 42), countdown: 0 });
    let shots = 0;
    for (let frame = 0; frame < 60 * 215 && runner.state.phase !== 'finished'; frame++) {
      const events = runner.advance(1000 / 60, idleInput);
      shots += events.filter((event) => event.type === 'shot' && event.actorId === 'bot').length;
    }
    expect(shots).toBeGreaterThan(0);
    expect(runner.state.phase).toBe('finished');
    expect(runner.state.result?.winner).toBe('bot');
    expect(runner.state.actors[1]!.stats.knockouts).toBeGreaterThan(0);
  });

  it('produces the same battle state at 30 and 60 rendering frames per second', () => {
    const config = { ...createMatchConfig('local-duel', 42), countdown: 0 };
    const at30 = new MatchRunner(config);
    const at60 = new MatchRunner(config);
    const read = (slot: 1 | 2): ActorInput => ({ ...idleInput(), moveX: slot === 1 ? 1 : 0 });
    for (let frame = 0; frame < 60; frame++) at30.advance(1000 / 30, read);
    for (let frame = 0; frame < 120; frame++) at60.advance(1000 / 60, read);
    expect(at30.state.actors[0]!.position.x).toBeCloseTo(at60.state.actors[0]!.position.x, 8);
    expect(at30.state.remaining).toBeCloseTo(at60.state.remaining, 8);
  });

  it('bounds catch-up after a stalled tab instead of simulating a huge time jump', () => {
    const clock = new FixedStepLoop();
    let updates = 0;
    clock.advance(30_000, () => updates++);
    expect(updates).toBe(5);
    clock.reset();
    clock.advance(Number.NaN, () => updates++);
    expect(updates).toBe(5);
  });
});

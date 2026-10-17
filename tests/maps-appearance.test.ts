import { describe, expect, it } from 'vitest';
import { presetAppearance } from '../src/content/appearances';
import { ARENAS } from '../src/content/maps';
import { createMatchConfig } from '../src/content/matches';
import { createActor } from '../src/game/core/actors';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { MatchRunner } from '../src/game/core/MatchRunner';
import { idleInput } from '../src/game/core/types';
import type { ActorState } from '../src/game/core/types';
import { moveActor } from '../src/game/systems/MovementSystem';

describe('playable themed maps', () => {
  it.each(ARENAS)('$name has safe spawns and every platform can be reached with legal jumps', (map) => {
    const reached = new Map<string, ActorState>();
    const queue: ActorState[] = [];
    for (const spawn of map.spawns) {
      const actor = createActor({ id: 'test', name: 'test', color: 0xffffff, control: 'dummy' }, spawn, 3, 640);
      for (let frame = 0; frame < 120; frame++) moveActor(actor, idleInput(), map, FIXED_STEP);
      expect(actor.groundedOn, `unsafe spawn ${spawn.x},${spawn.y}`).not.toBeNull();
      expect(actor.position).toEqual(spawn);
      reached.set(actor.groundedOn!, actor);
      queue.push(actor);
    }
    // Explore actual movement results from known landings; no teleports or extra jumps.
    while (queue.length) {
      const start = queue.shift()!;
      for (const target of map.platforms) {
        if (reached.has(target.id)) continue;
        for (const action of ['walk', 'drop', -1, 14, 23] as const) {
          const actor = structuredClone(start);
          let leftGround = false;
          for (let frame = 0; frame < 130; frame++) {
            const dx = target.x + target.width / 2 - actor.position.x;
            moveActor(actor, { ...idleInput(), moveX: Math.abs(dx) > 8 ? dx > 0 ? 1 : -1 : 0, jumpPressed: typeof action === 'number' && (frame === 0 || frame === action), dropPressed: action === 'drop' && frame === 0 }, map, FIXED_STEP);
            if (actor.groundedOn === null) leftGround = true;
            if (leftGround && frame > 2 && actor.groundedOn !== null) {
              if (!reached.has(actor.groundedOn)) { reached.set(actor.groundedOn, structuredClone(actor)); queue.push(structuredClone(actor)); }
              break;
            }
          }
        }
      }
    }
    expect([...reached.keys()].sort()).toEqual(map.platforms.map((platform) => platform.id).sort());
  });

  it.each(ARENAS)('$name respawns on its own platforms and keeps the chosen appearance', (map) => {
    const looks = { 1: presetAppearance('operative'), 2: presetAppearance('knight') };
    const config = createMatchConfig('local-duel', 123, { mapId: map.id, appearances: looks });
    const simulation = new BattleSimulation({ ...config, countdown: 0 });
    for (let i = 0; i < 5; i++) simulation.step(FIXED_STEP, new Map());
    const actor = simulation.state.actors[0]!;
    actor.position.x = map.bounds.right + 100;
    for (let i = 0; i < 90; i++) simulation.step(FIXED_STEP, new Map());
    expect(actor.stocks).toBe(2);
    expect(actor.status).toBe('alive');
    expect(map.platforms.some((platform) => platform.id === actor.groundedOn)).toBe(true);
    expect(actor.config.appearance).toEqual(looks[1]);
    expect(actor.config.appearance).not.toBe(looks[1]);
  });

  it('mixed clothes change neither movement nor combat outcomes', () => {
    const plain = createMatchConfig('local-duel', 45);
    const styled = createMatchConfig('local-duel', 45, { appearances: { 1: { ...presetAppearance('knight'), hat: 'space' }, 2: presetAppearance('ronin') } });
    const simulations = [plain, styled].map((config) => new BattleSimulation({ ...config, countdown: 0 }));
    for (let frame = 0; frame < 300; frame++) {
      const inputs = new Map([['p1', { ...idleInput(), moveX: 1 as const, jumpPressed: frame === 30, shootHeld: true }]]);
      for (const sim of simulations) sim.step(FIXED_STEP, inputs);
    }
    const outcomes = simulations.map((sim) => sim.state.actors.map(({ position, impulse, stocks, stats }) => ({ position, impulse, stocks, stats })));
    expect(outcomes[0]).toEqual(outcomes[1]);
  });

  it('the bot can legally jump back from the starship lower bridge', () => {
    const runner = new MatchRunner({ ...createMatchConfig('duel-ai', 123, { mapId: 'alien-starship' }), countdown: 0 });
    for (let i = 0; i < 5; i++) runner.advance(1000 / 60, idleInput);
    const bot = runner.state.actors[1]!;
    bot.position = { x: 640, y: 675 }; bot.previous = { ...bot.position }; bot.groundedOn = 'lower-airlock';
    bot.jumpsRemaining = 2; bot.verticalVelocity = 0;
    let returned = false;
    for (let i = 0; i < 180; i++) {
      runner.advance(1000 / 60, idleInput);
      if (bot.groundedOn && bot.groundedOn !== 'lower-airlock' && bot.position.y <= 610) returned = true;
    }
    expect(returned).toBe(true);
    expect(bot.stocks).toBe(3);
  });
});

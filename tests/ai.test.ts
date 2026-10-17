import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BotController } from '../src/game/ai/BotController';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import type { ActorState, MapDefinition, WeaponDrop } from '../src/game/core/types';

function arena(): MapDefinition {
  return {
    id: 'ai-test', name: 'AI 测试台', width: 1200, height: 600,
    spawns: [{ x: 100, y: 500 }, { x: 1100, y: 500 }],
    bounds: { left: -100, right: 1300, top: -100, bottom: 600 },
    platforms: [{ id: 'floor', x: 0, y: 500, width: 1200, height: 80, kind: 'solid' }],
  };
}

function setup(): { simulation: BattleSimulation; bot: ActorState } {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map: arena(), countdown: 0 });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  const bot = simulation.state.actors[1]!;
  bot.position = { x: 400, y: 500 };
  bot.facing = 1;
  bot.groundedOn = 'floor';
  bot.bombsRemaining = 2;
  bot.bombCooldown = 0;
  simulation.drainEvents();
  return { simulation, bot };
}

function crate(): WeaponDrop {
  return { id: 7, weaponId: 'rifle', position: { x: 700, y: 500 }, state: 'active', timer: 10, warning: false };
}

describe('T05 bot weapon / bomb / crate decisions', () => {
  it('throws a bomb at a close target and does not hold the edge down', () => {
    const { simulation, bot } = setup();
    const target = simulation.state.actors[0]!;
    target.position = { x: 550, y: 500 };
    const controller = new BotController('hard', 3);
    let threw = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (controller.sample(bot, simulation.state, 0.25).bombPressed) threw = true;
    }
    expect(threw).toBe(true);
    expect(controller.sample(bot, simulation.state, 0.01).bombPressed).toBe(false);
  });

  it('routes to a nearby crate before chasing a distant target', () => {
    const { simulation, bot } = setup();
    simulation.state.actors[0]!.position = { x: 100, y: 500 };
    simulation.state.drops.push(crate());
    const input = new BotController('hard', 4).sample(bot, simulation.state, 0.25);
    expect(input.moveX).toBe(1);
    expect(input.shootHeld).toBe(false);
  });

  it('moves and jumps away from a nearly exploding bomb', () => {
    const { simulation, bot } = setup();
    simulation.state.actors[0]!.position = { x: 1000, y: 500 };
    simulation.state.bombs.push({
      id: 1, owner: 'p1', position: { x: 455, y: 500 }, previous: { x: 455, y: 500 },
      velocity: { x: 0, y: 0 }, fuseRemaining: 0.5, radius: 150,
    });
    const input = new BotController('hard', 5).sample(bot, simulation.state, 0.25);
    expect(input.moveX).toBe(-1);
    expect(input.jumpPressed).toBe(true);
    expect(input.shootHeld).toBe(false);
  });
});

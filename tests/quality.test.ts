import { describe, expect, it } from 'vitest';
import { cloneCustomMatch, createCustomMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';

function fourPlayer(overrides: Partial<ReturnType<typeof cloneCustomMatch>> = {}) {
  const settings = cloneCustomMatch();
  settings.slots = [
    { kind: 'human', inputSlot: 1 },
    { kind: 'human', inputSlot: 2 },
    { kind: 'bot', difficulty: 'easy' },
    { kind: 'bot', difficulty: 'hard' },
  ];
  settings.stocks = 1;
  settings.duration = 30;
  Object.assign(settings, overrides);
  const simulation = new BattleSimulation({ ...createCustomMatchConfig(settings, 11, { matchId: 'four-player' }), countdown: 0 });
  simulation.step(FIXED_STEP, new Map([['p1', idleInput()], ['p2', idleInput()]]));
  simulation.step(FIXED_STEP, new Map([['p1', idleInput()], ['p2', idleInput()]]));
  return simulation;
}

const inputs = (): Map<string, ReturnType<typeof idleInput>> => new Map([['p1', idleInput()], ['p2', idleInput()]]);

describe('T11 four-player match regression', () => {
  it('eliminates a ringed-out actor and resolves the last survivor', () => {
    const simulation = fourPlayer();
    const [, p2, bot1, bot2] = simulation.state.actors;
    p2!.position = { x: simulation.state.config.map.bounds.right + 80, y: 300 };
    p2!.previous = { ...p2!.position };
    simulation.step(FIXED_STEP, inputs());
    expect(p2!.status).toBe('eliminated');
    expect(p2!.stocks).toBe(0);
    bot1!.stocks = 0;
    bot2!.stocks = 0;
    simulation.step(FIXED_STEP, inputs());
    expect(simulation.state.phase).toBe('finished');
    expect(simulation.state.result?.actors).toHaveLength(4);
    expect(simulation.state.result?.winner).toBe('p1');
  });

  it('enters overtime with multiple survivors and finishes with a sole survivor', () => {
    const simulation = fourPlayer();
    simulation.state.remaining = 0;
    simulation.step(FIXED_STEP, inputs());
    expect(simulation.state.overtime).toBe(true);
    const [, , bot1, bot2] = simulation.state.actors;
    bot1!.stocks = 0;
    bot2!.stocks = 0;
    const p2 = simulation.state.actors[1]!;
    p2.stocks = 0;
    simulation.step(FIXED_STEP, inputs());
    simulation.step(FIXED_STEP, inputs());
    expect(simulation.state.result?.winner).toBe('p1');
    expect(simulation.state.result?.overtime).toBe(true);
  });

  it('runs twenty four-player simulations without runaway cost', () => {
    const started = performance.now();
    for (let match = 0; match < 20; match++) {
      const simulation = fourPlayer();
      for (let frame = 0; frame < 120; frame++) simulation.step(FIXED_STEP, inputs());
    }
    const elapsed = performance.now() - started;
    // This is a JS-only guard, not a GPU / frame-time acceptance result.
    expect(elapsed).toBeLessThan(5000);
  });

  it('keeps four actor slots and independent identities across a restart', () => {
    const first = fourPlayer();
    expect(first.state.actors.map((actor) => actor.config.id)).toEqual(['p1', 'p2', 'bot-1', 'bot-2']);
    const second = fourPlayer();
    expect(second.state.actors.map((actor) => actor.config.id)).toEqual(['p1', 'p2', 'bot-1', 'bot-2']);
    expect(second.state.elapsed).toBeLessThan(0.2);
    expect(second.state.result).toBeNull();
  });
});

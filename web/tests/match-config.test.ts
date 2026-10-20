import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_MATCH, cloneCustomMatch, createCustomMatchConfig, normalizeCustomMatch, validateCustomMatch,
} from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { idleInput } from '../src/game/core/types';

describe('T07 custom match configuration', () => {
  it('builds a valid default two-player custom match', () => {
    const config = createCustomMatchConfig(DEFAULT_CUSTOM_MATCH, 42);
    expect(config.mode).toBe('custom');
    expect(config.actors).toHaveLength(2);
    expect(config.actors[0]).toMatchObject({ id: 'p1', control: 'human', inputSlot: 1 });
    expect(config.actors[1]).toMatchObject({ id: 'bot-1', control: 'bot', difficulty: 'normal' });
    expect(config.map.id).toBe('sky-citadel');
    expect(config.stocks).toBe(3);
    expect(config.dropMode).toBe('all');
  });

  it('supports two humans and two AI with independent difficulties', () => {
    const settings = cloneCustomMatch();
    settings.slots = [
      { kind: 'human', inputSlot: 1 },
      { kind: 'human', inputSlot: 2 },
      { kind: 'bot', difficulty: 'easy' },
      { kind: 'bot', difficulty: 'hard' },
    ];
    const config = createCustomMatchConfig(settings, 7);
    expect(config.actors).toHaveLength(4);
    expect(config.actors.map((actor) => actor.id)).toEqual(['p1', 'p2', 'bot-1', 'bot-2']);
    expect(config.actors.filter((actor) => actor.control === 'human')).toHaveLength(2);
    expect(config.actors.filter((actor) => actor.control === 'bot').map((actor) => actor.control === 'bot' && actor.difficulty)).toEqual(['easy', 'hard']);

    const sim = new BattleSimulation(config);
    for (let i = 0; i < 80; i++) sim.step(0.05, new Map([['p1', idleInput()], ['p2', idleInput()]]));
    expect(sim.state.actors).toHaveLength(4);
    expect(sim.state.phase).toBe('playing');
  });

  it('rejects one player, five slots, duplicate humans and invalid rules', () => {
    const one = cloneCustomMatch();
    one.slots = [{ kind: 'human', inputSlot: 1 }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }];
    expect(validateCustomMatch(one).join(' ')).toMatch(/2—4/);

    const five = cloneCustomMatch();
    five.slots = [
      { kind: 'human', inputSlot: 1 }, { kind: 'bot', difficulty: 'normal' },
      { kind: 'bot', difficulty: 'normal' }, { kind: 'bot', difficulty: 'normal' },
      { kind: 'bot', difficulty: 'normal' },
    ];
    expect(validateCustomMatch(five).join(' ')).toMatch(/槽位数量/);

    const duplicate = cloneCustomMatch();
    duplicate.slots = [
      { kind: 'human', inputSlot: 1 }, { kind: 'human', inputSlot: 1 },
      { kind: 'empty' }, { kind: 'empty' },
    ];
    expect(validateCustomMatch(duplicate).join(' ')).toMatch(/输入槽位/);

    const invalid = { ...cloneCustomMatch(), mapId: 'missing', stocks: 0, duration: 5, dropMode: 'bad' as never };
    const errors = validateCustomMatch(invalid).join(' ');
    expect(errors).toMatch(/地图/);
    expect(errors).toMatch(/生命/);
    expect(errors).toMatch(/时限/);
    expect(errors).toMatch(/武器池/);
  });

  it('normalizes damaged saved settings and keeps a valid recency config', () => {
    expect(normalizeCustomMatch({ slots: [], stocks: -2, duration: 9999, mapId: 'bad' })).toEqual(DEFAULT_CUSTOM_MATCH);
    const valid = cloneCustomMatch();
    valid.mapId = 'neon-city';
    valid.stocks = 5;
    valid.duration = 60;
    valid.dropMode = 'none';
    valid.slots[1] = { kind: 'human', inputSlot: 2 };
    expect(normalizeCustomMatch(valid)).toEqual(valid);
  });

  it('keeps ultimate weapons out of the standard-only drop pool', () => {
    const settings = cloneCustomMatch();
    settings.dropMode = 'standard';
    const sim = new BattleSimulation(createCustomMatchConfig(settings, 11));
    const dropped: string[] = [];
    for (let i = 0; i < 700; i++) {
      sim.step(0.05, new Map([['p1', idleInput()]]));
      for (const event of sim.drainEvents()) if (event.type === 'drop-incoming') dropped.push(event.weaponId);
    }
    expect(dropped.length).toBeGreaterThan(0);
    expect(dropped).not.toContain('gatling');
    expect(dropped).not.toContain('cannon');
  });

  it('honors the no-drop custom rule at runtime', () => {
    const settings = cloneCustomMatch();
    settings.dropMode = 'none';
    const sim = new BattleSimulation(createCustomMatchConfig(settings, 9));
    for (let i = 0; i < 240; i++) sim.step(0.05, new Map([['p1', idleInput()]]));
    expect(sim.state.drops).toHaveLength(0);
  });
});

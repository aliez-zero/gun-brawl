import { describe, expect, it } from 'vitest';
import { ARENAS, ALIEN_STARSHIP, NEON_CITY, SKY_CITADEL, TRAINING_ARENA } from '../src/content/maps';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { MatchRunner } from '../src/game/core/MatchRunner';
import { idleInput } from '../src/game/core/types';
import type { ActorState, MapDefinition, Platform } from '../src/game/core/types';
import { moveActor } from '../src/game/systems/MovementSystem';

const moveToward = (x: number, target: number): -1 | 0 | 1 => Math.abs(target - x) < 5 ? 0 : target > x ? 1 : -1;
const launchActions = ['walk', 'drop', -1, 14, 23, 32] as const;

function atSpawn(map: MapDefinition, spawnIndex: number): ActorState {
  const config = createMatchConfig('local-duel', 531, { mapId: map.id });
  // Initialize through the real match factory, including future actor/weapon state.
  const spawns = [...map.spawns.slice(spawnIndex), ...map.spawns.slice(0, spawnIndex)];
  const simulation = new BattleSimulation({ ...config, map: { ...map, spawns }, countdown: 0 });
  const actor = simulation.state.actors[0]!;
  for (let frame = 0; frame < 90; frame++) moveActor(actor, idleInput(), map, FIXED_STEP);
  expect(actor.position, `spawn ${spawnIndex} must settle at its declared location`).toEqual(spawns[0]);
  expect(actor.groundedOn, `spawn ${spawnIndex} needs a supporting platform`).not.toBeNull();
  return actor;
}

function onStage(actor: ActorState, map: MapDefinition): boolean {
  // A route cannot rely on passing a ringout boundary and re-entering later.
  const { left, right, top, bottom } = map.bounds;
  return actor.position.x >= left && actor.position.x <= right && actor.position.y >= top && actor.position.y <= bottom;
}

function walkTo(start: ActorState, x: number, platform: Platform, map: MapDefinition): ActorState | null {
  const actor = structuredClone(start);
  for (let frame = 0; frame < 260; frame++) {
    const moveX = moveToward(actor.position.x, x);
    if (moveX === 0 && Math.abs(actor.moveVelocity) < 1) return actor;
    moveActor(actor, { ...idleInput(), moveX }, map, FIXED_STEP);
    if (actor.groundedOn !== platform.id || !onStage(actor, map)) return null;
  }
  return null;
}

function firstLanding(start: ActorState, aim: number, action: typeof launchActions[number], map: MapDefinition): ActorState | null {
  const actor = structuredClone(start);
  let departed = false;
  for (let frame = 0; frame < 160; frame++) {
    moveActor(actor, {
      ...idleInput(), moveX: moveToward(actor.position.x, aim),
      jumpPressed: typeof action === 'number' && (frame === 0 || frame === action),
      dropPressed: action === 'drop' && frame === 0,
    }, map, FIXED_STEP);
    if (!onStage(actor, map)) return null;
    departed ||= actor.groundedOn === null;
    if (departed && actor.groundedOn !== null) return actor;
  }
  return null;
}

/**
 * Explore actual legal landings from one starting actor. Every takeoff position is
 * reached by walking on its platform first; no coordinates/jump counts are reset.
 * Keeping one landing per flat platform is enough because walkTo reaches its
 * left/center/right takeoff points from that landing using the same collision code.
 */
function explore(start: ActorState, map: MapDefinition): Map<string, ActorState> {
  const reached = new Map([[start.groundedOn!, structuredClone(start)]]);
  const queue = [start];
  while (queue.length) {
    const landing = queue.shift()!;
    const platform = map.platforms.find(({ id }) => id === landing.groundedOn)!;
    const takeoffs = [landing, ...[0.1, 0.5, 0.9].map((ratio) => walkTo(landing, platform.x + platform.width * ratio, platform, map)).filter((actor): actor is ActorState => actor !== null)];
    for (const target of map.platforms) {
      if (reached.has(target.id)) continue;
      let found = false;
      for (const takeoff of takeoffs) {
        for (const ratio of [0.5, 0.15, 0.85]) {
          for (const action of launchActions) {
            const result = firstLanding(takeoff, target.x + target.width * ratio, action, map);
            if (result && !reached.has(result.groundedOn!)) {
              reached.set(result.groundedOn!, result);
              queue.push(result);
            }
            if (reached.has(target.id)) { found = true; break; }
          }
          if (found) break;
        }
        if (found) break;
      }
    }
  }
  return reached;
}

function missingPlatforms(reached: Map<string, ActorState>, map: MapDefinition): string[] {
  return map.platforms.map(({ id }) => id).filter((id) => !reached.has(id));
}

describe('arena routes from both sides', () => {
  for (const map of ARENAS) {
    it.each(map.spawns.map((spawn, index) => ({ index, ...spawn })))(`${map.name}: spawn $index ($x, $y) can reach every combat zone`, ({ index }) => {
      const reached = explore(atSpawn(map, index), map);
      expect(missingPlatforms(reached, map), 'each spawn must work independently; a route from another spawn cannot mask an isolated side').toEqual([]);
    });
  }

  it('the starship lower airlock is a return route, not a one-way trap', () => {
    const map = ALIEN_STARSHIP;
    const fromPort = explore(atSpawn(map, 0), map);
    const lower = fromPort.get('lower-airlock');
    expect(lower, 'the lower safety route must itself be reachable with normal movement').toBeDefined();
    const recovered = explore(lower!, map);
    expect(missingPlatforms(recovered, map), 'legal jumps from the airlock must reconnect to both docks and the upper arena').toEqual([]);
  });

  it('inner overruns are caught below while active jumps take distinct themed routes', () => {
    const training = atSpawn(TRAINING_ARENA, 0);
    const trainingFloor = TRAINING_ARENA.platforms.find(({ id }) => id === training.groundedOn)!;
    expect(walkTo(training, TRAINING_ARENA.width / 2, trainingFloor, TRAINING_ARENA)?.groundedOn).toBe('main');

    const citadel = atSpawn(SKY_CITADEL, 0);
    expect(firstLanding(citadel, SKY_CITADEL.width / 2, 'walk', SKY_CITADEL)?.groundedOn).toBe('citadel-court');
    expect(firstLanding(citadel, SKY_CITADEL.width / 2, -1, SKY_CITADEL)?.groundedOn).toBe('west-wall');

    const city = atSpawn(NEON_CITY, 0);
    expect(firstLanding(city, NEON_CITY.width / 2, 'walk', NEON_CITY)?.groundedOn).toBe('service-bypass');
    const doubleJumps = launchActions.filter((action): action is 14 | 23 | 32 => typeof action === 'number' && action > 0);
    expect(doubleJumps.some((action) => firstLanding(city, NEON_CITY.width / 2, action, NEON_CITY)?.groundedOn === 'market-rooftop')).toBe(true);

    const ship = atSpawn(ALIEN_STARSHIP, 0);
    expect(firstLanding(ship, ALIEN_STARSHIP.width / 2, 'walk', ALIEN_STARSHIP)?.groundedOn).toBe('lower-airlock');
    expect(firstLanding(ship, ALIEN_STARSHIP.width / 2, -1, ALIEN_STARSHIP)?.groundedOn).toBe('reactor');
  });

  const recoveryScenarios = [0, 1].flatMap((targetSide) => [0.15, 0.5, 0.85].map((airlockRatio) => ({ targetSide, airlockRatio })));
  it.each(recoveryScenarios)('the bot recovers from airlock position $airlockRatio with the opponent on side $targetSide', ({ targetSide, airlockRatio }) => {
    const map = ALIEN_STARSHIP;
    const lower = map.platforms.find(({ id }) => id === 'lower-airlock')!;
    const config = createMatchConfig('duel-ai', 123, { mapId: map.id });
    const spawns = [map.spawns[targetSide]!, { x: lower.x + lower.width * airlockRatio, y: lower.y }];
    const runner = new MatchRunner({ ...config, map: { ...map, spawns }, countdown: 0 });
    const bot = runner.state.actors[1]!;
    let returnedToCombatZone = false;
    for (let frame = 0; frame < 240; frame++) {
      runner.advance(1000 / 60, idleInput);
      if (bot.groundedOn && bot.groundedOn !== lower.id && bot.position.y < lower.y) returnedToCombatZone = true;
    }
    expect(returnedToCombatZone).toBe(true);
    expect(bot.stocks, 'normal AI input must recover without sacrificing a stock').toBe(3);
  });
});

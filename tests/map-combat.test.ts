import { describe, expect, it } from 'vitest';
import { ALIEN_STARSHIP, NEON_CITY, SKY_CITADEL } from '../src/content/maps';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { ACTOR_WIDTH, FIXED_STEP, MOVEMENT } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { ActorInput, BattleEvent, MapDefinition } from '../src/game/core/types';

interface EdgeScenario {
  name: string;
  map: MapDefinition;
  platformId: string;
  direction: -1 | 1;
}

const scenarios: EdgeScenario[] = [
  { name: 'citadel west bastion, toward the inner chasm', map: SKY_CITADEL, platformId: 'west-bastion', direction: 1 },
  { name: 'citadel east bastion, toward the inner chasm', map: SKY_CITADEL, platformId: 'east-bastion', direction: -1 },
  { name: 'city west rooftop, toward the street gap', map: NEON_CITY, platformId: 'west-rooftop', direction: 1 },
  { name: 'city market rooftop, toward the street gap', map: NEON_CITY, platformId: 'market-rooftop', direction: -1 },
  { name: 'starship port dock, toward the inner void', map: ALIEN_STARSHIP, platformId: 'port-deck', direction: 1 },
  { name: 'starship starboard dock, toward the inner void', map: ALIEN_STARSHIP, platformId: 'starboard-deck', direction: -1 },
];

function runEdgeFight(scenario: EdgeScenario, sustained: boolean) {
  const { map, direction } = scenario;
  const platform = map.platforms.find(({ id }) => id === scenario.platformId)!;
  const edge = direction === 1 ? platform.x + platform.width : platform.x;
  const targetX = edge - direction * 70;
  const shooterX = targetX - direction * Math.min(150, platform.width - 105);
  const config = createMatchConfig('local-duel', 731, { mapId: map.id });
  // Both actors start at genuine supported combat positions on the existing map.
  // Only the initial positions change; all platforms, bullets, impulses and stocks
  // use the real match systems and the unchanged default pistol.
  const spawns = [{ x: shooterX, y: platform.y }, { x: targetX, y: platform.y }];
  const simulation = new BattleSimulation({ ...config, map: { ...map, spawns }, countdown: 0 });
  for (let frame = 0; frame < 2; frame++) simulation.step(FIXED_STEP, new Map());
  const [shooter, target] = simulation.state.actors;
  expect(shooter!.groundedOn).toBe(platform.id);
  expect(target!.groundedOn).toBe(platform.id);
  shooter!.facing = direction;
  target!.protectionRemaining = 0;
  target!.moveVelocity = -direction * MOVEMENT.speed;
  simulation.drainEvents();

  let hits = 0;
  let frames = 0;
  let crossedInnerEdge = false;
  let ringout: Extract<BattleEvent, { type: 'ringout' }> | undefined;
  for (; frames < 240 && target!.stocks === 3; frames++) {
    // During sustained fire the defender holds the inward direction on EVERY
    // frame, including while falling: no timed pause or mid-platform braking.
    // For the isolated-shot check, stop 40 px from the far edge after recovering
    // so a later unrelated walk off that opposite edge cannot count as a failure.
    const interior = direction === 1 ? platform.x + 40 : platform.x + platform.width - 40;
    const moveX: -1 | 0 | 1 = sustained || direction * (target!.position.x - interior) > 8 ? direction === 1 ? -1 : 1 : 0;
    const input = new Map<string, ActorInput>([
      ['p1', { ...idleInput(), shootHeld: sustained || frames === 0 }],
      ['p2', { ...idleInput(), moveX }],
    ]);
    simulation.step(FIXED_STEP, input);
    if (direction * (target!.position.x - edge) > ACTOR_WIDTH / 2 && target!.position.y > platform.y) crossedInnerEdge = true;
    for (const event of simulation.drainEvents()) {
      if (event.type === 'hit' && event.actorId === target!.config.id) hits++;
      if (event.type === 'ringout' && event.actorId === target!.config.id) ringout = event;
    }
  }
  return { simulation, target: target!, platform, edge, frames, hits, crossedInnerEdge, ringout };
}

describe('inner gaps create real pistol knockout opportunities', () => {
  it.each(scenarios)('$name: sustained hits beat an inward recovery run within four seconds', (scenario) => {
    const result = runEdgeFight(scenario, true);
    const diagnostic = { hits: result.hits, seconds: result.frames * FIXED_STEP, position: result.target.position, support: result.target.groundedOn };
    expect(result.hits, JSON.stringify(diagnostic)).toBeGreaterThan(1);
    expect(result.hits, JSON.stringify(diagnostic)).toBeLessThanOrEqual(8);
    expect(result.crossedInnerEdge, JSON.stringify(diagnostic)).toBe(true);
    expect(result.target.stocks, JSON.stringify(diagnostic)).toBe(2);
    // Stop on the first real stock loss; respawning elsewhere cannot hide a miss.
    expect(result.target.status).toBe('respawning');
    expect(result.ringout?.creditedTo).toBe('p1');
    expect(scenario.direction * (result.ringout!.position.x - result.edge), 'the knockout must occur beyond the attacked inner edge, not the far outer edge').toBeGreaterThan(ACTOR_WIDTH / 2);
    expect(result.ringout!.position.y).toBeGreaterThan(scenario.map.bounds.bottom);
    expect(result.ringout!.position.x).toBeGreaterThan(scenario.map.bounds.left);
    expect(result.ringout!.position.x).toBeLessThan(scenario.map.bounds.right);
    expect(result.frames * FIXED_STEP).toBeLessThanOrEqual(4);
  });

  it.each(scenarios)('$name: one isolated hit still allows normal movement to recover', (scenario) => {
    const result = runEdgeFight(scenario, false);
    expect(result.hits).toBe(1);
    expect(result.target.stocks).toBe(3);
    expect(result.ringout).toBeUndefined();
    expect(result.target.status).toBe('alive');
    expect(result.target.groundedOn).toBe(result.platform.id);
    expect(result.target.position.x).toBeGreaterThan(result.platform.x);
    expect(result.target.position.x).toBeLessThan(result.platform.x + result.platform.width);
  });

  it.each([SKY_CITADEL, NEON_CITY, ALIEN_STARSHIP])('$name: walking toward the center without jumping can now miss the narrow safety route', (map) => {
    const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 317, { mapId: map.id }), countdown: 0 });
    const actor = simulation.state.actors[0]!;
    let ringout: Extract<BattleEvent, { type: 'ringout' }> | undefined;
    for (let frame = 0; frame < 240 && actor.stocks === 3; frame++) {
      const moveX = actor.position.x < map.width / 2 ? 1 as const : 0 as const;
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), moveX }]]));
      ringout ??= simulation.drainEvents().find((event): event is Extract<BattleEvent, { type: 'ringout' }> => event.type === 'ringout' && event.actorId === actor.config.id);
    }
    expect(actor.stocks).toBe(2);
    expect(actor.status).toBe('respawning');
    expect(ringout?.creditedTo).toBeNull();
    expect(ringout!.position.y).toBeGreaterThan(map.bounds.bottom);
    expect(ringout!.position.x).toBeGreaterThan(0);
    expect(ringout!.position.x).toBeLessThan(map.width / 2);
  });
});

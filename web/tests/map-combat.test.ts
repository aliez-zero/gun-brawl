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
  { name: 'citadel west outer cliff', map: SKY_CITADEL, platformId: 'west-bastion', direction: -1 },
  { name: 'citadel east outer cliff', map: SKY_CITADEL, platformId: 'east-bastion', direction: 1 },
  { name: 'city west outer rooftop', map: NEON_CITY, platformId: 'west-rooftop', direction: -1 },
  { name: 'city east outer duct', map: NEON_CITY, platformId: 'east-duct', direction: 1 },
  { name: 'starship port outer dock', map: ALIEN_STARSHIP, platformId: 'port-deck', direction: -1 },
  { name: 'starship starboard outer dock', map: ALIEN_STARSHIP, platformId: 'starboard-deck', direction: 1 },
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
  let crossedEdge = false;
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
    if (direction * (target!.position.x - edge) > ACTOR_WIDTH / 2 && target!.position.y > platform.y) crossedEdge = true;
    for (const event of simulation.drainEvents()) {
      if (event.type === 'hit' && event.actorId === target!.config.id) hits++;
      if (event.type === 'ringout' && event.actorId === target!.config.id) ringout = event;
    }
  }
  return { simulation, target: target!, platform, edge, frames, hits, crossedEdge, ringout };
}

describe('moderate maps retain real pistol knockouts at exposed outer edges', () => {
  it.each(scenarios)('$name: sustained hits beat an inward recovery run within four seconds', (scenario) => {
    const result = runEdgeFight(scenario, true);
    const diagnostic = { hits: result.hits, seconds: result.frames * FIXED_STEP, position: result.target.position, support: result.target.groundedOn };
    expect(result.hits, JSON.stringify(diagnostic)).toBeGreaterThan(1);
    expect(result.hits, JSON.stringify(diagnostic)).toBeLessThanOrEqual(8);
    expect(result.crossedEdge, JSON.stringify(diagnostic)).toBe(true);
    expect(result.target.stocks, JSON.stringify(diagnostic)).toBe(2);
    // Stop on the first real stock loss; respawning elsewhere cannot hide a miss.
    expect(result.target.status).toBe('respawning');
    expect(result.ringout?.creditedTo).toBe('p1');
    expect(scenario.direction * (result.ringout!.position.x - result.edge), 'the knockout must occur beyond the attacked edge').toBeGreaterThan(ACTOR_WIDTH / 2);
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

});

const recoveryScenarios = [
  { map: SKY_CITADEL, from: 'west-bastion', to: 'citadel-court', direction: 1 },
  { map: SKY_CITADEL, from: 'east-bastion', to: 'citadel-court', direction: -1 },
  { map: NEON_CITY, from: 'west-rooftop', to: 'service-bypass', direction: 1 },
  { map: NEON_CITY, from: 'east-duct', to: 'service-bypass', direction: -1 },
  { map: ALIEN_STARSHIP, from: 'port-deck', to: 'lower-airlock', direction: 1 },
  { map: ALIEN_STARSHIP, from: 'starboard-deck', to: 'lower-airlock', direction: -1 },
] as const;

describe('ordinary navigation mistakes have a recovery route', () => {
  it.each(recoveryScenarios)('$map.name: overrunning the inner edge of $from is caught by $to and a normal jump returns', ({ map, from, to, direction }) => {
    const platform = map.platforms.find(({ id }) => id === from)!;
    const edge = direction === 1 ? platform.x + platform.width : platform.x;
    const spawns = [{ x: edge - direction * 70, y: platform.y }, map.spawns[1]!];
    const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 317, { mapId: map.id }), map: { ...map, spawns }, countdown: 0 });
    const actor = simulation.state.actors[0]!;
    for (let frame = 0; frame < 2; frame++) simulation.step(FIXED_STEP, new Map());
    expect(actor.groundedOn).toBe(from);

    // Walk off without either jump. Keep moving through the fall, so simply
    // braking on the original platform cannot masquerade as a safe landing.
    for (let frame = 0; frame < 120 && actor.groundedOn !== to && actor.stocks === 3; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), moveX: direction }]]));
    }
    expect(actor.stocks).toBe(3);
    expect(actor.groundedOn).toBe(to);

    const returnX = platform.x + platform.width / 2;
    let returned = false;
    for (let frame = 0; frame < 180 && actor.stocks === 3; frame++) {
      const dx = returnX - actor.position.x;
      simulation.step(FIXED_STEP, new Map([['p1', {
        ...idleInput(), moveX: Math.abs(dx) < 8 ? 0 : dx > 0 ? 1 : -1,
        jumpPressed: frame === 0,
      }]]));
      returned ||= actor.groundedOn === from;
      if (returned && actor.groundedOn === from && Math.abs(dx) < 8 && Math.abs(actor.moveVelocity) < 1) break;
    }
    expect(returned, `a normal jump must reconnect the lower route: ${JSON.stringify({ position: actor.position, support: actor.groundedOn, stocks: actor.stocks })}`).toBe(true);
    expect(actor.groundedOn).toBe(from);
    expect(actor.stocks).toBe(3);
    expect(actor.status).toBe('alive');
  });

  it.each([
    { map: SKY_CITADEL, from: 'west-bastion', to: 'citadel-court', x: 380 },
    { map: NEON_CITY, from: 'market-rooftop', to: 'service-bypass', x: 610 },
    { map: ALIEN_STARSHIP, from: 'reactor', to: 'lower-airlock', x: 640 },
  ])('$map.name: dropping from $from lands on $to without losing a stock', ({ map, from, to, x }) => {
    const platform = map.platforms.find(({ id }) => id === from)!;
    const spawns = [{ x, y: platform.y }, map.spawns[1]!];
    const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 317, { mapId: map.id }), map: { ...map, spawns }, countdown: 0 });
    const actor = simulation.state.actors[0]!;
    for (let frame = 0; frame < 2; frame++) simulation.step(FIXED_STEP, new Map());
    expect(actor.groundedOn).toBe(from);
    for (let frame = 0; frame < 120; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), dropPressed: frame === 0 }]]));
    }
    expect(actor.groundedOn).toBe(to);
    expect(actor.stocks).toBe(3);
    expect(actor.status).toBe('alive');
  });
});

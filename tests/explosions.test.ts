import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { ACTOR_HEIGHT, BOMB, FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { Bomb, ExplosionRequest, MapDefinition, MatchConfig, Platform } from '../src/game/core/types';
import { applyExplosionHits, ExplosionSystem } from '../src/game/systems/ExplosionSystem';

function testMap(options: { floor?: Platform['kind']; wall?: Platform['kind'] | null } = {}): MapDefinition {
  const platforms: Platform[] = [
    { id: 'floor', x: 0, y: 500, width: 1000, height: 40, kind: options.floor ?? 'solid' },
  ];
  if (options.wall) platforms.push({ id: 'wall', x: 490, y: 400, width: 20, height: 100, kind: options.wall });
  return {
    id: 'test-map', name: '测试台', width: 1000, height: 700,
    spawns: [{ x: 200, y: 500 }, { x: 800, y: 500 }],
    bounds: { left: -100, right: 1100, top: -200, bottom: 700 },
    platforms,
  };
}

function active(map: MapDefinition = testMap(), overrides: Partial<MatchConfig> = {}): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0, ...overrides });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  simulation.drainEvents();
  for (const actor of simulation.state.actors) actor.protectionRemaining = 0;
  return simulation;
}

function pressBomb(simulation: BattleSimulation, actorId = 'p1'): void {
  simulation.step(FIXED_STEP, new Map([[actorId, { ...idleInput(), bombPressed: true }]]));
}

function idle(simulation: BattleSimulation, frames: number): void {
  for (let frame = 0; frame < frames; frame++) simulation.step(FIXED_STEP, new Map());
}

function addBomb(simulation: BattleSimulation, owner: string, x: number, y: number, fuse = 0.01): Bomb {
  const bomb: Bomb = {
    id: 1000 + simulation.state.bombs.length, owner,
    position: { x, y }, previous: { x, y }, velocity: { x: 0, y: 0 },
    fuseRemaining: fuse, radius: BOMB.bodyRadius,
  };
  simulation.state.bombs.push(bomb);
  return bomb;
}

const request = (overrides: Partial<ExplosionRequest> = {}): ExplosionRequest => ({
  ownerId: 'p1', source: 'bomb', center: { x: 500, y: 500 - ACTOR_HEIGHT / 2 },
  radius: 150, centerImpulse: 360, edgeImpulse: 90, ...overrides,
});

describe('T02 shared explosion resolver', () => {
  it('applies center-up, linear edge falloff, and skips protected actors', () => {
    const simulation = active();
    const [p1, p2] = simulation.state.actors;
    p1!.position = { x: 500, y: 500 };
    p2!.position = { x: 575, y: 500 };
    p1!.protectionRemaining = 0;
    p2!.protectionRemaining = 0;

    const resolver = new ExplosionSystem();
    const hits = resolver.resolve(simulation.state, request());
    const first = hits.find((hit) => hit.actorId === 'p1')!;
    const second = hits.find((hit) => hit.actorId === 'p2')!;
    expect(first.impulse.x).toBeCloseTo(0);
    expect(first.impulse.y).toBeCloseTo(-360);
    expect(second.impulse.x).toBeCloseTo(225);
    expect(second.impulse.y).toBeCloseTo(0);

    p2!.position = { x: 650, y: 500 };
    const edge = resolver.resolve(simulation.state, request()).find((hit) => hit.actorId === 'p2')!;
    expect(Math.hypot(edge.impulse.x, edge.impulse.y)).toBeCloseTo(90);

    p2!.position = { x: 651, y: 500 };
    expect(resolver.resolve(simulation.state, request()).some((hit) => hit.actorId === 'p2')).toBe(false);

    p2!.position = { x: 575, y: 500 };
    p2!.protectionRemaining = 0.5;
    const protectedHits = resolver.resolve(simulation.state, request());
    expect(protectedHits.some((hit) => hit.actorId === 'p2')).toBe(false);
  });

  it('blocks through solid terrain but not through one-way platforms', () => {
    for (const wall of ['solid', 'one-way'] as const) {
      const simulation = active(testMap({ wall }));
      const [p1, p2] = simulation.state.actors;
      p1!.position = { x: 100, y: 500 };
      p2!.position = { x: 550, y: 500 };
      p1!.protectionRemaining = 0;
      p2!.protectionRemaining = 0;
      const hits = new ExplosionSystem().resolve(simulation.state, request({ center: { x: 450, y: 474 } }));
      expect(hits.some((hit) => hit.actorId === 'p2')).toBe(wall === 'one-way');
    }
  });

  it('applies impulses and preserves self-attribution instead of overwriting an enemy hit', () => {
    const simulation = active();
    const [p1, p2] = simulation.state.actors;
    p1!.lastHit = { by: 'p2', at: 1.25 };
    p1!.protectionRemaining = 0;
    p2!.protectionRemaining = 0;
    const req = request();
    const events: Parameters<typeof applyExplosionHits>[3] = [];
    applyExplosionHits(simulation.state, req, [
      { actorId: 'p1', impulse: { x: -100, y: -50 } },
      { actorId: 'p2', impulse: { x: 120, y: 0 } },
    ], events);

    expect(p1!.impulse).toEqual({ x: -100, y: -50 });
    expect(p2!.impulse).toEqual({ x: 120, y: 0 });
    expect(p1!.lastHit).toEqual({ by: 'p2', at: 1.25 });
    expect(p2!.lastHit?.by).toBe('p1');
    expect(events.filter((event) => event.type === 'hit')).toHaveLength(2);
  });
});

describe('T02 bomb runtime', () => {
  it('throws one bomb, consumes one stock, clears protection and respects the cooldown', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    p1.protectionRemaining = 0.8;
    p1.facing = 1;
    pressBomb(simulation);
    const events = simulation.drainEvents();

    expect(simulation.state.bombs).toHaveLength(1);
    expect(p1.bombsRemaining).toBe(1);
    expect(p1.bombCooldown).toBeCloseTo(0.6);
    expect(p1.protectionRemaining).toBe(0);
    const bomb = simulation.state.bombs[0]!;
    const thrown = events.find((event) => event.type === 'bomb');
    expect(thrown?.type).toBe('bomb');
    if (thrown?.type === 'bomb') {
      expect(thrown.position.x).toBeCloseTo(p1.position.x + BOMB.throwOffsetX);
      expect(bomb.position.x).toBeCloseTo(thrown.position.x + BOMB.throwVelocityX * FIXED_STEP);
    }
    expect(bomb.velocity.x).toBe(BOMB.throwVelocityX);
    expect(bomb.velocity.y).toBeCloseTo(BOMB.throwVelocityY + BOMB.gravity * FIXED_STEP);
    expect(events.filter((event) => event.type === 'bomb')).toHaveLength(1);

    pressBomb(simulation);
    expect(simulation.state.bombs).toHaveLength(1);
    idle(simulation, 37);
    pressBomb(simulation);
    expect(simulation.state.bombs).toHaveLength(2);
    expect(p1.bombsRemaining).toBe(0);
  });

  it('denies more than two active bombs and reports an empty bomb event', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    p1.bombsRemaining = 3;
    pressBomb(simulation);
    // The 1.1 s fuse now expires before the 0.6 s cooldown allows a third throw,
    // so the two-bomb cap can only be exercised with frozen fuses.
    for (const bomb of simulation.state.bombs) bomb.fuseRemaining = 99;
    idle(simulation, 37);
    pressBomb(simulation);
    expect(simulation.state.bombs).toHaveLength(2);
    p1.bombsRemaining = 1;
    idle(simulation, 37);
    pressBomb(simulation);
    const events = simulation.drainEvents();
    expect(simulation.state.bombs).toHaveLength(2);
    expect(p1.bombsRemaining).toBe(1);
    expect(events.some((event) => event.type === 'bomb-empty')).toBe(true);
  });

  it('explodes about a second after the throw instead of two', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    p1.position = { x: 200, y: 500 };
    pressBomb(simulation);
    expect(simulation.state.bombs).toHaveLength(1);
    let frames = 0;
    while (simulation.state.bombs.length > 0 && frames < 240) {
      simulation.step(FIXED_STEP, new Map());
      frames++;
    }
    expect(BOMB.fuse).toBeLessThan(1.5);
    expect(frames / 60).toBeCloseTo(BOMB.fuse, 1);
  });

  it('knocks both players, with the thrower taking the same radial falloff', () => {
    const simulation = active();
    const [p1, p2] = simulation.state.actors;
    p1!.position = { x: 500, y: 500 };
    p2!.position = { x: 620, y: 500 };
    addBomb(simulation, 'p1', 500, 500 - ACTOR_HEIGHT / 2);
    simulation.step(FIXED_STEP, new Map());
    const selfPush = Math.hypot(p1!.impulse.x, p1!.impulse.y);
    const rivalPush = Math.hypot(p2!.impulse.x, p2!.impulse.y);
    expect(selfPush).toBeGreaterThan(0);
    expect(rivalPush).toBeGreaterThan(0);
    // Same blast, closer body takes the bigger hit.
    expect(selfPush).toBeGreaterThan(rivalPush);
    expect(p2!.impulse.x).toBeGreaterThan(0);
  });

  it('aims the push away from the bomb, not simply sideways', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    p1!.position = { x: 500, y: 500 };
    // Bomb down-right of the body centre: the victim must be thrown up-left.
    addBomb(simulation, 'p1', 540, 490);
    simulation.step(FIXED_STEP, new Map());
    expect(p1!.impulse.x).toBeLessThan(0);
    expect(p1!.impulse.y).toBeLessThan(0);
  });

  it('explodes once after the fuse, applies a hit and attributes it to the owner', () => {
    const simulation = active();
    const [p1, p2] = simulation.state.actors;
    p1!.position = { x: 100, y: 500 };
    p2!.position = { x: 550, y: 500 };
    p1!.protectionRemaining = 0;
    p2!.protectionRemaining = 0;
    addBomb(simulation, 'p1', 500, 500 - ACTOR_HEIGHT / 2);
    simulation.step(FIXED_STEP, new Map());
    const events = simulation.drainEvents();

    expect(simulation.state.bombs).toHaveLength(0);
    expect(events.filter((event) => event.type === 'explosion')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'hit')).toHaveLength(1);
    expect(p2!.lastHit?.by).toBe('p1');
    expect(p2!.impulse.x).toBeGreaterThan(0);

    idle(simulation, 10);
    expect(simulation.drainEvents().filter((event) => event.type === 'explosion')).toHaveLength(0);
  });

  it('resolves simultaneous bombs independently, once per actor per explosion', () => {
    const simulation = active();
    const [p1, p2] = simulation.state.actors;
    p1!.position = { x: 100, y: 500 };
    p2!.position = { x: 550, y: 500 };
    p1!.protectionRemaining = 0;
    p2!.protectionRemaining = 0;
    addBomb(simulation, 'p1', 500, 474);
    addBomb(simulation, 'p1', 520, 474);
    simulation.step(FIXED_STEP, new Map());
    const events = simulation.drainEvents();
    expect(events.filter((event) => event.type === 'explosion')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'hit')).toHaveLength(2);
    expect(p2!.lastHit?.by).toBe('p1');
  });

  it('freezes fuse and movement while paused', () => {
    const simulation = active();
    pressBomb(simulation);
    const bomb = simulation.state.bombs[0]!;
    const fuse = bomb.fuseRemaining;
    const position = { ...bomb.position };
    simulation.pause();
    for (let frame = 0; frame < 20; frame++) simulation.step(FIXED_STEP, new Map());
    expect(bomb.fuseRemaining).toBe(fuse);
    expect(bomb.position).toEqual(position);
  });

  it('keeps a thrown bomb alive after its owner is eliminated', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    pressBomb(simulation);
    const bomb = simulation.state.bombs[0]!;
    const fuse = bomb.fuseRemaining;
    p1.status = 'eliminated';
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.bombs).toHaveLength(1);
    expect(bomb.fuseRemaining).toBeLessThan(fuse);
  });

  it('bounces on a solid floor and on a one-way platform', () => {
    for (const floor of ['solid', 'one-way'] as const) {
      const simulation = active(testMap({ floor }));
      const bomb = addBomb(simulation, 'p1', 500, 400, 2);
      bomb.velocity.y = 400;
      let bounced = false;
      for (let frame = 0; frame < 30; frame++) {
        simulation.step(FIXED_STEP, new Map());
        if (bomb.position.y <= 500 - BOMB.bodyRadius + 0.01 && bomb.velocity.y < 0) { bounced = true; break; }
      }
      expect(bounced).toBe(true);
    }
  });

  it('resets bomb stocks and cooldown on respawn and clears bombs on overtime', () => {
    const simulation = active();
    const p1 = simulation.state.actors[0]!;
    p1.bombsRemaining = 0;
    p1.bombCooldown = 0.5;
    p1.status = 'respawning';
    p1.respawnRemaining = 0.01;
    simulation.step(FIXED_STEP, new Map());
    expect(p1.bombsRemaining).toBe(BOMB.perLife);
    expect(p1.bombCooldown).toBe(0);

    const overtime = active(testMap(), { duration: 5 });
    addBomb(overtime, 'p1', 500, 474, 1);
    overtime.state.remaining = 0;
    overtime.step(FIXED_STEP, new Map());
    expect(overtime.state.overtime).toBe(true);
    expect(overtime.state.bombs).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { ARENAS } from '../src/content/maps';
import { createMatchConfig } from '../src/content/matches';
import { getWeapon } from '../src/content/weapons';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { BattleEvent, MapDefinition, MatchConfig, WeaponDrop } from '../src/game/core/types';
import { DropSystem } from '../src/game/systems/DropSystem';

function dropMap(): MapDefinition {
  return {
    id: 'drop-test', name: '投放测试台', width: 1200, height: 600,
    spawns: [{ x: 100, y: 500 }, { x: 1100, y: 500 }],
    dropPoints: [{ x: 600, y: 500 }],
    bounds: { left: -100, right: 1300, top: -100, bottom: 600 },
    platforms: [{ id: 'floor', x: 0, y: 500, width: 1200, height: 80, kind: 'solid' }],
  };
}

function active(map: MapDefinition = dropMap(), overrides: Partial<MatchConfig> = {}): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), map, countdown: 0, ...overrides });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  simulation.drainEvents();
  return simulation;
}

function advance(simulation: BattleSimulation, seconds: number): void {
  const frames = Math.ceil(seconds / FIXED_STEP);
  for (let frame = 0; frame < frames; frame++) simulation.step(FIXED_STEP, new Map());
}

function waitForDrop(simulation: BattleSimulation, limit = 600): WeaponDrop {
  for (let frame = 0; frame < limit; frame++) {
    if (simulation.state.drops.length > 0) return simulation.state.drops[0]!;
    simulation.step(FIXED_STEP, new Map());
  }
  throw new Error('drop did not spawn');
}

function land(simulation: BattleSimulation, drop: WeaponDrop): void {
  for (let frame = 0; frame < 120 && drop.state === 'incoming'; frame++) {
    simulation.step(FIXED_STEP, new Map());
  }
  expect(drop.state).toBe('active');
}

function dummyDrop(id: number): WeaponDrop {
  return {
    id, weaponId: 'rifle', position: { x: 900, y: 500 },
    state: 'active', timer: 10, warning: false,
  };
}

describe('T03 drop scheduler and weapon pool', () => {
  it('spawns the first incoming marker at eight seconds, then lands one second later', () => {
    const simulation = active();
    advance(simulation, 7.5);
    expect(simulation.state.drops).toHaveLength(0);

    const drop = waitForDrop(simulation);
    const incoming = simulation.drainEvents();
    expect(drop.state).toBe('incoming');
    expect(drop.position).toEqual({ x: 600, y: 500 });
    expect(incoming.some((event) => event.type === 'drop-incoming')).toBe(true);

    advance(simulation, 1.1);
    expect(drop.state).toBe('active');
    expect(simulation.drainEvents().some((event) => event.type === 'drop-landed')).toBe(true);
  });

  it('uses a deterministic seeded stream for position and weapon', () => {
    const first = active();
    const second = active();
    const a = waitForDrop(first);
    const b = waitForDrop(second);
    expect({ position: a.position, weaponId: a.weaponId }).toEqual({ position: b.position, weaponId: b.weaponId });
  });

  it('supports weighted pools, an empty pool, and a map without safe points', () => {
    const state = active().state;
    const events: BattleEvent[] = [];
    const custom = new DropSystem([{ weaponId: 'rifle', weight: 1 }]);
    custom.update(state, 8.1, events);
    expect(state.drops[0]?.weaponId).toBe('rifle');

    const emptyState = active().state;
    new DropSystem([]).update(emptyState, 8.1, []);
    expect(emptyState.drops).toHaveLength(0);

    const noPoints = active({
      ...dropMap(),
      platforms: [],
      dropPoints: [],
    });
    new DropSystem().update(noPoints.state, 8.1, []);
    expect(noPoints.state.drops).toHaveLength(0);
  });

  it('adds one box every eight seconds and stops at the three-box cap', () => {
    const simulation = active();
    advance(simulation, 8.1);
    expect(simulation.state.drops).toHaveLength(1);
    advance(simulation, 8);
    expect(simulation.state.drops).toHaveLength(2);
    advance(simulation, 8);
    expect(simulation.state.drops).toHaveLength(3);
    advance(simulation, 8);
    expect(simulation.state.drops).toHaveLength(3);
  });

  it('caps live drops at three and declares the final three seconds', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    simulation.state.drops.push(dummyDrop(900), dummyDrop(901));
    advance(simulation, 8.2);
    expect(simulation.state.drops).toHaveLength(3);

    drop.timer = 3;
    simulation.step(FIXED_STEP, new Map());
    expect(drop.warning).toBe(true);

    drop.timer = 0.01;
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.drops.some((candidate) => candidate.id === drop.id)).toBe(false);
    expect(simulation.drainEvents().some((event) => event.type === 'drop-expired')).toBe(true);
  });
});

describe('T04 drop candidate contract', () => {
  it('gives every formal arena four spawns and four safe, standable drop points', () => {
    for (const map of ARENAS) {
      expect(map.spawns.length).toBeGreaterThanOrEqual(4);
      expect(map.dropPoints?.length ?? 0).toBeGreaterThanOrEqual(4);
      for (const point of map.dropPoints ?? []) {
        expect(point.x).toBeGreaterThanOrEqual(map.bounds.left + 16);
        expect(point.x).toBeLessThanOrEqual(map.bounds.right - 16);
        expect(point.y).toBeGreaterThanOrEqual(map.bounds.top + 16);
        expect(point.y).toBeLessThanOrEqual(map.bounds.bottom - 16);
        expect(map.platforms.some((platform) => point.y === platform.y
          && point.x >= platform.x && point.x <= platform.x + platform.width)).toBe(true);
        for (const spawn of map.spawns) {
          expect(Math.hypot(spawn.x - point.x, spawn.y - point.y)).toBeGreaterThanOrEqual(120);
        }
      }
    }
  });
});

describe('T03 pickup rules', () => {
  it('equips the landed weapon with full ammo and removes the box', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    const weaponId = drop.weaponId;
    const actor = simulation.state.actors[0]!;
    actor.position = { x: drop.position.x, y: drop.position.y };
    simulation.step(FIXED_STEP, new Map());
    const events = simulation.drainEvents();

    expect(events.some((event) => event.type === 'pickup' && event.actorId === 'p1')).toBe(true);
    expect(actor.weapon.definition.id).toBe(weaponId);
    expect(actor.weapon.ammoRemaining).toBe(getWeapon(weaponId).maxAmmo);
    expect(actor.weapon.reserveRemaining).toBe(getWeapon(weaponId).reserveAmmo ?? 0);
    expect(simulation.state.drops).toHaveLength(0);
  });

  it('gives one box to only one actor in the same frame', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    for (const actor of simulation.state.actors) actor.position = { x: drop.position.x, y: drop.position.y };
    simulation.step(FIXED_STEP, new Map());
    const events = simulation.drainEvents();
    const pickups = events.filter((event) => event.type === 'pickup');
    expect(pickups).toHaveLength(1);
    const armed = simulation.state.actors.filter((actor) => actor.weapon.definition.id !== 'pistol');
    expect(armed).toHaveLength(1);
  });

  it('excludes a respawning / out-of-bounds actor from pickup', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    const actor = simulation.state.actors[0]!;
    actor.position = { x: drop.position.x, y: drop.position.y };
    actor.status = 'respawning';
    actor.respawnRemaining = 1;
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.drops.some((candidate) => candidate.id === drop.id)).toBe(true);

    actor.status = 'alive';
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.drops).toHaveLength(0);
  });

  it('keeps the old gun shot from the pickup frame and switches the next frame', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    const actor = simulation.state.actors[0]!;
    actor.position = { x: drop.position.x, y: drop.position.y };
    actor.facing = 1;
    simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));

    expect(simulation.state.projectiles.some((projectile) => projectile.weaponId === 'pistol')).toBe(true);
    expect(actor.weapon.definition.id).toBe(drop.weaponId);
    expect(simulation.state.drops).toHaveLength(0);
  });

  it('lets a pickup win over expiry in the same frame', () => {
    const simulation = active();
    const drop = waitForDrop(simulation);
    land(simulation, drop);
    const actor = simulation.state.actors[0]!;
    actor.position = { x: drop.position.x, y: drop.position.y };
    drop.timer = 0.001;
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.drainEvents().some((event) => event.type === 'pickup')).toBe(true);
  });

  it('does not advance the drop timer while paused or in countdown', () => {
    const simulation = active();
    advance(simulation, 7.5);
    simulation.pause();
    for (let frame = 0; frame < 120; frame++) simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.drops).toHaveLength(0);

    simulation.resume();
    for (let frame = 0; frame < 179; frame++) simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.drops).toHaveLength(0);
  });

  it('clears drops when overtime starts', () => {
    const simulation = active();
    simulation.state.drops.push(dummyDrop(900));
    simulation.state.remaining = 0;
    simulation.step(FIXED_STEP, new Map());
    expect(simulation.state.overtime).toBe(true);
    expect(simulation.state.drops).toHaveLength(0);
  });
});

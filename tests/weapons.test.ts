import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BASIC_PISTOL, CANNON, GATLING, RIFLE, ROCKET, SHOTGUN, SMG, SNIPER, WEAPONS, createWeapon, getWeapon } from '../src/content/weapons';
import { BotController } from '../src/game/ai/BotController';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { MapDefinition, MatchConfig } from '../src/game/core/types';
import { equipWeapon, hasAmmo, refillWeapon, revertToPistol } from '../src/game/systems/WeaponSystem';

function active(overrides: Partial<MatchConfig> = {}): BattleSimulation {
  const simulation = new BattleSimulation({ ...createMatchConfig('local-duel', 42), countdown: 0, ...overrides });
  simulation.step(FIXED_STEP, new Map());
  simulation.step(FIXED_STEP, new Map());
  simulation.drainEvents();
  return simulation;
}

function fire(simulation: BattleSimulation): void {
  simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
}

function flatMap(): MapDefinition {
  return {
    id: 'flat-test', name: '平地', width: 1600, height: 700,
    spawns: [{ x: 200, y: 500 }, { x: 800, y: 500 }],
    bounds: { left: -100, right: 1700, top: -300, bottom: 700 },
    platforms: [{ id: 'floor', x: 0, y: 500, width: 1600, height: 40, kind: 'solid' }],
  };
}

describe('T01 weapon registry and ammo', () => {
  it('registers eight usable guns and exposes legal switch / refill entries', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(['cannon', 'gatling', 'pistol', 'rifle', 'rocket', 'shotgun', 'smg', 'sniper']);
    expect(createWeapon('smg').ammoRemaining).toBe(30);
    expect(createWeapon('smg').reserveRemaining).toBe(90);
    expect(createWeapon('gatling').ammoRemaining).toBe(100);
    expect(createWeapon('gatling').reserveRemaining).toBe(100);
    expect(getWeapon('rocket')).toBe(ROCKET);
    expect(ROCKET.explosion).toEqual({ radius: 150, centerImpulse: 650, edgeImpulse: 200 });

    const simulation = active();
    const actor = simulation.state.actors[0]!;
    equipWeapon(actor, 'sniper');
    expect(actor.weapon.definition).toBe(SNIPER);
    expect(actor.weapon.ammoRemaining).toBe(5);
    actor.weapon.ammoRemaining = 0;
    expect(hasAmmo(actor)).toBe(false);
    refillWeapon(actor);
    expect(actor.weapon.ammoRemaining).toBe(5);
    actor.fireCooldown = 0.42;
    revertToPistol(actor);
    expect(actor.weapon.definition).toBe(BASIC_PISTOL);
    expect(actor.fireCooldown).toBe(0.42);
    equipWeapon(actor, 'rocket');
    expect(actor.weapon.definition).toBe(ROCKET);
    expect(actor.weapon.ammoRemaining).toBe(1);
    equipWeapon(actor, 'cannon');
    expect(actor.weapon.definition).toBe(CANNON);
    expect(actor.weapon.ammoRemaining).toBe(1);
    expect(actor.weapon.reserveRemaining).toBe(2);
  });

  it('keeps the pistol reference while every standard special hits harder per trigger', () => {
    expect(RIFLE.knockback).toBeGreaterThan(BASIC_PISTOL.knockback);
    expect(SHOTGUN.knockback * SHOTGUN.pellets).toBeGreaterThan(BASIC_PISTOL.knockback);
    expect(SNIPER.knockback).toBeGreaterThan(BASIC_PISTOL.knockback);
    expect(ROCKET.explosion!.centerImpulse).toBeGreaterThan(BASIC_PISTOL.knockback);
    expect(GATLING.tier).toBe('ultimate');
    expect(CANNON.tier).toBe('ultimate');
    expect(GATLING.interval).toBeLessThan(BASIC_PISTOL.interval);
    expect(CANNON.interval).toBeGreaterThan(BASIC_PISTOL.interval);
    expect(CANNON.knockback).toBeGreaterThan(BASIC_PISTOL.knockback * 4);
  });

  it('cannon launches a full stock in one clean hit', () => {
    const simulation = active({ map: flatMap() });
    const [shooter, target] = simulation.state.actors;
    shooter!.position = { x: 700, y: 500 };
    target!.position = { x: 800, y: 500 };
    shooter!.facing = 1;
    shooter!.protectionRemaining = 0;
    target!.protectionRemaining = 0;
    equipWeapon(shooter!, 'cannon');
    fire(simulation);
    let ringout = false;
    for (let frame = 0; frame < 120 && target!.stocks === 3; frame++) {
      simulation.step(FIXED_STEP, new Map());
      ringout ||= simulation.drainEvents().some((event) => event.type === 'ringout' && event.actorId === 'p2');
    }
    expect(ringout).toBe(true);
    expect(target!.stocks).toBe(2);
    expect(target!.status).toBe('respawning');
  });

  it('gatling fires much faster than the pistol from a 200-round loadout', () => {
    const simulation = active({ map: flatMap() });
    const shooter = simulation.state.actors[0]!;
    const target = simulation.state.actors[1]!;
    shooter.position = { x: 300, y: 500 };
    target.position = { x: 100, y: 500 };
    shooter.facing = 1;
    equipWeapon(shooter, 'gatling');
    for (let frame = 0; frame < 18; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    }
    expect(shooter.weapon.ammoRemaining).toBeLessThan(100);
    const gatlingRounds = simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'gatling');
    expect(gatlingRounds.length, JSON.stringify({ ammo: shooter.weapon.ammoRemaining, cooldown: shooter.fireCooldown, rounds: simulation.state.projectiles.map((projectile) => projectile.weaponId) })).toBeGreaterThan(2);

  });

  it.each([
    ['smg', SMG, 29],
    ['rifle', RIFLE, 29],
    ['sniper', SNIPER, 4],
  ] as const)('fires one straight %s round and consumes exactly one ammo', (id, weapon, remaining) => {
    const simulation = active();
    const shooter = simulation.state.actors[0]!;
    shooter.position.x = 400;
    shooter.facing = 1;
    equipWeapon(shooter, id);
    fire(simulation);

    const rounds = simulation.state.projectiles.filter((projectile) => projectile.weaponId === id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.velocity).toEqual({ x: weapon.projectileSpeed, y: 0 });
    expect(rounds[0]!.impulse).toEqual({ x: weapon.knockback, y: -weapon.knockback * 0.2 });
    expect(shooter.weapon.ammoRemaining).toBe(remaining);
    expect(shooter.fireCooldown).toBeCloseTo(weapon.interval);
    expect(shooter.impulse.x).toBeCloseTo(-weapon.recoil);
    expect(simulation.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(1);
  });

  it('fires five spread pellets for one shotgun trigger, not five ammo', () => {
    const simulation = active();
    const [shooter, target] = simulation.state.actors;
    shooter!.position.x = 400;
    shooter!.facing = 1;
    target!.position.x = 200;
    equipWeapon(shooter!, 'shotgun');
    fire(simulation);

    const pellets = simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'shotgun');
    expect(pellets).toHaveLength(5);
    const angles = pellets.map((projectile) => Math.atan2(projectile.velocity.y, projectile.velocity.x) * 180 / Math.PI)
      .sort((a, b) => a - b);
    expect(angles[0]).toBeCloseTo(-12);
    expect(angles[1]).toBeCloseTo(-6);
    expect(angles[2]).toBeCloseTo(0);
    expect(angles[3]).toBeCloseTo(6);
    expect(angles[4]).toBeCloseTo(12);
    for (const pellet of pellets) expect(Math.hypot(pellet.velocity.x, pellet.velocity.y)).toBeCloseTo(1200);
    expect(shooter!.weapon.ammoRemaining).toBe(5);
    expect(shooter!.fireCooldown).toBeCloseTo(0.75);
    expect(shooter!.impulse.x).toBeCloseTo(-48);
    expect(simulation.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(1);
  });

  it('reverts once after the last ammo and never inserts a same-frame pistol shot', () => {
    const simulation = active();
    const shooter = simulation.state.actors[0]!;
    shooter.position.x = 400;
    shooter.facing = 1;
    equipWeapon(shooter, 'shotgun');
    shooter.weapon.ammoRemaining = 1;
    shooter.weapon.reserveRemaining = 0;
    fire(simulation);

    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'shotgun')).toHaveLength(5);
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(0);
    expect(shooter.weapon.definition).toBe(BASIC_PISTOL);
    expect(shooter.weapon.ammoRemaining).toBeNull();
    expect(shooter.fireCooldown).toBeCloseTo(0.75);

    // Hold fire through 16 frames (~0.27 s): the old shotgun cadence still blocks the pistol.
    for (let frame = 0; frame < 16; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    }
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(0);

    // After the 0.75 s shotgun cadence the pistol fires exactly once; a same-frame extra shot would make this two.
    for (let frame = 0; frame < 30; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    }
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(1);
  });

  it('rocket explodes on impact instead of applying a direct bullet hit', () => {
    const simulation = active({ map: flatMap() });
    const [shooter, target] = simulation.state.actors;
    shooter!.position = { x: 400, y: 500 };
    target!.position = { x: 470, y: 500 };
    shooter!.facing = 1;
    shooter!.protectionRemaining = 0;
    target!.protectionRemaining = 0;
    equipWeapon(shooter!, 'rocket');
    fire(simulation);
    for (let frame = 0; frame < 12 && simulation.state.projectiles.length > 0; frame++) {
      simulation.step(FIXED_STEP, new Map());
    }
    const events = simulation.drainEvents();

    expect(events.some((event) => event.type === 'explosion' && event.source === 'rocket')).toBe(true);
    expect(events.some((event) => event.type === 'hit' && event.actorId === 'p2')).toBe(true);
    expect(simulation.state.projectiles).toHaveLength(0);
    expect(target!.lastHit?.by).toBe('p1');
    expect(target!.impulse.x).toBeGreaterThan(0);
    expect(shooter!.weapon.ammoRemaining).toBe(0);
  });

  it('explodes at max range, keeps the frozen rocket profile after switching guns', () => {
    const simulation = active({ map: flatMap() });
    const [shooter, target] = simulation.state.actors;
    shooter!.position = { x: 300, y: 500 };
    target!.position = { x: 100, y: 500 };
    shooter!.facing = 1;
    shooter!.protectionRemaining = 0;
    target!.protectionRemaining = 0;
    equipWeapon(shooter!, 'rocket');
    fire(simulation);
    const rocket = simulation.state.projectiles.find((projectile) => projectile.weaponId === 'rocket')!;
    expect(rocket.explosion).toEqual({ radius: 150, centerImpulse: 650, edgeImpulse: 200 });

    // Switching to the pistol must not change the rocket already in flight.
    equipWeapon(shooter!, 'pistol');
    for (let frame = 0; frame < 100 && simulation.state.projectiles.length > 0; frame++) {
      simulation.step(FIXED_STEP, new Map());
    }
    const events = simulation.drainEvents();
    expect(events.some((event) => event.type === 'explosion' && event.source === 'rocket')).toBe(true);
    expect(events.some((event) => event.type === 'hit' && event.actorId === 'p2')).toBe(false);
    expect(simulation.state.projectiles).toHaveLength(0);
  });

  it('lets the bot read the equipped weapon range instead of a fixed pistol distance', () => {
    const simulation = new BattleSimulation({ ...createMatchConfig('duel-ai', 42), countdown: 0 });
    simulation.step(FIXED_STEP, new Map());
    simulation.step(FIXED_STEP, new Map());
    const bot = simulation.state.actors[1]!;
    const target = simulation.state.actors[0]!;
    bot.position.x = 300;
    bot.facing = 1;
    target.position.x = 850;
    target.position.y = bot.position.y;

    equipWeapon(bot, 'smg');
    expect(new BotController('hard', 1).sample(bot, simulation.state, FIXED_STEP).shootHeld).toBe(false);
    equipWeapon(bot, 'rifle');
    expect(new BotController('hard', 1).sample(bot, simulation.state, FIXED_STEP).shootHeld).toBe(true);
  });
});

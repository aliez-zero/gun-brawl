import { describe, expect, it } from 'vitest';
import { createMatchConfig } from '../src/content/matches';
import { BASIC_PISTOL, RIFLE, SMG, SNIPER, WEAPONS, createWeapon, getWeapon } from '../src/content/weapons';
import { BotController } from '../src/game/ai/BotController';
import { BattleSimulation } from '../src/game/core/BattleSimulation';
import { FIXED_STEP } from '../src/game/core/constants';
import { idleInput } from '../src/game/core/types';
import type { MatchConfig } from '../src/game/core/types';
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

describe('T01 weapon registry and ammo', () => {
  it('registers five usable guns, keeps the rocket blocked, and exposes legal switch / refill entries', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(['pistol', 'rifle', 'shotgun', 'smg', 'sniper']);
    expect(createWeapon('smg').ammoRemaining).toBe(60);
    expect(() => getWeapon('rocket')).toThrow(/not implemented/);

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
    expect(() => equipWeapon(actor, 'rocket')).toThrow(/not implemented/);
    expect(actor.weapon.definition).toBe(BASIC_PISTOL);
  });

  it.each([
    ['smg', SMG, 59],
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
    expect(shooter!.weapon.ammoRemaining).toBe(7);
    expect(shooter!.fireCooldown).toBeCloseTo(0.7);
    expect(shooter!.impulse.x).toBeCloseTo(-40);
    expect(simulation.drainEvents().filter((event) => event.type === 'shot')).toHaveLength(1);
  });

  it('reverts once after the last ammo and never inserts a same-frame pistol shot', () => {
    const simulation = active();
    const shooter = simulation.state.actors[0]!;
    shooter.position.x = 400;
    shooter.facing = 1;
    equipWeapon(shooter, 'shotgun');
    shooter.weapon.ammoRemaining = 1;
    fire(simulation);

    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'shotgun')).toHaveLength(5);
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(0);
    expect(shooter.weapon.definition).toBe(BASIC_PISTOL);
    expect(shooter.weapon.ammoRemaining).toBeNull();
    expect(shooter.fireCooldown).toBeCloseTo(0.7);

    // Hold fire through 16 frames (~0.27 s): the old shotgun cadence still blocks the pistol.
    for (let frame = 0; frame < 16; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    }
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(0);

    // At ~0.7 s the pistol fires exactly once; a same-frame extra shot would make this two.
    for (let frame = 0; frame < 26; frame++) {
      simulation.step(FIXED_STEP, new Map([['p1', { ...idleInput(), shootHeld: true }]]));
    }
    expect(simulation.state.projectiles.filter((projectile) => projectile.weaponId === 'pistol')).toHaveLength(1);
  });

  it('lets the bot read the equipped weapon range instead of a fixed pistol distance', () => {
    const simulation = new BattleSimulation({ ...createMatchConfig('duel-ai', 42), countdown: 0 });
    simulation.step(FIXED_STEP, new Map());
    simulation.step(FIXED_STEP, new Map());
    const bot = simulation.state.actors[1]!;
    const target = simulation.state.actors[0]!;
    bot.position.x = 300;
    bot.facing = 1;
    target.position.x = 800;
    target.position.y = bot.position.y;

    equipWeapon(bot, 'smg');
    expect(new BotController('hard', 1).sample(bot, simulation.state, FIXED_STEP).shootHeld).toBe(false);
    equipWeapon(bot, 'rifle');
    expect(new BotController('hard', 1).sample(bot, simulation.state, FIXED_STEP).shootHeld).toBe(true);
  });
});

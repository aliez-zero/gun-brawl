import { BASIC_PISTOL, weaponMuzzle } from '../../content/weapons';
import { MOVEMENT } from '../core/constants';
import { actorRect, addImpulse, segmentRect } from '../core/math';
import type { ActorInput, ActorState, BattleEvent, MatchState, Vec2 } from '../core/types';
import { applyExplosionHits, ExplosionSystem } from './ExplosionSystem';
import { hasAmmo, revertToPistol, startReload, tickReload } from './WeaponSystem';

export class CombatSystem {
  private nextProjectile = 0;
  private readonly explosions = new ExplosionSystem();

  update(state: MatchState, inputs: ReadonlyMap<string, ActorInput>, dt: number, events: BattleEvent[]): void {
    for (const actor of state.actors) {
      actor.fireCooldown = Math.max(0, actor.fireCooldown - dt);
      if (actor.status !== 'alive') continue;
      tickReload(actor, dt);
      const input = inputs.get(actor.config.id);
      if (!input) continue;
      if (input.reloadPressed && startReload(actor)) {
        events.push({ type: 'reload-start', actorId: actor.config.id, position: { ...actor.position }, weaponId: actor.weapon.definition.id });
      }
      if (!input.shootHeld || actor.fireCooldown > 1e-8 || actor.reloadRemaining > 1e-8) continue;
      if (!hasAmmo(actor)) {
        // Empty magazine: start a reload when reserve is available. Only a truly
        // depleted loadout reverts, and that frame never grants a free pistol shot.
        if (startReload(actor)) {
          events.push({ type: 'reload-start', actorId: actor.config.id, position: { ...actor.position }, weaponId: actor.weapon.definition.id });
          continue;
        }
        revertToPistol(actor);
        actor.fireCooldown = Math.max(actor.fireCooldown, BASIC_PISTOL.interval);
        continue;
      }

      const weapon = actor.weapon.definition;
      const ammo = actor.weapon.ammoRemaining;
      actor.protectionRemaining = 0;
      actor.fireCooldown = weapon.interval;
      const muzzle = weaponMuzzle(weapon.id);
      const position = { x: actor.position.x + actor.facing * muzzle.x, y: actor.position.y + muzzle.y };
      const pellets = Math.max(1, Math.floor(weapon.pellets));
      for (let index = 0; index < pellets; index++) {
        const spread = pellets === 1 ? 0 : ((index / (pellets - 1)) * 2 - 1) * weapon.spreadRadians;
        state.projectiles.push({
          id: this.nextProjectile++, owner: actor.config.id, weaponId: weapon.id,
          position: { ...position }, previous: { ...position }, origin: { ...position }, direction: actor.facing,
          velocity: {
            x: Math.cos(spread) * weapon.projectileSpeed * actor.facing,
            y: Math.sin(spread) * weapon.projectileSpeed,
          },
          impulse: { x: actor.facing * weapon.knockback, y: -weapon.knockback * 0.2 },
          distanceRemaining: weapon.range,
          ...(weapon.explosion ? { explosion: { ...weapon.explosion } } : {}),
          ...(weapon.impulseCap ? { impulseCap: weapon.impulseCap } : {}),
        });
      }
      addImpulse(actor, -actor.facing * weapon.recoil, -(weapon.recoilY ?? 0));
      events.push({ type: 'shot', actorId: actor.config.id, position: { ...position }, weaponId: weapon.id });

      if (ammo !== null) {
        actor.weapon.ammoRemaining = ammo - 1;
        if (actor.weapon.ammoRemaining === 0) {
          if (actor.weapon.reserveRemaining > 0) {
            // Emptying the magazine starts the reload immediately, even if the
            // player releases fire on the last round.
            if (startReload(actor)) {
              events.push({ type: 'reload-start', actorId: actor.config.id, position: { ...actor.position }, weaponId: actor.weapon.definition.id });
            }
          } else {
            revertToPistol(actor);
            // Preserve cadence: a depleted SMG cannot chain into a pistol shot at 0.1 s.
            actor.fireCooldown = Math.max(actor.fireCooldown, BASIC_PISTOL.interval);
          }
        }
      }
    }

    state.projectiles = state.projectiles.filter((projectile) => {
      projectile.previous = { ...projectile.position };
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      if (speed <= 1e-8) return false;
      const distance = Math.min(speed * dt, projectile.distanceRemaining);
      const to = {
        x: projectile.position.x + (projectile.velocity.x / speed) * distance,
        y: projectile.position.y + (projectile.velocity.y / speed) * distance,
      };
      let closest = Infinity;
      let target: ActorState | null = null;
      for (const platform of state.config.map.platforms) {
        if (platform.kind !== 'solid') continue;
        const hit = segmentRect(projectile.position, to, platform);
        if (hit !== null && hit < closest) { closest = hit; target = null; }
      }
      for (const actor of state.actors) {
        if (actor.status !== 'alive' || actor.config.id === projectile.owner) continue;
        const hit = segmentRect(projectile.position, to, actorRect(actor));
        if (hit !== null && hit < closest) { closest = hit; target = actor; }
      }
      if (closest !== Infinity) {
        if (projectile.explosion) {
          const impact = {
            x: projectile.position.x + (to.x - projectile.position.x) * closest,
            y: projectile.position.y + (to.y - projectile.position.y) * closest,
          };
          this.explode(state, projectile, impact, events);
        } else if (target && target.protectionRemaining <= 0) {
          addImpulse(
            target,
            projectile.impulse.x,
            projectile.impulse.y,
            projectile.impulseCap ?? Math.max(MOVEMENT.maxImpulse, Math.hypot(projectile.impulse.x, projectile.impulse.y)),
          );
          target.lastHit = { by: projectile.owner, at: state.elapsed };
          events.push({ type: 'hit', actorId: target.config.id, position: { ...target.position, y: target.position.y - 28 } });
        }
        return false;
      }
      projectile.position = to;
      projectile.distanceRemaining -= distance;
      if (projectile.distanceRemaining <= 1e-8) {
        if (projectile.explosion) this.explode(state, projectile, to, events);
        return false;
      }
      return true;
    });
  }

  private explode(state: MatchState, projectile: { owner: string; velocity: Vec2; explosion?: { radius: number; centerImpulse: number; edgeImpulse: number } }, center: Vec2, events: BattleEvent[]): void {
    if (!projectile.explosion) return;
    const request = {
      ownerId: projectile.owner,
      source: 'rocket' as const,
      center: { ...center },
      radius: projectile.explosion.radius,
      centerImpulse: projectile.explosion.centerImpulse,
      edgeImpulse: projectile.explosion.edgeImpulse,
      direction: { ...projectile.velocity },
    };
    const hits = this.explosions.resolve(state, request);
    applyExplosionHits(state, request, hits, events);
    events.push({
      type: 'explosion', source: 'rocket', ownerId: projectile.owner,
      position: { ...center }, radius: projectile.explosion.radius,
    });
  }
}

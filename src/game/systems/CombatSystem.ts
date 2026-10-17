import { BASIC_PISTOL } from '../../content/weapons';
import { actorRect, addImpulse, segmentRect } from '../core/math';
import type { ActorInput, ActorState, BattleEvent, MatchState } from '../core/types';

export class CombatSystem {
  private nextProjectile = 0;

  update(state: MatchState, inputs: ReadonlyMap<string, ActorInput>, dt: number, events: BattleEvent[]): void {
    for (const actor of state.actors) {
      actor.fireCooldown = Math.max(0, actor.fireCooldown - dt);
      if (actor.status !== 'alive' || !inputs.get(actor.config.id)?.shootHeld || actor.fireCooldown > 1e-8) continue;
      actor.protectionRemaining = 0;
      actor.fireCooldown = BASIC_PISTOL.interval;
      const position = { x: actor.position.x + actor.facing * 27, y: actor.position.y - 28 };
      state.projectiles.push({
        id: this.nextProjectile++, owner: actor.config.id,
        position, previous: { ...position }, direction: actor.facing,
        distanceRemaining: BASIC_PISTOL.range,
      });
      addImpulse(actor, -actor.facing * BASIC_PISTOL.recoil, 0);
      events.push({ type: 'shot', actorId: actor.config.id, position: { ...position } });
    }

    state.projectiles = state.projectiles.filter((projectile) => {
      projectile.previous = { ...projectile.position };
      const distance = Math.min(BASIC_PISTOL.projectileSpeed * dt, projectile.distanceRemaining);
      const to = { x: projectile.position.x + projectile.direction * distance, y: projectile.position.y };
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
        if (target && target.protectionRemaining <= 0) {
          addImpulse(target, projectile.direction * BASIC_PISTOL.knockback, -BASIC_PISTOL.knockback * 0.2);
          target.lastHit = { by: projectile.owner, at: state.elapsed };
          events.push({ type: 'hit', actorId: target.config.id, position: { ...target.position, y: target.position.y - 28 } });
        }
        return false;
      }
      projectile.position = to;
      projectile.distanceRemaining -= distance;
      return projectile.distanceRemaining > 1e-8;
    });
  }
}

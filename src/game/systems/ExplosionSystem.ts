import { ACTOR_HEIGHT, ACTOR_WIDTH } from '../core/constants';
import { MOVEMENT } from '../core/constants';
import { addImpulse, segmentRect } from '../core/math';
import type {
  ActorState, BattleEvent, ExplosionHit, ExplosionRequest, ExplosionResolver, MatchState, Vec2,
} from '../core/types';

/** Feet position -> the point used for radial falloff and line of sight. */
export function explosionTarget(actor: ActorState): Vec2 {
  return { x: actor.position.x, y: actor.position.y - ACTOR_HEIGHT / 2 };
}

/**
 * Shared by bombs (T02) and rockets (T01). It is intentionally pure: it reads
 * state and returns hits. The caller applies impulses and attribution, so the
 * same resolver can serve both without importing either weapon system.
 */
export class ExplosionSystem implements ExplosionResolver {
  resolve(state: MatchState, request: ExplosionRequest): ExplosionHit[] {
    const hits: ExplosionHit[] = [];
    for (const actor of state.actors) {
      if (actor.status !== 'alive' || actor.protectionRemaining > 0) continue;
      const target = explosionTarget(actor);
      const dx = target.x - request.center.x;
      const dy = target.y - request.center.y;
      const distance = Math.hypot(dx, dy);
      if (distance > request.radius + 1e-8) continue;
      if (this.blocked(state, request.center, target)) continue;

      const t = request.radius <= 1e-8 ? 0 : Math.min(1, distance / request.radius);
      const magnitude = request.centerImpulse + (request.edgeImpulse - request.centerImpulse) * t;
      let direction = distance <= 1e-8
        ? { x: 0, y: -1 }
        : { x: dx / distance, y: dy / distance };
      // A rocket that already detonates inside / at the near edge of the target
      // has an arbitrary radial sign; use its travel direction so the target is
      // launched downrange instead of back into the shooter.
      if (request.direction && distance <= ACTOR_WIDTH) {
        const length = Math.hypot(request.direction.x, request.direction.y);
        if (length > 1e-8) direction = { x: request.direction.x / length, y: request.direction.y / length };
      }
      hits.push({ actorId: actor.config.id, impulse: { x: direction.x * magnitude, y: direction.y * magnitude } });
    }
    return hits;
  }

  private blocked(state: MatchState, from: Vec2, to: Vec2): boolean {
    for (const platform of state.config.map.platforms) {
      if (platform.kind !== 'solid') continue;
      if (segmentRect(from, to, platform) !== null) return true;
    }
    return false;
  }
}

/**
 * Applies resolver output. Self-explosions can push the owner, but must not
 * overwrite an existing enemy attribution or credit the owner with a self ringout.
 */
export function applyExplosionHits(
  state: MatchState,
  request: ExplosionRequest,
  hits: readonly ExplosionHit[],
  events: BattleEvent[],
): void {
  for (const hit of hits) {
    const actor = state.actors.find((candidate) => candidate.config.id === hit.actorId);
    if (!actor || actor.status !== 'alive' || actor.protectionRemaining > 0) continue;
    addImpulse(actor, hit.impulse.x, hit.impulse.y, Math.max(MOVEMENT.maxImpulse, Math.hypot(hit.impulse.x, hit.impulse.y)));
    if (actor.config.id !== request.ownerId) actor.lastHit = { by: request.ownerId, at: state.elapsed };
    events.push({ type: 'hit', actorId: actor.config.id, position: { ...actor.position, y: actor.position.y - 28 } });
  }
}

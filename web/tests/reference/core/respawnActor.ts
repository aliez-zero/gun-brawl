import { createActor } from '../../../src/game/core/actors';
import type { ActorState, MatchState } from '../../../src/game/core/types';

export function respawnActor(actor: ActorState, state: MatchState): void {
  const others = state.actors.filter((other) => other !== actor && other.status === 'alive');
  const points = state.config.map.spawns;
  let spawn = points[0]!;
  let bestDistance = -1;
  for (const point of points) {
    const nearest = others.length
      ? Math.min(...others.map((other) => Math.hypot(other.position.x - point.x, other.position.y - point.y)))
      : Infinity;
    if (nearest > bestDistance) {
      spawn = point;
      bestDistance = nearest;
    }
  }
  const stats = actor.stats;
  Object.assign(actor, createActor(
    actor.config, spawn, actor.stocks, state.config.map.width / 2, state.config.startingWeapon,
  ));
  actor.stats = stats;
}

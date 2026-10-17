import { BOMB, PROTECTION_TIME } from './constants';
import { createWeaponInstance } from './types';
import type { ActorConfig, ActorState, MatchState, Vec2, WeaponDefinition } from './types';

export function createActor(
  config: ActorConfig,
  spawn: Vec2,
  stocks: number,
  centerX: number,
  startingWeapon: WeaponDefinition,
): ActorState {
  return {
    config, position: { ...spawn }, previous: { ...spawn },
    moveVelocity: 0, verticalVelocity: 0, impulse: { x: 0, y: 0 },
    facing: spawn.x < centerX ? 1 : -1,
    groundedOn: null, jumpsRemaining: 2, coyoteRemaining: 0, jumpBuffer: 0,
    dropPlatform: null, dropRemaining: 0, stocks, status: 'alive',
    respawnRemaining: 0, protectionRemaining: PROTECTION_TIME, fireCooldown: 0,
    weapon: createWeaponInstance(startingWeapon),
    bombsRemaining: BOMB.perLife, bombCooldown: 0,
    lastHit: null, stats: { knockouts: 0, falls: 0, selfFalls: 0 },
  };
}

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

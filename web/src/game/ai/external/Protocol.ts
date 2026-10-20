import { MOVEMENT, ACTOR_HEIGHT, ACTOR_WIDTH } from '../../core/constants';
import type { ActorInput, MatchState } from '../../core/types';
import { nearestPlatform, planRoute, platformForActor } from '../Navigation';

export const MAX_OBSERVATION_AGE = 180;
export const MAX_HOLD_FRAMES = 45;
export const MAX_RECENT_ACTIONS = 8;

export type ExternalIntent = 'recover' | 'attack' | 'collect' | 'reposition';
export interface ExternalAction extends ActorInput { holdFrames: number; intent?: ExternalIntent | null }
export interface ExternalActionOutcome {
  observedTick: number;
  deltaX: number;
  deltaY: number;
  platformId: string | null;
  status: 'alive' | 'respawning' | 'eliminated';
  grounded: boolean;
}
export interface RecentExternalAction extends ExternalAction { tick: number; outcome?: ExternalActionOutcome | null }
export interface CommandContext { epoch: number; sequence: number; observationTick: number }

export function parseExternalAction(value: unknown): ExternalAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const fields = ['jumpPressed', 'dropPressed', 'shootHeld', 'bombPressed', 'reloadPressed'] as const;
  if (v.moveX !== -1 && v.moveX !== 0 && v.moveX !== 1) return null;
  if (fields.some((field) => typeof v[field] !== 'boolean')) return null;
  if (!Number.isInteger(v.holdFrames) || (v.holdFrames as number) < 1 || (v.holdFrames as number) > MAX_HOLD_FRAMES) return null;
  if (v.jumpPressed && v.dropPressed) return null;
  const action: ExternalAction = {
    moveX: v.moveX, jumpPressed: v.jumpPressed as boolean, dropPressed: v.dropPressed as boolean,
    shootHeld: v.shootHeld as boolean, bombPressed: v.bombPressed as boolean,
    reloadPressed: v.reloadPressed as boolean, holdFrames: v.holdFrames as number,
  };
  if (v.intent === null || v.intent === undefined) action.intent = null;
  else if (v.intent === 'recover' || v.intent === 'attack' || v.intent === 'collect' || v.intent === 'reposition') action.intent = v.intent;
  else return null;
  return action;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const position = (p: { x: number; y: number }): { x: number; y: number } => ({ x: round(p.x), y: round(p.y) });

/** A copied telemetry observation; no seed, mutable state references or opponent cooldowns. */
export function createObservation(
  state: Readonly<MatchState>,
  actorId: string,
  tick: number,
  recentActions: readonly RecentExternalAction[] = [],
) {
  const self = state.actors.find((actor) => actor.config.id === actorId);
  if (!self || !state.config.matchId) throw new Error('外部 AI 需要有效角色与对局 ID');
  const map = state.config.map;
  const enemies = state.actors.filter((a) => a.config.id !== actorId);
  const nearestEnemy = enemies
    .filter((enemy) => enemy.status === 'alive')
    .sort((a, b) => Math.hypot(a.position.x - self.position.x, a.position.y - self.position.y)
      - Math.hypot(b.position.x - self.position.x, b.position.y - self.position.y))[0];
  const nearestDistance = nearestEnemy
    ? Math.hypot(nearestEnemy.position.x - self.position.x, nearestEnemy.position.y - self.position.y)
    : null;
  const nearestDrop = state.drops
    .filter((drop) => drop.state === 'active')
    .sort((left, right) => Math.hypot(left.position.x - self.position.x, left.position.y - self.position.y)
      - Math.hypot(right.position.x - self.position.x, right.position.y - self.position.y))[0];
  const targetAligned = Boolean(nearestEnemy)
    && Math.abs(nearestEnemy!.position.y - self.position.y) < 55
    && self.facing === (nearestEnemy!.position.x < self.position.x ? -1 : 1);
  const targetInRange = Boolean(nearestEnemy)
    && Math.abs(nearestEnemy!.position.x - self.position.x) <= self.weapon.definition.range
    && Math.abs(nearestEnemy!.position.y - self.position.y) < 55;
  const currentPlatform = map.platforms.find((platform) => platform.id === self.groundedOn);
  const enemyPlatform = nearestEnemy
    ? platformForActor(map, nearestEnemy) ?? nearestPlatform(map, nearestEnemy.position.x, nearestEnemy.position.y)
    : undefined;
  const routeStep = currentPlatform && enemyPlatform && currentPlatform.id !== enemyPlatform.id
    ? planRoute(map, currentPlatform.id, enemyPlatform.id)[0]
    : undefined;
  const safePlatform = map.platforms
    .filter((platform) => platform.y >= self.position.y - 8 && platform.y - self.position.y < 280)
    .sort((left, right) => {
      const leftGap = Math.max(left.x - self.position.x, 0, self.position.x - (left.x + left.width));
      const rightGap = Math.max(right.x - self.position.x, 0, self.position.x - (right.x + right.width));
      return leftGap + Math.abs(left.y - self.position.y) * 0.2 - rightGap - Math.abs(right.y - self.position.y) * 0.2;
    })[0];
  const nearestProjectile = state.projectiles
    .filter((projectile) => projectile.owner !== actorId)
    .sort((left, right) => Math.hypot(left.position.x - self.position.x, left.position.y - self.position.y)
      - Math.hypot(right.position.x - self.position.x, right.position.y - self.position.y))[0];
  const nearestBomb = state.bombs
    .filter((bomb) => bomb.owner !== actorId)
    .sort((left, right) => Math.hypot(left.position.x - self.position.x, left.position.y - self.position.y)
      - Math.hypot(right.position.x - self.position.x, right.position.y - self.position.y))[0];
  const activeDrop = state.drops
    .filter((drop) => drop.state === 'active')
    .sort((left, right) => Math.hypot(left.position.x - self.position.x, left.position.y - self.position.y)
      - Math.hypot(right.position.x - self.position.x, right.position.y - self.position.y))[0];
  const threatDistance = nearestProjectile && nearestBomb
    ? Math.min(Math.hypot(nearestProjectile.position.x - self.position.x, nearestProjectile.position.y - self.position.y), Math.hypot(nearestBomb.position.x - self.position.x, nearestBomb.position.y - self.position.y))
    : nearestProjectile
      ? Math.hypot(nearestProjectile.position.x - self.position.x, nearestProjectile.position.y - self.position.y)
      : nearestBomb
        ? Math.hypot(nearestBomb.position.x - self.position.x, nearestBomb.position.y - self.position.y)
        : Infinity;
  const priority = self.groundedOn === null && self.verticalVelocity > 0 ? 'recover'
    : threatDistance < 150 ? 'recover'
      : activeDrop && Math.hypot(activeDrop.position.x - self.position.x, activeDrop.position.y - self.position.y) < 340 ? 'collect'
        : nearestEnemy ? 'attack' : 'reposition';
  return {
    version: 1 as const, episodeId: state.config.matchId, actorId, tick,
    remaining: round(state.remaining),
    map: {
      id: map.id, width: map.width, height: map.height, bounds: { ...map.bounds },
      platforms: map.platforms.map((p) => ({ id: p.id, x: p.x, y: p.y, width: p.width, height: p.height, kind: p.kind })),
    },
    physics: { speed: MOVEMENT.speed, gravity: MOVEMENT.gravity, jump: MOVEMENT.jump, airJump: MOVEMENT.airJump, width: ACTOR_WIDTH, height: ACTOR_HEIGHT },
    self: {
      id: actorId, ...position(self.position), vx: round(self.moveVelocity + self.impulse.x),
      vy: round(self.verticalVelocity + self.impulse.y), facing: self.facing,
      groundedOn: self.groundedOn, jumpsRemaining: self.jumpsRemaining, stocks: self.stocks,
      protection: round(self.protectionRemaining), reloadRemaining: round(self.reloadRemaining),
      fireCooldown: round(self.fireCooldown), bombsRemaining: self.bombsRemaining,
      bombCooldown: round(self.bombCooldown),
      weapon: {
        id: self.weapon.definition.id, ammo: self.weapon.ammoRemaining, reserve: self.weapon.reserveRemaining,
        range: self.weapon.definition.range, interval: self.weapon.definition.interval,
        projectileSpeed: self.weapon.definition.projectileSpeed, knockback: self.weapon.definition.knockback,
        maxAmmo: self.weapon.definition.maxAmmo, pellets: self.weapon.definition.pellets,
        explosionRadius: self.weapon.definition.explosion?.radius ?? null,
      },
    },
    tactical: {
      edgeDistanceLeft: Math.max(0, round(self.position.x - map.bounds.left)),
      edgeDistanceRight: Math.max(0, round(map.bounds.right - self.position.x)),
      platformEdgeDistanceLeft: currentPlatform ? Math.max(0, round(self.position.x - currentPlatform.x)) : null,
      platformEdgeDistanceRight: currentPlatform ? Math.max(0, round(currentPlatform.x + currentPlatform.width - self.position.x)) : null,
      nearestEnemyId: nearestEnemy?.config.id ?? null,
      nearestEnemyDx: nearestEnemy ? round(nearestEnemy.position.x - self.position.x) : null,
      nearestEnemyDy: nearestEnemy ? round(nearestEnemy.position.y - self.position.y) : null,
      nearestEnemyDistance: nearestDistance === null ? null : round(nearestDistance),
      targetAligned,
      targetInRange,
      currentPlatformId: self.groundedOn,
      isFalling: self.groundedOn === null && self.verticalVelocity > 0,
      routeAction: routeStep?.action ?? 'hold',
      routePlatformId: routeStep?.platform.id ?? null,
      routePlatformDx: routeStep ? round(routeStep.platform.x + routeStep.platform.width / 2 - self.position.x) : null,
      safePlatformId: safePlatform?.id ?? null,
      safePlatformDx: safePlatform ? round(safePlatform.x + safePlatform.width / 2 - self.position.x) : null,
      nearestProjectileDx: nearestProjectile ? round(nearestProjectile.position.x - self.position.x) : null,
      nearestProjectileDistance: nearestProjectile ? round(Math.hypot(nearestProjectile.position.x - self.position.x, nearestProjectile.position.y - self.position.y)) : null,
      nearestBombDx: nearestBomb ? round(nearestBomb.position.x - self.position.x) : null,
      nearestBombDistance: nearestBomb ? round(Math.hypot(nearestBomb.position.x - self.position.x, nearestBomb.position.y - self.position.y)) : null,
      nearestDropId: nearestDrop?.id ?? null,
      nearestDropDx: nearestDrop ? round(nearestDrop.position.x - self.position.x) : null,
      nearestDropDy: nearestDrop ? round(nearestDrop.position.y - self.position.y) : null,
      nearestDropDistance: nearestDrop ? round(Math.hypot(nearestDrop.position.x - self.position.x, nearestDrop.position.y - self.position.y)) : null,
      priority,
    },
    recentActions: recentActions.slice(-MAX_RECENT_ACTIONS).map((action) => ({
      tick: action.tick,
      moveX: action.moveX,
      jumpPressed: action.jumpPressed,
      dropPressed: action.dropPressed,
      shootHeld: action.shootHeld,
      bombPressed: action.bombPressed,
      reloadPressed: action.reloadPressed,
      holdFrames: action.holdFrames,
      ...(action.intent === undefined ? {} : { intent: action.intent }),
      outcome: action.outcome ? { ...action.outcome } : null,
    })),
    enemies: enemies.map((a) => ({
      id: a.config.id, ...position(a.position), vx: round(a.moveVelocity + a.impulse.x),
      vy: round(a.verticalVelocity + a.impulse.y), facing: a.facing, groundedOn: a.groundedOn, stocks: a.stocks,
      status: a.status, weaponId: a.weapon.definition.id,
    })),
    projectiles: state.projectiles.slice(-48).map((p) => ({ id: p.id, owner: p.owner, ...position(p.position), vx: round(p.velocity.x), vy: round(p.velocity.y) })),
    // Bomb fuse is deliberately omitted: this mode does not expose opponents' internal timers.
    bombs: state.bombs.map((b) => ({ id: b.id, owner: b.owner, ...position(b.position), vx: round(b.velocity.x), vy: round(b.velocity.y), radius: b.radius })),
    drops: state.drops.map((d) => ({ id: d.id, ...position(d.position), weaponId: d.weaponId, state: d.state })),
  };
}

export type GameObservation = ReturnType<typeof createObservation>;

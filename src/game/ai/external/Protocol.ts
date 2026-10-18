import { MOVEMENT, ACTOR_HEIGHT, ACTOR_WIDTH } from '../../core/constants';
import type { ActorInput, MatchState } from '../../core/types';

export const MAX_OBSERVATION_AGE = 180;
export const MAX_HOLD_FRAMES = 45;

export interface ExternalAction extends ActorInput { holdFrames: number }
export interface CommandContext { epoch: number; sequence: number; observationTick: number }

export function parseExternalAction(value: unknown): ExternalAction | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const fields = ['jumpPressed', 'dropPressed', 'shootHeld', 'bombPressed', 'reloadPressed'] as const;
  if (v.moveX !== -1 && v.moveX !== 0 && v.moveX !== 1) return null;
  if (fields.some((field) => typeof v[field] !== 'boolean')) return null;
  if (!Number.isInteger(v.holdFrames) || (v.holdFrames as number) < 1 || (v.holdFrames as number) > MAX_HOLD_FRAMES) return null;
  if (v.jumpPressed && v.dropPressed) return null;
  return {
    moveX: v.moveX, jumpPressed: v.jumpPressed as boolean, dropPressed: v.dropPressed as boolean,
    shootHeld: v.shootHeld as boolean, bombPressed: v.bombPressed as boolean,
    reloadPressed: v.reloadPressed as boolean, holdFrames: v.holdFrames as number,
  };
}

const round = (n: number): number => Math.round(n * 100) / 100;
const position = (p: { x: number; y: number }): { x: number; y: number } => ({ x: round(p.x), y: round(p.y) });

/** A copied telemetry observation; no seed, mutable state references or opponent cooldowns. */
export function createObservation(state: Readonly<MatchState>, actorId: string, tick: number) {
  const self = state.actors.find((actor) => actor.config.id === actorId);
  if (!self || !state.config.matchId) throw new Error('外部 AI 需要有效角色与对局 ID');
  const map = state.config.map;
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
      },
    },
    enemies: state.actors.filter((a) => a.config.id !== actorId).map((a) => ({
      id: a.config.id, ...position(a.position), vx: round(a.moveVelocity + a.impulse.x),
      vy: round(a.verticalVelocity + a.impulse.y), facing: a.facing, stocks: a.stocks,
      status: a.status, weaponId: a.weapon.definition.id,
    })),
    projectiles: state.projectiles.slice(-48).map((p) => ({ id: p.id, owner: p.owner, ...position(p.position), vx: round(p.velocity.x), vy: round(p.velocity.y) })),
    // Bomb fuse is deliberately omitted: this mode does not expose opponents' internal timers.
    bombs: state.bombs.map((b) => ({ id: b.id, owner: b.owner, ...position(b.position), vx: round(b.velocity.x), vy: round(b.velocity.y), radius: b.radius })),
    drops: state.drops.map((d) => ({ id: d.id, ...position(d.position), weaponId: d.weaponId, state: d.state })),
  };
}

export type GameObservation = ReturnType<typeof createObservation>;

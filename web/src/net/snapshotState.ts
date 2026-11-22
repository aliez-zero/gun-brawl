import { FIXED_STEP, MOVEMENT } from '../game/core/constants';
import type { ActorState, BattleEvent, MapDefinition, MatchPhase, MatchState, Vec2, WeaponDefinition } from '../game/core/types';
import { TRAINING_TASKS } from '../content/tutorial';
import {
  EVENT_BOMB, EVENT_BOMB_EMPTY, EVENT_DROP_EXPIRED, EVENT_DROP_INCOMING, EVENT_DROP_LANDED,
  EVENT_EXPLOSION, EVENT_HIT, EVENT_OVERTIME, EVENT_PHASE, EVENT_PICKUP, EVENT_RELOAD,
  EVENT_RESPAWN, EVENT_RINGOUT, EVENT_SHOT, PHASE_PAUSED, PHASE_PLAYING, PHASE_RESULT,
  type ActorSnap, type EventSnap, type Snapshot,
} from './protocol';

export function position(wire: { x: number; y: number }): Vec2 { return { x: wire.x / 16, y: wire.y / 16 }; }
export function velocity(x: number, y: number): Vec2 { return { x: x / 8, y: y / 8 }; }

function phaseOf(phase: number): MatchPhase {
  switch (phase) {
    case PHASE_PLAYING: return 'playing';
    case PHASE_PAUSED: return 'paused';
    case PHASE_RESULT: return 'finished';
    default: return 'countdown';
  }
}

export function updateMatchInfo(state: MatchState, wire: Snapshot): void {
  state.phase = phaseOf(wire.phase);
  state.remaining = wire.remainingMs / 1000;
  state.countdownRemaining = wire.countdownMs / 1000;
  state.elapsed = wire.serverMs / 1000;
  state.overtime = wire.overtime;
  const training = state.training;
  if (training) {
    training.dummyMoving = wire.dummyMoving;
    training.completedTasks = [];
    TRAINING_TASKS.forEach(({ id }, index) => {
      training.completed[id] = (wire.trainingCompleted & (1 << index)) !== 0;
      if (training.completed[id]) training.completedTasks.push(id);
    });
  }
}

/** Zero is inactive. Other values count fixed steps elapsed since the timer started, plus one. */
function movementTime(encoded: number, duration: number): number {
  return encoded === 0 ? 0 : Math.max(0, duration - (encoded - 1) * FIXED_STEP);
}

export function applyActorSnapshot(
  actor: ActorState, wire: ActorSnap, map: MapDefinition, weapon: WeaponDefinition,
): void {
  actor.status = wire.status === 0 ? 'alive' : wire.status === 1 ? 'respawning' : 'eliminated';
  actor.stocks = wire.stocks;
  actor.facing = wire.facing < 0 ? -1 : 1;
  actor.groundedOn = map.platforms[wire.groundedPlatform]?.id ?? null;
  actor.dropPlatform = map.platforms[wire.dropPlatform]?.id ?? null;
  actor.dropRemaining = movementTime(wire.dropTimer, MOVEMENT.dropTime);
  actor.coyoteRemaining = movementTime(wire.coyoteTimer, MOVEMENT.coyoteTime);
  actor.jumpBuffer = movementTime(wire.jumpTimer, MOVEMENT.inputBuffer);
  actor.jumpsRemaining = (wire.flags >> 1) & 3;
  actor.moveVelocity = wire.vx / 8;
  actor.verticalVelocity = wire.vy / 8;
  actor.impulse = velocity(wire.impulseX, wire.impulseY);
  actor.weapon = { definition: weapon, ammoRemaining: wire.ammo === 255 ? null : wire.ammo, reserveRemaining: wire.reserve };
  actor.fireCooldown = wire.fireCd / 100;
  actor.reloadRemaining = wire.reloadMs / 1000;
  actor.protectionRemaining = wire.protection / 10;
  actor.respawnRemaining = wire.respawn / 10;
  actor.bombsRemaining = wire.bombs;
  actor.bombCooldown = wire.bombCooldownMs / 1000;
  actor.stats = { knockouts: wire.knockouts, falls: wire.falls, selfFalls: wire.selfFalls };
}

export function battleEvent(wire: EventSnap, state: MatchState, weapons: readonly WeaponDefinition[]): BattleEvent | undefined {
  const at = position(wire);
  const actorId = state.actors[wire.actor]?.config.id;
  const weaponId = (weapons[wire.weapon] ?? state.config.startingWeapon).id;
  const dropId = wire.object;
  switch (wire.kind) {
    case EVENT_PHASE: return { type: 'phase', phase: phaseOf(wire.other) };
    case EVENT_OVERTIME: return { type: 'overtime' };
    case EVENT_DROP_INCOMING: return { type: 'drop-incoming', dropId, weaponId, position: at };
    case EVENT_DROP_LANDED: return { type: 'drop-landed', dropId, weaponId, position: at };
    case EVENT_DROP_EXPIRED: return { type: 'drop-expired', dropId, position: at };
  }
  if (actorId === undefined) return;
  switch (wire.kind) {
    case EVENT_SHOT: return { type: 'shot', actorId, weaponId, position: at };
    case EVENT_RELOAD: return { type: 'reload-start', actorId, weaponId, position: at };
    case EVENT_HIT: return { type: 'hit', actorId, position: at };
    case EVENT_BOMB: return { type: 'bomb', actorId, position: at, bombId: wire.object };
    case EVENT_BOMB_EMPTY: return { type: 'bomb-empty', actorId, position: at };
    case EVENT_EXPLOSION: return { type: 'explosion', source: wire.other === 0 ? 'bomb' : 'rocket', ownerId: actorId, position: at, radius: wire.radius };
    case EVENT_RINGOUT: return { type: 'ringout', actorId, position: at, creditedTo: state.actors[wire.other]?.config.id ?? null };
    case EVENT_RESPAWN: return { type: 'respawn', actorId, position: at };
    case EVENT_PICKUP: return { type: 'pickup', actorId, dropId, weaponId, position: at };
  }
}

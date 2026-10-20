import { ACTOR_HEIGHT, ACTOR_WIDTH, HIT_CREDIT_WINDOW, RESPAWN_DELAY } from '../core/constants';
import { respawnActor } from '../core/actors';
import type { ActorState, BattleEvent, MatchState } from '../core/types';

export function updateLifeTimers(state: MatchState, dt: number, events: BattleEvent[]): void {
  for (const actor of state.actors) {
    actor.protectionRemaining = Math.max(0, actor.protectionRemaining - dt);
    if (actor.status !== 'respawning') continue;
    actor.respawnRemaining = Math.max(0, actor.respawnRemaining - dt);
    if (actor.respawnRemaining <= 1e-8) {
      respawnActor(actor, state);
      events.push({ type: 'respawn', actorId: actor.config.id, position: { ...actor.position } });
    }
  }
}

function isOut(actor: ActorState, state: MatchState): boolean {
  const { left, right, top, bottom } = state.config.map.bounds;
  return actor.position.x + ACTOR_WIDTH / 2 < left
    || actor.position.x - ACTOR_WIDTH / 2 > right
    || actor.position.y < top
    || actor.position.y - ACTOR_HEIGHT > bottom;
}

export function resolveRingouts(state: MatchState, events: BattleEvent[]): void {
  // Process the full batch before MatchSystem determines the winner.
  for (const actor of state.actors) {
    if (actor.status !== 'alive' || !isOut(actor, state)) continue;
    const credit = actor.lastHit && state.elapsed - actor.lastHit.at <= HIT_CREDIT_WINDOW
      ? state.actors.find((other) => other.config.id === actor.lastHit?.by)
      : undefined;
    if (state.config.mode !== 'training') {
      actor.stocks--;
      actor.stats.falls++;
      if (credit) credit.stats.knockouts++;
      else actor.stats.selfFalls++;
    }
    actor.status = actor.stocks > 0 ? 'respawning' : 'eliminated';
    actor.respawnRemaining = state.config.mode === 'training' ? 0.5 : RESPAWN_DELAY;
    events.push({ type: 'ringout', actorId: actor.config.id, position: { ...actor.position }, creditedTo: credit?.config.id ?? null });
  }
}

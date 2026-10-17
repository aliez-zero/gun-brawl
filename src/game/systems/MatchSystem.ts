import { respawnActor } from '../core/actors';
import type { BattleEvent, MatchState } from '../core/types';

function finish(state: MatchState, winner: string | null, events: BattleEvent[]): void {
  state.phase = 'finished';
  state.result = {
    id: state.config.matchId ?? `${state.config.seed}-${state.config.mode}`,
    mode: state.config.mode, winner, duration: state.elapsed, overtime: state.overtime,
    actors: state.actors.map((actor) => ({
      id: actor.config.id, name: actor.config.name, stocks: actor.stocks, ...actor.stats,
    })),
  };
  events.push({ type: 'phase', phase: 'finished' }, { type: 'finished', result: state.result });
}

export function resolveMatch(state: MatchState, events: BattleEvent[]): void {
  if (state.config.mode === 'training' || state.phase !== 'playing') return;
  const remaining = state.actors.filter((actor) => actor.stocks > 0);
  if (remaining.length <= 1) {
    finish(state, remaining[0]?.config.id ?? null, events);
    return;
  }
  if (state.remaining > 1e-8) return;
  if (state.overtime) { finish(state, null, events); return; }

  const best = Math.max(...remaining.map((actor) => actor.stocks));
  const leaders = remaining.filter((actor) => actor.stocks === best);
  if (leaders.length === 1) { finish(state, leaders[0]!.config.id, events); return; }

  state.overtime = true;
  state.remaining = 30;
  state.countdownRemaining = state.config.countdown;
  state.phase = 'countdown';
  state.projectiles = [];
  state.bombs = [];
  const ids = new Set(leaders.map((actor) => actor.config.id));
  for (const actor of state.actors) {
    if (!ids.has(actor.config.id)) { actor.stocks = 0; actor.status = 'eliminated'; }
  }
  for (const actor of leaders) { actor.stocks = 1; respawnActor(actor, state); }
  events.push({ type: 'overtime' }, { type: 'phase', phase: 'countdown' });
}

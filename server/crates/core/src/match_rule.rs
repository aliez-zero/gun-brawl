//! Match resolution, port of `web/src/game/systems/MatchSystem.ts`.

use crate::actor::respawn_actor;
use crate::types::{
    ActorId, ActorResult, ActorStatus, BattleEvent, GameMode, MatchPhase, MatchResult, MatchState,
};

fn finish(state: &mut MatchState, winner: Option<ActorId>, events: &mut Vec<BattleEvent>) {
    let result = MatchResult {
        winner,
        duration: state.elapsed,
        overtime: state.overtime,
        actors: state
            .actors
            .iter()
            .map(|actor| ActorResult {
                id: actor.config.id,
                name: actor.config.name.clone(),
                stocks: actor.stocks,
                knockouts: actor.stats.knockouts,
                falls: actor.stats.falls,
                self_falls: actor.stats.self_falls,
            })
            .collect(),
    };
    state.phase = MatchPhase::Finished;
    state.result = Some(result.clone());
    events.push(BattleEvent::Phase(MatchPhase::Finished));
    events.push(BattleEvent::Finished(result));
}

pub fn resolve_match(state: &mut MatchState, events: &mut Vec<BattleEvent>) {
    if state.config.mode == GameMode::Training || state.phase != MatchPhase::Playing {
        return;
    }
    let remaining: Vec<usize> = (0..state.actors.len())
        .filter(|index| state.actors[*index].stocks > 0)
        .collect();
    if remaining.len() <= 1 {
        let winner = remaining
            .first()
            .map(|index| state.actors[*index].config.id);
        finish(state, winner, events);
        return;
    }
    if state.remaining > 1e-8 {
        return;
    }
    if state.overtime {
        finish(state, None, events);
        return;
    }

    let best = remaining
        .iter()
        .map(|index| state.actors[*index].stocks)
        .max()
        .unwrap_or(0);
    let leaders: Vec<usize> = remaining
        .iter()
        .copied()
        .filter(|index| state.actors[*index].stocks == best)
        .collect();
    if leaders.len() == 1 {
        let winner = state.actors[leaders[0]].config.id;
        finish(state, Some(winner), events);
        return;
    }

    state.overtime = true;
    state.remaining = 30.0;
    state.countdown_remaining = state.config.countdown;
    state.phase = MatchPhase::Countdown;
    state.projectiles.clear();
    state.bombs.clear();
    state.drops.clear();
    let leader_ids: Vec<ActorId> = leaders
        .iter()
        .map(|index| state.actors[*index].config.id)
        .collect();
    for index in 0..state.actors.len() {
        if !leader_ids.contains(&state.actors[index].config.id) {
            state.actors[index].stocks = 0;
            state.actors[index].status = ActorStatus::Eliminated;
        }
    }
    for index in leaders {
        state.actors[index].stocks = 1;
        respawn_actor(state, index);
    }
    events.push(BattleEvent::Overtime);
    events.push(BattleEvent::Phase(MatchPhase::Countdown));
}

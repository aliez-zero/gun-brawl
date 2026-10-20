//! Life timers and ring-outs, port of `web/src/game/systems/LifeSystem.ts`.

use crate::actor::respawn_actor;
use crate::constants::{ACTOR_HEIGHT, ACTOR_WIDTH, HIT_CREDIT_WINDOW, RESPAWN_DELAY};
use crate::types::{ActorStatus, BattleEvent, GameMode, MatchState};

pub fn update_life_timers(state: &mut MatchState, dt: f64, events: &mut Vec<BattleEvent>) {
    for index in 0..state.actors.len() {
        state.actors[index].protection_remaining =
            (state.actors[index].protection_remaining - dt).max(0.0);
        if state.actors[index].status != ActorStatus::Respawning {
            continue;
        }
        state.actors[index].respawn_remaining =
            (state.actors[index].respawn_remaining - dt).max(0.0);
        if state.actors[index].respawn_remaining <= 1e-8 {
            respawn_actor(state, index);
            events.push(BattleEvent::Respawn {
                actor: state.actors[index].config.id,
                position: state.actors[index].position,
            });
        }
    }
}

fn is_out(actor: &crate::types::ActorState, map: &crate::types::MapDef) -> bool {
    let bounds = map.bounds;
    actor.position.x + ACTOR_WIDTH / 2.0 < bounds.left
        || actor.position.x - ACTOR_WIDTH / 2.0 > bounds.right
        || actor.position.y < bounds.top
        || actor.position.y - ACTOR_HEIGHT > bounds.bottom
}

pub fn resolve_ringouts(state: &mut MatchState, events: &mut Vec<BattleEvent>) {
    let training = state.config.mode == GameMode::Training;
    for index in 0..state.actors.len() {
        if state.actors[index].status != ActorStatus::Alive
            || !is_out(&state.actors[index], &state.config.map)
        {
            continue;
        }
        let last_hit = state.actors[index].last_hit;
        let credited_index = last_hit.and_then(|hit| {
            if state.elapsed - hit.at <= HIT_CREDIT_WINDOW {
                state
                    .actors
                    .iter()
                    .position(|actor| actor.config.id == hit.by)
            } else {
                None
            }
        });
        let actor_id = state.actors[index].config.id;
        let position = state.actors[index].position;
        if !training {
            state.actors[index].stocks -= 1;
            state.actors[index].stats.falls += 1;
            if let Some(credit) = credited_index {
                state.actors[credit].stats.knockouts += 1;
            } else {
                state.actors[index].stats.self_falls += 1;
            }
        }
        let stocks = state.actors[index].stocks;
        state.actors[index].status = if stocks > 0 {
            ActorStatus::Respawning
        } else {
            ActorStatus::Eliminated
        };
        state.actors[index].respawn_remaining = if training { 0.5 } else { RESPAWN_DELAY };
        let credited_to = credited_index.map(|credit| state.actors[credit].config.id);
        events.push(BattleEvent::Ringout {
            actor: actor_id,
            position,
            credited_to,
        });
    }
}

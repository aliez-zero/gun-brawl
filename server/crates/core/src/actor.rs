//! Actor construction and respawn, mirroring `web/src/game/core/actors.ts`.

use crate::constants::{BOMB, PROTECTION_TIME};
use crate::math::hypot;
use crate::types::{
    ActorConfig, ActorId, ActorState, ActorStatus, MatchState, Stats, Vec2, WeaponDef, WeaponId,
    WeaponInstance,
};

pub fn create_weapon_instance(weapon_id: WeaponId, definition: &WeaponDef) -> WeaponInstance {
    WeaponInstance {
        weapon: weapon_id,
        ammo: definition.max_ammo.map(i32::from),
        reserve: definition.reserve_ammo.unwrap_or(0) as i32,
    }
}

pub fn create_actor(
    config: ActorConfig,
    spawn: Vec2,
    stocks: i32,
    center_x: f64,
    starting: WeaponId,
    starting_definition: &WeaponDef,
) -> ActorState {
    ActorState {
        config,
        position: spawn,
        previous: spawn,
        move_velocity: 0.0,
        vertical_velocity: 0.0,
        impulse: Vec2::ZERO,
        facing: if spawn.x < center_x { 1 } else { -1 },
        grounded_on: None,
        jumps_remaining: 2,
        coyote_remaining: 0.0,
        jump_buffer: 0.0,
        drop_platform: None,
        drop_remaining: 0.0,
        stocks,
        status: ActorStatus::Alive,
        respawn_remaining: 0.0,
        protection_remaining: PROTECTION_TIME,
        fire_cooldown: 0.0,
        reload_remaining: 0.0,
        weapon: create_weapon_instance(starting, starting_definition),
        bombs_remaining: BOMB.per_life,
        bomb_cooldown: 0.0,
        last_hit: None,
        stats: Stats::default(),
    }
}

fn best_spawn(spawns: &[Vec2], others: &[Vec2]) -> Vec2 {
    let mut best = spawns.first().copied().unwrap_or(Vec2::ZERO);
    let mut best_distance = -1.0;
    for point in spawns {
        let nearest = if others.is_empty() {
            f64::INFINITY
        } else {
            others
                .iter()
                .map(|other| hypot(other.x - point.x, other.y - point.y))
                .fold(f64::INFINITY, f64::min)
        };
        if nearest > best_distance {
            best = *point;
            best_distance = nearest;
        }
    }
    best
}

/// Rebuild one actor in place, keeping stocks and stats like the TS `Object.assign`.
pub fn respawn_actor(state: &mut MatchState, index: usize) {
    let others: Vec<Vec2> = state
        .actors
        .iter()
        .enumerate()
        .filter(|(other_index, actor)| *other_index != index && actor.status == ActorStatus::Alive)
        .map(|(_, actor)| actor.position)
        .collect();
    let spawn = best_spawn(&state.config.map.spawns, &others);
    let center_x = state.config.map.width / 2.0;
    let starting = state.config.starting_weapon;
    let definition = state.config.weapons[starting as usize].clone();
    let config = state.actors[index].config.clone();
    let stocks = state.actors[index].stocks;
    let stats = state.actors[index].stats;
    let mut fresh = create_actor(config, spawn, stocks, center_x, starting, &definition);
    fresh.stats = stats;
    state.actors[index] = fresh;
}

/// Ids of every living actor except `index`; used by spawn selection and tests.
pub fn living_others(state: &MatchState, index: usize) -> Vec<ActorId> {
    state
        .actors
        .iter()
        .enumerate()
        .filter(|(other_index, actor)| *other_index != index && actor.status == ActorStatus::Alive)
        .map(|(_, actor)| actor.config.id)
        .collect()
}

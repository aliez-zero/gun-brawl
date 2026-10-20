//! Bomb runtime, port of `web/src/game/systems/GrenadeSystem.ts`.

use crate::combat::{apply_explosion_hits, resolve_explosion};
use crate::constants::BOMB;
use crate::types::{
    ActorState, ActorStatus, BattleEvent, Bomb, ExplosionRequest, ExplosionSource, InputTable,
    MapDef, MatchState, Platform, Vec2,
};

fn horizontal_overlap(x: f64, radius: f64, platform: &Platform) -> bool {
    x + radius > platform.x && x - radius < platform.x + platform.width
}

fn vertical_overlap(y: f64, radius: f64, platform: &Platform) -> bool {
    y + radius > platform.y && y - radius < platform.y + platform.height
}

fn bounce(speed: f64) -> f64 {
    let next = -speed * BOMB.bounce;
    if next.abs() < BOMB.min_bounce_speed {
        0.0
    } else {
        next
    }
}

fn throw_bomb(
    actor: &mut ActorState,
    bombs: &mut Vec<Bomb>,
    events: &mut Vec<BattleEvent>,
    next_bomb: &mut u32,
) {
    if actor.bomb_cooldown > 0.0 {
        return;
    }
    let active = bombs
        .iter()
        .filter(|bomb| bomb.owner == actor.config.id)
        .count();
    if actor.bombs_remaining == 0 || active >= BOMB.max_active {
        events.push(BattleEvent::BombEmpty {
            actor: actor.config.id,
            position: actor.position,
        });
        return;
    }
    let position = Vec2 {
        x: actor.position.x + actor.facing as f64 * BOMB.throw_offset_x,
        y: actor.position.y - BOMB.throw_offset_y,
    };
    actor.bombs_remaining -= 1;
    actor.bomb_cooldown = BOMB.cooldown;
    actor.protection_remaining = 0.0;
    bombs.push(Bomb {
        id: *next_bomb,
        owner: actor.config.id,
        position,
        previous: position,
        velocity: Vec2 {
            x: actor.facing as f64 * BOMB.throw_velocity_x,
            y: BOMB.throw_velocity_y,
        },
        fuse_remaining: BOMB.fuse,
        radius: BOMB.body_radius,
    });
    events.push(BattleEvent::Bomb {
        actor: actor.config.id,
        position,
        bomb_id: *next_bomb,
    });
    *next_bomb += 1;
}

fn step_bomb(bomb: &mut Bomb, map: &MapDef, dt: f64) {
    bomb.previous = bomb.position;
    let radius = bomb.radius;
    let old_x = bomb.position.x;
    bomb.position.x += bomb.velocity.x * dt;
    for platform in &map.platforms {
        if platform.kind != crate::types::PlatformKind::Solid {
            continue;
        }
        if !vertical_overlap(bomb.position.y, radius, platform) {
            continue;
        }
        if bomb.velocity.x > 0.0
            && old_x + radius <= platform.x + 0.01
            && bomb.position.x + radius >= platform.x
        {
            bomb.position.x = platform.x - radius;
            bomb.velocity.x = bounce(bomb.velocity.x);
            break;
        }
        if bomb.velocity.x < 0.0
            && old_x - radius >= platform.x + platform.width - 0.01
            && bomb.position.x - radius <= platform.x + platform.width
        {
            bomb.position.x = platform.x + platform.width + radius;
            bomb.velocity.x = bounce(bomb.velocity.x);
            break;
        }
    }

    let old_y = bomb.position.y;
    bomb.velocity.y += BOMB.gravity * dt;
    bomb.position.y += bomb.velocity.y * dt;
    for platform in &map.platforms {
        if !horizontal_overlap(bomb.position.x, radius, platform) {
            continue;
        }
        let old_bottom = old_y + radius;
        let new_bottom = bomb.position.y + radius;
        if bomb.velocity.y >= 0.0 && old_bottom <= platform.y + 0.01 && new_bottom >= platform.y {
            bomb.position.y = platform.y - radius;
            bomb.velocity.y = bounce(bomb.velocity.y);
            break;
        }
        if platform.kind == crate::types::PlatformKind::Solid
            && bomb.velocity.y < 0.0
            && old_y - radius >= platform.y + platform.height - 0.01
            && bomb.position.y - radius < platform.y + platform.height
        {
            bomb.position.y = platform.y + platform.height + radius;
            bomb.velocity.y = bounce(bomb.velocity.y);
            break;
        }
    }
    bomb.fuse_remaining -= dt;
}

fn explode_bomb(
    map: &MapDef,
    actors: &mut [ActorState],
    elapsed: f64,
    bomb: &Bomb,
    events: &mut Vec<BattleEvent>,
) {
    let request = ExplosionRequest {
        owner: bomb.owner,
        source: ExplosionSource::Bomb,
        center: bomb.position,
        radius: BOMB.radius,
        center_impulse: BOMB.center_impulse,
        edge_impulse: BOMB.edge_impulse,
        direction: None,
    };
    let hits = resolve_explosion(map, actors, &request);
    apply_explosion_hits(actors, elapsed, &request, &hits, events);
    events.push(BattleEvent::Explosion {
        source: ExplosionSource::Bomb,
        owner: bomb.owner,
        position: bomb.position,
        radius: BOMB.radius,
    });
}

pub fn update_grenades(
    state: &mut MatchState,
    inputs: &InputTable,
    dt: f64,
    events: &mut Vec<BattleEvent>,
    next_bomb: &mut u32,
) {
    let MatchState {
        config,
        actors,
        bombs,
        elapsed,
        ..
    } = state;
    let map = &config.map;

    for actor in actors.iter_mut() {
        actor.bomb_cooldown = (actor.bomb_cooldown - dt).max(0.0);
    }
    for (index, actor) in actors.iter_mut().enumerate() {
        if actor.status != ActorStatus::Alive {
            continue;
        }
        let pressed = inputs
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|input| input.bomb_pressed);
        if pressed {
            throw_bomb(actor, bombs, events, next_bomb);
        }
    }

    let mut survivors: Vec<Bomb> = Vec::with_capacity(bombs.len());
    for mut bomb in bombs.drain(..) {
        step_bomb(&mut bomb, map, dt);
        if bomb.fuse_remaining <= 0.0 {
            explode_bomb(map, actors, *elapsed, &bomb, events);
        } else {
            survivors.push(bomb);
        }
    }
    *bombs = survivors;
}

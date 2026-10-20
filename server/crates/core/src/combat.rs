//! Weapons, firing, projectiles and explosions.
//!
//! Port of `WeaponSystem.ts`, `CombatSystem.ts` and `ExplosionSystem.ts`. The
//! systems stay as free functions over `MatchState` so the room loop owns all
//! mutable state and can reuse buffers.

use crate::constants::{ACTOR_HEIGHT, ACTOR_WIDTH, MOVEMENT};
use crate::math::{actor_rect, add_impulse, cos, hypot, segment_rect, sin};
use crate::types::{
    ActorState, ActorStatus, BattleEvent, ExplosionProfile, ExplosionRequest, ExplosionSource,
    InputTable, MapDef, MatchState, PlatformKind, Projectile, Vec2, WeaponDef, WeaponId,
    WeaponInstance,
};

pub fn has_ammo(actor: &ActorState) -> bool {
    actor.weapon.ammo.is_none_or(|ammo| ammo > 0)
}

pub fn can_reload(actor: &ActorState, definition: &WeaponDef) -> bool {
    match (definition.max_ammo, actor.weapon.ammo) {
        (Some(maximum), Some(magazine)) => {
            magazine < maximum as i32 && actor.weapon.reserve > 0 && actor.reload_remaining <= 1e-8
        }
        _ => false,
    }
}

pub fn finish_reload(actor: &mut ActorState, definition: &WeaponDef) {
    let (Some(maximum), Some(magazine)) = (definition.max_ammo, actor.weapon.ammo) else {
        actor.reload_remaining = 0.0;
        return;
    };
    let missing = (maximum as i32 - magazine).max(0);
    let loaded = missing.min(actor.weapon.reserve);
    actor.weapon.ammo = Some(magazine + loaded);
    actor.weapon.reserve -= loaded;
    actor.reload_remaining = 0.0;
}

pub fn start_reload(actor: &mut ActorState, definition: &WeaponDef) -> bool {
    if !can_reload(actor, definition) {
        return false;
    }
    let time = definition.reload_time.unwrap_or(1.5);
    actor.reload_remaining = time.max(0.0);
    if actor.reload_remaining <= 1e-8 {
        finish_reload(actor, definition);
    }
    true
}

pub fn tick_reload(actor: &mut ActorState, definition: &WeaponDef, dt: f64) -> bool {
    if actor.reload_remaining <= 1e-8 {
        return false;
    }
    actor.reload_remaining = (actor.reload_remaining - dt).max(0.0);
    if actor.reload_remaining <= 1e-8 {
        finish_reload(actor, definition);
    }
    actor.reload_remaining > 1e-8
}

pub fn equip_weapon(actor: &mut ActorState, weapon: WeaponId, definition: &WeaponDef) {
    actor.weapon = WeaponInstance {
        weapon,
        ammo: definition.max_ammo.map(i32::from),
        reserve: definition.reserve_ammo.unwrap_or(0) as i32,
    };
    actor.reload_remaining = 0.0;
}

pub fn refill_weapon(actor: &mut ActorState, definition: &WeaponDef) {
    actor.weapon.ammo = definition.max_ammo.map(i32::from);
    actor.weapon.reserve = definition.reserve_ammo.unwrap_or(0) as i32;
    actor.reload_remaining = 0.0;
}

pub fn revert_to_pistol(actor: &mut ActorState, pistol: WeaponId, definition: &WeaponDef) {
    equip_weapon(actor, pistol, definition);
}

fn explosion_target(actor: &ActorState) -> Vec2 {
    Vec2 {
        x: actor.position.x,
        y: actor.position.y - ACTOR_HEIGHT / 2.0,
    }
}

fn explosion_center_on_segment(from: Vec2, to: Vec2, fraction: f64) -> Vec2 {
    Vec2 {
        x: from.x + (to.x - from.x) * fraction,
        y: from.y + (to.y - from.y) * fraction,
    }
}

/// Shared by bombs and rockets: reads state, returns the impulses to apply.
pub fn resolve_explosion(
    map: &MapDef,
    actors: &[ActorState],
    request: &ExplosionRequest,
) -> Vec<(u8, Vec2)> {
    let mut hits = Vec::with_capacity(4);
    for actor in actors {
        if actor.status != ActorStatus::Alive || actor.protection_remaining > 0.0 {
            continue;
        }
        let target = explosion_target(actor);
        let dx = target.x - request.center.x;
        let dy = target.y - request.center.y;
        let distance = hypot(dx, dy);
        if distance > request.radius + 1e-8 {
            continue;
        }
        if blocked(map, request.center, target) {
            continue;
        }
        let t = if request.radius <= 1e-8 {
            0.0
        } else {
            (distance / request.radius).min(1.0)
        };
        let magnitude =
            request.center_impulse + (request.edge_impulse - request.center_impulse) * t;
        let mut direction = if distance <= 1e-8 {
            Vec2 { x: 0.0, y: -1.0 }
        } else {
            Vec2 {
                x: dx / distance,
                y: dy / distance,
            }
        };
        if let Some(direction_hint) = request.direction {
            if distance <= ACTOR_WIDTH {
                let length = hypot(direction_hint.x, direction_hint.y);
                if length > 1e-8 {
                    direction = Vec2 {
                        x: direction_hint.x / length,
                        y: direction_hint.y / length,
                    };
                }
            }
        }
        hits.push((
            actor.config.id,
            Vec2 {
                x: direction.x * magnitude,
                y: direction.y * magnitude,
            },
        ));
    }
    hits
}

fn blocked(map: &MapDef, from: Vec2, to: Vec2) -> bool {
    map.platforms
        .iter()
        .filter(|platform| platform.kind == PlatformKind::Solid)
        .any(|platform| segment_rect(from, to, platform.rect()).is_some())
}

pub fn apply_explosion_hits(
    actors: &mut [ActorState],
    elapsed: f64,
    request: &ExplosionRequest,
    hits: &[(u8, Vec2)],
    events: &mut Vec<BattleEvent>,
) {
    for (actor_id, impulse) in hits {
        let Some(actor) = actors.iter_mut().find(|actor| actor.config.id == *actor_id) else {
            continue;
        };
        if actor.status != ActorStatus::Alive || actor.protection_remaining > 0.0 {
            continue;
        }
        let cap = MOVEMENT.max_impulse.max(hypot(impulse.x, impulse.y));
        add_impulse(actor, impulse.x, impulse.y, cap);
        if actor.config.id != request.owner {
            actor.last_hit = Some(crate::types::LastHit {
                by: request.owner,
                at: elapsed,
            });
        }
        events.push(BattleEvent::Hit {
            actor: actor.config.id,
            position: Vec2 {
                x: actor.position.x,
                y: actor.position.y - 28.0,
            },
        });
    }
}

#[allow(clippy::too_many_arguments)]
fn explode_at(
    map: &MapDef,
    actors: &mut [ActorState],
    elapsed: f64,
    owner: u8,
    center: Vec2,
    profile: ExplosionProfile,
    direction: Option<Vec2>,
    events: &mut Vec<BattleEvent>,
) {
    let request = ExplosionRequest {
        owner,
        source: ExplosionSource::Rocket,
        center,
        radius: profile.radius,
        center_impulse: profile.center_impulse,
        edge_impulse: profile.edge_impulse,
        direction,
    };
    let hits = resolve_explosion(map, actors, &request);
    apply_explosion_hits(actors, elapsed, &request, &hits, events);
    events.push(BattleEvent::Explosion {
        source: ExplosionSource::Rocket,
        owner,
        position: center,
        radius: profile.radius,
    });
}

pub fn update_combat(
    state: &mut MatchState,
    inputs: &InputTable,
    dt: f64,
    events: &mut Vec<BattleEvent>,
    next_projectile: &mut u32,
) {
    let MatchState {
        config,
        actors,
        projectiles,
        elapsed,
        ..
    } = state;
    let weapons = &config.weapons;
    let pistol = config.pistol;
    let pistol_interval = weapons[pistol as usize].interval;

    for (index, actor) in actors.iter_mut().enumerate() {
        actor.fire_cooldown = (actor.fire_cooldown - dt).max(0.0);
        if actor.status != ActorStatus::Alive {
            continue;
        }
        let definition = &weapons[actor.weapon.weapon as usize];
        tick_reload(actor, definition, dt);
        let Some(input) = inputs.get(index).copied().flatten() else {
            continue;
        };
        if input.reload_pressed && start_reload(actor, definition) {
            events.push(BattleEvent::ReloadStart {
                actor: actor.config.id,
                position: actor.position,
                weapon: actor.weapon.weapon,
            });
        }
        if !input.shoot_held || actor.fire_cooldown > 1e-8 || actor.reload_remaining > 1e-8 {
            continue;
        }
        if !has_ammo(actor) {
            if start_reload(actor, definition) {
                events.push(BattleEvent::ReloadStart {
                    actor: actor.config.id,
                    position: actor.position,
                    weapon: actor.weapon.weapon,
                });
                continue;
            }
            revert_to_pistol(actor, pistol, &weapons[pistol as usize]);
            actor.fire_cooldown = actor.fire_cooldown.max(pistol_interval);
            continue;
        }

        let weapon_id = actor.weapon.weapon;
        let weapon = &weapons[weapon_id as usize];
        let ammo = actor.weapon.ammo;
        actor.protection_remaining = 0.0;
        actor.fire_cooldown = weapon.interval;
        let muzzle = weapon.muzzle;
        let position = Vec2 {
            x: actor.position.x + actor.facing as f64 * muzzle.x,
            y: actor.position.y + muzzle.y,
        };
        let pellets = weapon.pellets.max(1);
        for pellet in 0..pellets {
            let spread = if pellets == 1 {
                0.0
            } else {
                ((pellet as f64 / (pellets - 1) as f64) * 2.0 - 1.0) * weapon.spread_radians
            };
            let direction = actor.facing as f64;
            projectiles.push(Projectile {
                id: *next_projectile,
                owner: actor.config.id,
                weapon: weapon_id,
                position,
                previous: position,
                origin: Some(position),
                direction: actor.facing,
                velocity: Vec2 {
                    x: cos(spread) * weapon.projectile_speed * direction,
                    y: sin(spread) * weapon.projectile_speed,
                },
                impulse: Vec2 {
                    x: direction * weapon.knockback,
                    y: -weapon.knockback * 0.2,
                },
                distance_remaining: weapon.range,
                explosion: weapon.explosion,
                impulse_cap: weapon.impulse_cap,
            });
            *next_projectile += 1;
        }
        add_impulse(
            actor,
            -(actor.facing as f64) * weapon.recoil,
            -(weapon.recoil_y.unwrap_or(0.0)),
            MOVEMENT.max_impulse,
        );
        events.push(BattleEvent::Shot {
            actor: actor.config.id,
            position,
            weapon: weapon_id,
        });

        if let Some(remaining) = ammo {
            actor.weapon.ammo = Some(remaining - 1);
            if actor.weapon.ammo == Some(0) {
                let current = actor.weapon.weapon;
                if actor.weapon.reserve > 0 {
                    if start_reload(actor, &weapons[current as usize]) {
                        events.push(BattleEvent::ReloadStart {
                            actor: actor.config.id,
                            position: actor.position,
                            weapon: current,
                        });
                    }
                } else {
                    revert_to_pistol(actor, pistol, &weapons[pistol as usize]);
                    actor.fire_cooldown = actor.fire_cooldown.max(pistol_interval);
                }
            }
        }
    }

    update_projectiles(config, actors, projectiles, *elapsed, dt, events);
}

fn update_projectiles(
    config: &crate::types::MatchConfig,
    actors: &mut [ActorState],
    projectiles: &mut Vec<Projectile>,
    elapsed: f64,
    dt: f64,
    events: &mut Vec<BattleEvent>,
) {
    let map = &config.map;
    let mut write = 0usize;
    for read in 0..projectiles.len() {
        let keep = {
            let projectile = &mut projectiles[read];
            projectile.previous = projectile.position;
            let speed = hypot(projectile.velocity.x, projectile.velocity.y);
            if speed <= 1e-8 {
                false
            } else {
                let distance = (speed * dt).min(projectile.distance_remaining);
                let to = Vec2 {
                    x: projectile.position.x + (projectile.velocity.x / speed) * distance,
                    y: projectile.position.y + (projectile.velocity.y / speed) * distance,
                };
                let mut closest = f64::INFINITY;
                let mut target: Option<usize> = None;
                for platform in &map.platforms {
                    if platform.kind != PlatformKind::Solid {
                        continue;
                    }
                    if let Some(hit) = segment_rect(projectile.position, to, platform.rect()) {
                        if hit < closest {
                            closest = hit;
                            target = None;
                        }
                    }
                }
                for (index, actor) in actors.iter().enumerate() {
                    if actor.status != ActorStatus::Alive || actor.config.id == projectile.owner {
                        continue;
                    }
                    if let Some(hit) = segment_rect(projectile.position, to, actor_rect(actor)) {
                        if hit < closest {
                            closest = hit;
                            target = Some(index);
                        }
                    }
                }

                if closest.is_finite() {
                    if let Some(profile) = projectile.explosion {
                        let impact = explosion_center_on_segment(projectile.position, to, closest);
                        let owner = projectile.owner;
                        let direction = Some(projectile.velocity);
                        explode_at(
                            map, actors, elapsed, owner, impact, profile, direction, events,
                        );
                    } else if let Some(index) = target {
                        let target_actor = &mut actors[index];
                        if target_actor.protection_remaining <= 0.0 {
                            let cap = projectile.impulse_cap.unwrap_or_else(|| {
                                MOVEMENT
                                    .max_impulse
                                    .max(hypot(projectile.impulse.x, projectile.impulse.y))
                            });
                            add_impulse(
                                target_actor,
                                projectile.impulse.x,
                                projectile.impulse.y,
                                cap,
                            );
                            target_actor.last_hit = Some(crate::types::LastHit {
                                by: projectile.owner,
                                at: elapsed,
                            });
                            events.push(BattleEvent::Hit {
                                actor: target_actor.config.id,
                                position: Vec2 {
                                    x: target_actor.position.x,
                                    y: target_actor.position.y - 28.0,
                                },
                            });
                        }
                    }
                    false
                } else {
                    projectiles[read].position = to;
                    projectiles[read].distance_remaining -= distance;
                    if projectiles[read].distance_remaining <= 1e-8 {
                        if let Some(profile) = projectiles[read].explosion {
                            let owner = projectiles[read].owner;
                            let direction = Some(projectiles[read].velocity);
                            explode_at(map, actors, elapsed, owner, to, profile, direction, events);
                        }
                        false
                    } else {
                        true
                    }
                }
            }
        };
        if keep {
            if write != read {
                projectiles.swap(write, read);
            }
            write += 1;
        }
    }
    projectiles.truncate(write);
}

/// Used by the room/HUD: one trigger's total impulse.
pub fn weapon_burst_impulse(weapon: &WeaponDef) -> f64 {
    if let Some(explosion) = weapon.explosion {
        explosion.center_impulse
    } else {
        weapon.knockback * weapon.pellets.max(1) as f64
    }
}

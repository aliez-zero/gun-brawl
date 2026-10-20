//! Platform navigation and the three bot difficulties.
//!
//! Port of `web/src/game/ai/Navigation.ts` and `BotController.ts`. The bot only
//! produces `ActorInput`, exactly like a human client, so the server applies the
//! same movement, ammo, knockback and ring-out rules to both.

use std::cmp::Ordering;
use std::collections::VecDeque;

use gunbrawl_core::math::hypot;
use gunbrawl_core::random::Random;
use gunbrawl_core::types::{
    ActorInput, ActorState, ActorStatus, Difficulty, DropState, MapDef, MatchPhase, MatchState,
    Platform, Vec2,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavAction {
    Walk,
    Jump,
    Drop,
}

#[derive(Debug, Clone, Copy)]
pub struct NavStep {
    pub platform: usize,
    pub action: NavAction,
}

fn horizontal_gap(a: &Platform, b: &Platform) -> f64 {
    (a.x - (b.x + b.width)).max(b.x - (a.x + a.width)).max(0.0)
}

pub fn platform_at(map: &MapDef, x: f64, y: f64) -> Option<usize> {
    let mut candidates: Vec<usize> = map
        .platforms
        .iter()
        .enumerate()
        .filter(|(_, platform)| {
            x >= platform.x - 8.0
                && x <= platform.x + platform.width + 8.0
                && (platform.y - y).abs() <= 42.0
        })
        .map(|(index, _)| index)
        .collect();
    candidates.sort_by(|left, right| {
        let a = (map.platforms[*left].y - y).abs();
        let b = (map.platforms[*right].y - y).abs();
        a.partial_cmp(&b).unwrap_or(Ordering::Equal)
    });
    candidates.first().copied()
}

pub fn platform_for_actor(map: &MapDef, actor: &ActorState) -> Option<usize> {
    if let Some(grounded) = actor.grounded_on {
        if (grounded as usize) < map.platforms.len() {
            return Some(grounded as usize);
        }
    }
    platform_at(map, actor.position.x, actor.position.y)
}

pub fn nearest_platform(map: &MapDef, x: f64, y: f64) -> Option<usize> {
    let mut indices: Vec<usize> = (0..map.platforms.len()).collect();
    indices.sort_by(|left, right| {
        let a = &map.platforms[*left];
        let b = &map.platforms[*right];
        let ax = (a.x - x).max(0.0).max(x - (a.x + a.width));
        let bx = (b.x - x).max(0.0).max(x - (b.x + b.width));
        let score_a = ax + (a.y - y).abs() * 0.35;
        let score_b = bx + (b.y - y).abs() * 0.35;
        score_a.partial_cmp(&score_b).unwrap_or(Ordering::Equal)
    });
    indices.first().copied()
}

fn edge_action(from: &Platform, to: &Platform) -> Option<NavAction> {
    let gap = horizontal_gap(from, to);
    if gap > 240.0 {
        return None;
    }
    if to.y < from.y - 24.0 {
        return if from.y - to.y <= 220.0 {
            Some(NavAction::Jump)
        } else {
            None
        };
    }
    if to.y > from.y + 24.0 {
        return if to.y - from.y <= 360.0 {
            Some(NavAction::Drop)
        } else {
            None
        };
    }
    Some(if gap <= 12.0 {
        NavAction::Walk
    } else {
        NavAction::Jump
    })
}

/// Breadth-first route across platform landing edges.
pub fn plan_route(map: &MapDef, from: usize, to: usize) -> Vec<NavStep> {
    if from == to || from >= map.platforms.len() || to >= map.platforms.len() {
        return Vec::new();
    }
    let goal = &map.platforms[to];
    let goal_center_x = goal.x + goal.width / 2.0;
    let goal_y = goal.y;

    let mut queue: VecDeque<usize> = VecDeque::new();
    queue.push_back(from);
    let mut seen = vec![false; map.platforms.len()];
    seen[from] = true;
    let mut previous: Vec<Option<(usize, NavAction)>> = vec![None; map.platforms.len()];

    while let Some(current) = queue.pop_front() {
        let mut next: Vec<usize> = (0..map.platforms.len())
            .filter(|index| !seen[*index])
            .collect();
        next.sort_by(|left, right| {
            let distance = |index: usize| {
                let platform = &map.platforms[index];
                hypot(
                    platform.x + platform.width / 2.0 - goal_center_x,
                    platform.y - goal_y,
                )
            };
            distance(*left)
                .partial_cmp(&distance(*right))
                .unwrap_or(Ordering::Equal)
        });
        for candidate in next {
            let action = match edge_action(&map.platforms[current], &map.platforms[candidate]) {
                Some(action) => action,
                None => continue,
            };
            seen[candidate] = true;
            previous[candidate] = Some((current, action));
            if candidate == to {
                let mut steps = Vec::new();
                let mut cursor = candidate;
                while cursor != from {
                    let Some((parent, step_action)) = previous[cursor] else {
                        break;
                    };
                    steps.push(NavStep {
                        platform: cursor,
                        action: step_action,
                    });
                    cursor = parent;
                }
                steps.reverse();
                return steps;
            }
            queue.push_back(candidate);
        }
    }
    Vec::new()
}

#[derive(Debug, Clone, Copy)]
struct Profile {
    reaction: f64,
    approach: f64,
    preferred: f64,
    fire_range: f64,
    bomb_chance: f64,
}

fn profile(difficulty: Difficulty) -> Profile {
    match difficulty {
        Difficulty::Easy => Profile {
            reaction: 0.5,
            approach: 380.0,
            preferred: 0.0,
            fire_range: 420.0,
            bomb_chance: 0.2,
        },
        Difficulty::Normal => Profile {
            reaction: 0.3,
            approach: 280.0,
            preferred: 0.0,
            fire_range: 620.0,
            bomb_chance: 0.45,
        },
        Difficulty::Hard => Profile {
            reaction: 0.18,
            approach: 180.0,
            preferred: 220.0,
            fire_range: 760.0,
            bomb_chance: 0.75,
        },
    }
}

pub struct BotController {
    difficulty: Difficulty,
    profile: Profile,
    remaining: f64,
    held: ActorInput,
    climb_target: Option<u8>,
    last_position: Option<Vec2>,
    stuck_time: f64,
    random: Random,
}

impl BotController {
    pub fn new(difficulty: Difficulty, seed: u32) -> Self {
        Self {
            difficulty,
            profile: profile(difficulty),
            remaining: 0.0,
            held: ActorInput::IDLE,
            climb_target: None,
            last_position: None,
            stuck_time: 0.0,
            random: Random::new(seed),
        }
    }

    pub fn sample(&mut self, actor_index: usize, state: &MatchState, dt: f64) -> ActorInput {
        let actor = &state.actors[actor_index];
        if actor.status != ActorStatus::Alive || state.phase != MatchPhase::Playing {
            self.climb_target = None;
            return ActorInput::IDLE;
        }
        if let Some(last) = self.last_position {
            if hypot(actor.position.x - last.x, actor.position.y - last.y) < 0.5 {
                self.stuck_time += dt;
            } else {
                self.stuck_time = 0.0;
            }
        }
        self.last_position = Some(actor.position);
        if self.stuck_time > 1.0 {
            self.climb_target = None;
            self.stuck_time = 0.0;
        }
        self.remaining -= dt;
        if self.remaining > 0.0 {
            let mut held = self.held;
            held.jump_pressed = false;
            held.drop_pressed = false;
            held.bomb_pressed = false;
            held.reload_pressed = false;
            return held;
        }
        self.remaining = self.profile.reaction * (0.85 + self.random.next_f64() * 0.3);

        let mut target: Option<usize> = None;
        let mut best_distance = f64::INFINITY;
        for (index, other) in state.actors.iter().enumerate() {
            if index == actor_index || other.status != ActorStatus::Alive {
                continue;
            }
            let distance = hypot(
                other.position.x - actor.position.x,
                other.position.y - actor.position.y,
            );
            if distance < best_distance {
                best_distance = distance;
                target = Some(index);
            }
        }
        let Some(target) = target else {
            return ActorInput::IDLE;
        };
        let target_actor = &state.actors[target];
        let dx = target_actor.position.x - actor.position.x;
        let dy = target_actor.position.y - actor.position.y;
        let distance = dx.abs();

        let mut move_x: i8 = 0;
        if self.difficulty == Difficulty::Hard && distance < self.profile.preferred {
            move_x = if dx > 0.0 { -1 } else { 1 };
        } else if distance > self.profile.approach {
            move_x = if dx > 0.0 { 1 } else { -1 };
        }
        if distance > 20.0 && actor.facing as f64 != dx.signum() {
            move_x = if dx > 0.0 { 1 } else { -1 };
        }

        // Recovery always outranks pursuing a target beyond an arena edge.
        let lowest_level = state
            .config
            .map
            .platforms
            .iter()
            .map(|platform| platform.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let recovery_indices: Vec<usize> = (0..state.config.map.platforms.len())
            .filter(|index| state.config.map.platforms[*index].y >= lowest_level - 80.0)
            .collect();
        let horizontal_distance = |index: usize| -> f64 {
            let platform = &state.config.map.platforms[index];
            (platform.x + 30.0 - actor.position.x)
                .max(actor.position.x - (platform.x + platform.width - 30.0))
                .max(0.0)
        };
        let safe = recovery_indices.iter().any(|index| {
            let platform = &state.config.map.platforms[*index];
            horizontal_distance(*index) == 0.0 && actor.position.y <= platform.y + 35.0
        });
        let mut recovery_sorted = recovery_indices.clone();
        recovery_sorted.sort_by(|left, right| {
            let a = &state.config.map.platforms[*left];
            let b = &state.config.map.platforms[*right];
            let score_a = horizontal_distance(*left) + (a.y - actor.position.y).abs() * 0.2;
            let score_b = horizontal_distance(*right) + (b.y - actor.position.y).abs() * 0.2;
            score_a.partial_cmp(&score_b).unwrap_or(Ordering::Equal)
        });
        let recovery = recovery_sorted.first().copied();
        let endangered = !safe;
        if endangered {
            if let Some(index) = recovery {
                let platform = &state.config.map.platforms[index];
                move_x = if actor.position.x < platform.x + platform.width / 2.0 {
                    1
                } else {
                    -1
                };
            }
            self.climb_target = None;
        }

        // A live bomb outranks the target.
        let threat = state
            .bombs
            .iter()
            .filter(|bomb| {
                bomb.fuse_remaining < 1.0
                    && hypot(
                        bomb.position.x - actor.position.x,
                        bomb.position.y - actor.position.y,
                    ) < bomb.radius * 0.9
            })
            .min_by(|left, right| {
                left.fuse_remaining
                    .partial_cmp(&right.fuse_remaining)
                    .unwrap_or(Ordering::Equal)
            });
        if let Some(threat) = threat {
            let away = if actor.position.x == threat.position.x {
                -actor.facing
            } else if actor.position.x < threat.position.x {
                -1
            } else {
                1
            };
            self.held = ActorInput {
                move_x: away,
                jump_pressed: actor.grounded_on.is_some() && actor.jumps_remaining > 0,
                drop_pressed: false,
                shoot_held: false,
                bomb_pressed: false,
                reload_pressed: false,
            };
            return self.held;
        }

        // Take a nearby crate before resuming the duel.
        let crate_drop = state
            .drops
            .iter()
            .filter(|drop| drop.state == DropState::Active)
            .min_by(|left, right| {
                let a = hypot(
                    left.position.x - actor.position.x,
                    left.position.y - actor.position.y,
                );
                let b = hypot(
                    right.position.x - actor.position.x,
                    right.position.y - actor.position.y,
                );
                a.partial_cmp(&b).unwrap_or(Ordering::Equal)
            });
        if let Some(drop) = crate_drop {
            if !endangered
                && hypot(
                    drop.position.x - actor.position.x,
                    drop.position.y - actor.position.y,
                ) < 340.0
            {
                let crate_x = drop.position.x - actor.position.x;
                self.held = ActorInput {
                    move_x: if crate_x.abs() < 10.0 {
                        0
                    } else if crate_x > 0.0 {
                        1
                    } else {
                        -1
                    },
                    jump_pressed: drop.position.y < actor.position.y - 70.0
                        && actor.grounded_on.is_some()
                        && actor.jumps_remaining > 0,
                    drop_pressed: false,
                    shoot_held: false,
                    bomb_pressed: false,
                    reload_pressed: false,
                };
                return self.held;
            }
        }

        // Platform graph route: jump gaps or drop decks before resuming the duel.
        let actor_platform = platform_for_actor(&state.config.map, actor);
        let target_platform = platform_for_actor(&state.config.map, target_actor).or_else(|| {
            nearest_platform(
                &state.config.map,
                target_actor.position.x,
                target_actor.position.y,
            )
        });
        if !endangered && target_actor.position.y >= actor.position.y - 10.0 {
            if let (Some(from), Some(to)) = (actor_platform, target_platform) {
                if from != to {
                    let route = plan_route(&state.config.map, from, to);
                    if let Some(step) = route.first() {
                        let platform = &state.config.map.platforms[step.platform];
                        let center = platform.x + platform.width / 2.0;
                        let route_dx = center - actor.position.x;
                        self.held = ActorInput {
                            move_x: if route_dx.abs() < 10.0 {
                                0
                            } else if route_dx > 0.0 {
                                1
                            } else {
                                -1
                            },
                            jump_pressed: step.action == NavAction::Jump
                                && actor.grounded_on.is_some()
                                && actor.jumps_remaining > 0,
                            drop_pressed: step.action == NavAction::Drop
                                && actor.grounded_on.is_some(),
                            shoot_held: false,
                            bomb_pressed: false,
                            reload_pressed: false,
                        };
                        return self.held;
                    }
                }
            }
        }

        // Keep a landing point while jumping.
        if actor.grounded_on == self.climb_target {
            self.climb_target = None;
        }
        if self.climb_target.is_none() && dy < -55.0 && actor.grounded_on.is_some() {
            let mut upper: Vec<usize> = (0..state.config.map.platforms.len())
                .filter(|index| {
                    let platform = &state.config.map.platforms[*index];
                    platform.y < actor.position.y - 30.0 && platform.y >= actor.position.y - 170.0
                })
                .collect();
            upper.sort_by(|left, right| {
                let a = &state.config.map.platforms[*left];
                let b = &state.config.map.platforms[*right];
                let score_a = horizontal_distance(*left)
                    + (a.x + a.width / 2.0 - target_actor.position.x).abs() * 0.1;
                let score_b = horizontal_distance(*right)
                    + (b.x + b.width / 2.0 - target_actor.position.x).abs() * 0.1;
                score_a.partial_cmp(&score_b).unwrap_or(Ordering::Equal)
            });
            self.climb_target = upper.first().map(|index| *index as u8);
        }
        if let Some(landing_id) = self.climb_target {
            if let Some(landing) = state.config.map.platforms.get(landing_id as usize) {
                if !endangered {
                    let landing_x = (landing.x + 35.0)
                        .max((landing.x + landing.width - 35.0).min(actor.position.x));
                    if (landing_x - actor.position.x).abs() > 8.0 {
                        move_x = if landing_x > actor.position.x { 1 } else { -1 };
                    }
                }
            }
        }

        let wants_height = dy < -55.0 && actor.grounded_on.is_some();
        let recovery_jump =
            endangered && actor.jumps_remaining > 0 && actor.vertical_velocity > 80.0;
        let own_bombs = state
            .bombs
            .iter()
            .filter(|bomb| bomb.owner == actor.config.id)
            .count();
        let can_bomb = !endangered
            && actor.bombs_remaining > 0
            && actor.bomb_cooldown <= 0.0
            && own_bombs < 2
            && dx.abs() >= 90.0
            && dx.abs() <= 260.0
            && dy.abs() < 80.0;
        let bomb_pressed = can_bomb && self.random.next_f64() < self.profile.bomb_chance;

        let weapon = &state.config.weapons[actor.weapon.weapon as usize];
        let magazine = actor.weapon.ammo;
        let low_magazine = matches!((magazine, weapon.max_ammo), (Some(current), Some(capacity))
            if current <= (capacity as i32 / 4).max(1))
            && actor.weapon.reserve > 0
            && actor.reload_remaining <= 1e-8;

        self.held = ActorInput {
            move_x,
            jump_pressed: recovery_jump || wants_height,
            drop_pressed: dy > 100.0
                && actor.grounded_on.is_some()
                && actor.position.y < lowest_level - 10.0,
            shoot_held: !bomb_pressed
                && dy.abs() < 45.0
                && dx.abs() < self.profile.fire_range.min(weapon.range)
                && actor.facing as f64 == dx.signum(),
            bomb_pressed,
            reload_pressed: low_magazine && !endangered && !bomb_pressed,
        };
        self.held
    }
}

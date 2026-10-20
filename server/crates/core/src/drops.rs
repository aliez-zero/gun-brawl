//! Drop scheduler and pickup resolution, port of `DropSystem.ts`.

use crate::combat::equip_weapon;
use crate::math::{actor_rect, hypot};
use crate::random::Lcg;
use crate::types::{
    ActorId, ActorState, ActorStatus, BattleEvent, DropState, MapDef, MatchState, Vec2, WeaponDrop,
    WeaponId,
};

const FIRST_DROP: f64 = 8.0;
const DROP_INTERVAL: f64 = 8.0;
const INCOMING_TIME: f64 = 1.0;
const ACTIVE_LIFE: f64 = 20.0;
const WARNING_TIME: f64 = 3.0;
const MAX_ACTIVE: usize = 3;
const PICKUP_WIDTH: f64 = 32.0;
const PICKUP_HEIGHT: f64 = 32.0;
const SAFE_SPAWN_DISTANCE: f64 = 120.0;

#[derive(Debug, Clone, Copy)]
pub struct DropPoolEntry {
    pub weapon: WeaponId,
    pub weight: f64,
}

pub struct DropRuntime {
    pool: Vec<DropPoolEntry>,
    next_drop_in: f64,
    next_drop_id: u32,
    initialized: bool,
    overtime_handled: bool,
    points_random: Lcg,
    weapons_random: Lcg,
    tie_random: Lcg,
}

impl DropRuntime {
    pub fn new(pool: Vec<DropPoolEntry>) -> Self {
        let pool = pool
            .into_iter()
            .filter(|entry| entry.weight.is_finite() && entry.weight > 0.0)
            .collect();
        Self {
            pool,
            next_drop_in: FIRST_DROP,
            next_drop_id: 0,
            initialized: false,
            overtime_handled: false,
            points_random: Lcg::new(1),
            weapons_random: Lcg::new(1),
            tie_random: Lcg::new(1),
        }
    }

    pub fn update(&mut self, state: &mut MatchState, dt: f64, events: &mut Vec<BattleEvent>) {
        self.initialize(state);
        if state.overtime && !self.overtime_handled {
            self.overtime_handled = true;
            self.next_drop_in = FIRST_DROP;
            state.drops.clear();
        }
        update_timers(state, dt, events);
        self.next_drop_in -= dt;
        if self.next_drop_in <= 1e-8 {
            self.next_drop_in += DROP_INTERVAL;
            self.try_spawn(state, events);
        }
        self.resolve_pickups(state, events);
    }

    fn initialize(&mut self, state: &MatchState) {
        if self.initialized {
            return;
        }
        self.initialized = true;
        self.points_random = Lcg::new(state.config.seed ^ 0x9e37_79b9);
        self.weapons_random = Lcg::new(state.config.seed ^ 0x85eb_ca6b);
        self.tie_random = Lcg::new(state.config.seed ^ 0xc2b2_ae35);
        self.overtime_handled = state.overtime;
    }

    fn try_spawn(&mut self, state: &mut MatchState, events: &mut Vec<BattleEvent>) {
        if state.drops.len() >= MAX_ACTIVE || self.pool.is_empty() {
            return;
        }
        let points = safe_points(&state.config.map);
        if points.is_empty() {
            return;
        }
        let point = points[(self.points_random.next_f64() * points.len() as f64) as usize];
        let weapon = self.pick_weapon();
        let drop = WeaponDrop {
            id: self.next_drop_id,
            weapon,
            position: point,
            state: DropState::Incoming,
            timer: INCOMING_TIME,
            warning: false,
        };
        self.next_drop_id += 1;
        let drop_id = drop.id;
        state.drops.push(drop);
        events.push(BattleEvent::DropIncoming {
            drop_id,
            weapon,
            position: point,
        });
    }

    fn pick_weapon(&mut self) -> WeaponId {
        let total: f64 = self.pool.iter().map(|entry| entry.weight).sum();
        let mut roll = self.weapons_random.next_f64() * total;
        for entry in &self.pool {
            roll -= entry.weight;
            if roll <= 1e-8 {
                return entry.weapon;
            }
        }
        self.pool[self.pool.len() - 1].weapon
    }

    fn resolve_pickups(&mut self, state: &mut MatchState, events: &mut Vec<BattleEvent>) {
        let mut picked: Vec<u32> = Vec::new();
        let mut recipients: Vec<ActorId> = Vec::new();

        for drop_index in 0..state.drops.len() {
            if state.drops[drop_index].state != DropState::Active {
                continue;
            }
            let point = state.drops[drop_index].position;
            let mut candidates: Vec<(usize, f64)> = Vec::new();
            for (actor_index, actor) in state.actors.iter().enumerate() {
                if actor.status != ActorStatus::Alive || recipients.contains(&actor.config.id) {
                    continue;
                }
                if touches(actor, point) {
                    candidates.push((
                        actor_index,
                        hypot(actor.position.x - point.x, actor.position.y - point.y),
                    ));
                }
            }
            if candidates.is_empty() {
                continue;
            }
            let tie = self.tie_random.next_f64();
            candidates.sort_by(|a, b| {
                a.1.partial_cmp(&b.1)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(tie.partial_cmp(&tie).unwrap_or(std::cmp::Ordering::Equal))
            });
            let winner_index = candidates[0].0;
            let weapon = state.drops[drop_index].weapon;
            let definition = state.config.weapons[weapon as usize].clone();
            equip_weapon(&mut state.actors[winner_index], weapon, &definition);
            let winner_id = state.actors[winner_index].config.id;
            recipients.push(winner_id);
            picked.push(state.drops[drop_index].id);
            events.push(BattleEvent::Pickup {
                actor: winner_id,
                weapon,
                position: point,
                drop_id: state.drops[drop_index].id,
            });
        }

        let mut write = 0usize;
        for read in 0..state.drops.len() {
            let expired =
                state.drops[read].state == DropState::Active && state.drops[read].timer <= 0.0;
            if picked.contains(&state.drops[read].id) {
                continue;
            }
            if expired {
                events.push(BattleEvent::DropExpired {
                    drop_id: state.drops[read].id,
                    position: state.drops[read].position,
                });
                continue;
            }
            if write != read {
                state.drops.swap(write, read);
            }
            write += 1;
        }
        state.drops.truncate(write);
    }
}

fn update_timers(state: &mut MatchState, dt: f64, events: &mut Vec<BattleEvent>) {
    for drop in &mut state.drops {
        drop.timer -= dt;
        if drop.state == DropState::Incoming && drop.timer <= 0.0 {
            drop.state = DropState::Active;
            drop.timer = ACTIVE_LIFE;
            drop.warning = false;
            events.push(BattleEvent::DropLanded {
                drop_id: drop.id,
                weapon: drop.weapon,
                position: drop.position,
            });
        } else if drop.state == DropState::Active {
            drop.warning = drop.timer <= WARNING_TIME;
        }
    }
}

fn safe_points(map: &MapDef) -> Vec<Vec2> {
    let mut raw: Vec<Vec2> = map.drop_points.clone();
    if raw.is_empty() {
        for platform in &map.platforms {
            if platform.width < 80.0 {
                continue;
            }
            if platform.y < map.height * 0.55 {
                continue;
            }
            for fraction in [0.25, 0.5, 0.75] {
                raw.push(Vec2 {
                    x: platform.x + platform.width * fraction,
                    y: platform.y,
                });
            }
        }
    }
    let bounds = map.bounds;
    raw.into_iter()
        .filter(|point| {
            point.x.is_finite()
                && point.y.is_finite()
                && point.x >= bounds.left + 16.0
                && point.x <= bounds.right - 16.0
                && point.y >= bounds.top + 16.0
                && point.y <= bounds.bottom - 16.0
                && map
                    .spawns
                    .iter()
                    .all(|spawn| hypot(spawn.x - point.x, spawn.y - point.y) >= SAFE_SPAWN_DISTANCE)
        })
        .collect()
}

fn touches(actor: &ActorState, point: Vec2) -> bool {
    let body = actor_rect(actor);
    let box_x = point.x - PICKUP_WIDTH / 2.0;
    let box_y = point.y - PICKUP_HEIGHT;
    body.x < box_x + PICKUP_WIDTH
        && body.x + body.width > box_x
        && body.y < box_y + PICKUP_HEIGHT
        && body.y + body.height > box_y
}

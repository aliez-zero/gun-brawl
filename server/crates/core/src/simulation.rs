//! Fixed-step simulation and the systems' order.
//!
//! Port of `BattleSimulation.step`: life timers, movement, combat, grenades,
//! ring-outs, drops, match resolution — in that exact order.

use crate::actor::create_actor;
use crate::combat::update_combat;
use crate::drops::{DropPoolEntry, DropRuntime};
use crate::grenade::update_grenades;
use crate::life::{resolve_ringouts, update_life_timers};
use crate::match_rule::resolve_match;
use crate::movement::move_actor;
use crate::types::{
    ActorInput, BattleEvent, GameMode, InputTable, MatchConfig, MatchPhase, MatchState, Vec2,
};

pub struct Simulation {
    pub state: MatchState,
    next_projectile: u32,
    next_bomb: u32,
    drops: DropRuntime,
    events: Vec<BattleEvent>,
}

impl Simulation {
    pub fn new(config: MatchConfig, drop_pool: Vec<DropPoolEntry>) -> Self {
        let actors = config
            .actors
            .iter()
            .enumerate()
            .map(|(index, actor)| {
                let spawn = config.map.spawns.get(index).copied().unwrap_or(Vec2::ZERO);
                create_actor(
                    actor.clone(),
                    spawn,
                    config.stocks,
                    config.map.width / 2.0,
                    config.starting_weapon,
                    &config.weapons[config.starting_weapon as usize],
                )
            })
            .collect();
        let state = MatchState {
            phase: MatchPhase::Countdown,
            remaining: config.duration,
            countdown_remaining: config.countdown,
            config,
            actors,
            projectiles: Vec::new(),
            bombs: Vec::new(),
            drops: Vec::new(),
            elapsed: 0.0,
            overtime: false,
            result: None,
        };
        Self {
            state,
            next_projectile: 0,
            next_bomb: 0,
            drops: DropRuntime::new(drop_pool),
            events: Vec::new(),
        }
    }

    pub fn step(&mut self, dt: f64, inputs: &InputTable) {
        if !dt.is_finite() || dt <= 0.0 || dt > 0.1 {
            return;
        }
        match self.state.phase {
            MatchPhase::Paused | MatchPhase::Finished => return,
            MatchPhase::Countdown => {
                self.state.countdown_remaining = (self.state.countdown_remaining - dt).max(0.0);
                if self.state.countdown_remaining <= 1e-8 {
                    self.state.countdown_remaining = 0.0;
                    self.state.phase = MatchPhase::Playing;
                    self.events.push(BattleEvent::Phase(MatchPhase::Playing));
                }
                return;
            }
            MatchPhase::Playing => {}
        }

        self.state.elapsed += dt;
        if self.state.config.mode != GameMode::Training {
            self.state.remaining = (self.state.remaining - dt).max(0.0);
        }
        update_life_timers(&mut self.state, dt, &mut self.events);

        for index in 0..self.state.actors.len() {
            let input = inputs
                .get(index)
                .copied()
                .flatten()
                .unwrap_or(ActorInput::IDLE);
            let map = &self.state.config.map;
            move_actor(&mut self.state.actors[index], input, map, dt);
        }

        update_combat(
            &mut self.state,
            inputs,
            dt,
            &mut self.events,
            &mut self.next_projectile,
        );
        update_grenades(
            &mut self.state,
            inputs,
            dt,
            &mut self.events,
            &mut self.next_bomb,
        );
        resolve_ringouts(&mut self.state, &mut self.events);
        self.drops.update(&mut self.state, dt, &mut self.events);
        resolve_match(&mut self.state, &mut self.events);
    }

    pub fn pause(&mut self) {
        if self.state.phase == MatchPhase::Playing || self.state.phase == MatchPhase::Countdown {
            self.state.phase = MatchPhase::Paused;
            self.events.push(BattleEvent::Phase(MatchPhase::Paused));
        }
    }

    pub fn resume(&mut self) {
        if self.state.phase == MatchPhase::Paused {
            self.state.phase = MatchPhase::Countdown;
            self.state.countdown_remaining = 3.0;
            self.events.push(BattleEvent::Phase(MatchPhase::Countdown));
        }
    }

    /// Take the events produced since the last call.
    pub fn drain_events(&mut self) -> Vec<BattleEvent> {
        std::mem::take(&mut self.events)
    }

    pub fn pending_events(&self) -> &[BattleEvent] {
        &self.events
    }
}

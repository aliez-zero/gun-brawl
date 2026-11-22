//! Training tasks are observed after a playing step has resolved movement and combat.

use crate::actor::create_actor;
use crate::types::{ActorStatus, BattleEvent, Control, InputTable, MatchPhase, MatchState};

pub const TASK_MASK: u8 = 0b11_1111;
const MOVE: u8 = 1 << 0;
const DOUBLE_JUMP: u8 = 1 << 1;
const DROP: u8 = 1 << 2;
const HIT: u8 = 1 << 3;
const RINGOUT: u8 = 1 << 4;
const BOMB: u8 = 1 << 5;

pub struct Training {
    pub completed: u8,
    pub dummy_moving: bool,
    move_time: f64,
}

impl Default for Training {
    fn default() -> Self {
        Self {
            completed: 0,
            dummy_moving: true,
            move_time: 0.0,
        }
    }
}

impl Training {
    pub(crate) fn observe(
        &mut self,
        state: &MatchState,
        inputs: &InputTable,
        dt: f64,
        events: &[BattleEvent],
    ) {
        for (actor, input) in state.actors.iter().zip(inputs) {
            let Some(input) = input else { continue };
            if !matches!(actor.config.control, Control::Human(_))
                || actor.status != ActorStatus::Alive
            {
                continue;
            }
            if input.move_x != 0 {
                self.move_time += dt;
                if self.move_time >= 0.6 {
                    self.completed |= MOVE;
                }
            }
            if input.jump_pressed && actor.grounded_on.is_none() && actor.jumps_remaining == 0 {
                self.completed |= DOUBLE_JUMP;
            }
            if input.drop_pressed && actor.drop_platform.is_some() {
                self.completed |= DROP;
            }
        }
        let lookup = |id| state.actors.iter().find(|actor| actor.id() == id);
        for event in events {
            match *event {
                BattleEvent::Hit { actor, .. }
                    if lookup(actor).is_some_and(|target| {
                        target.config.control == Control::Dummy
                            && target.protection_remaining <= 0.0
                    }) =>
                {
                    self.completed |= HIT
                }
                BattleEvent::Ringout {
                    actor,
                    credited_to: Some(_),
                    ..
                } if lookup(actor)
                    .is_some_and(|target| target.config.control == Control::Dummy) =>
                {
                    self.completed |= RINGOUT
                }
                BattleEvent::Bomb { actor, .. }
                    if lookup(actor)
                        .is_some_and(|owner| matches!(owner.config.control, Control::Human(_))) =>
                {
                    self.completed |= BOMB
                }
                _ => {}
            }
        }
    }

    pub(crate) fn reset(&mut self, state: &mut MatchState) {
        self.move_time = 0.0;
        state.projectiles.clear();
        state.bombs.clear();
        state.drops.clear();
        state.phase = MatchPhase::Countdown;
        state.countdown_remaining = state.config.countdown;
        state.elapsed = 0.0;
        state.remaining = state.config.duration;
        state.overtime = false;
        state.result = None;
        for (index, actor) in state.actors.iter_mut().enumerate() {
            let weapon = actor.weapon;
            *actor = create_actor(
                actor.config.clone(),
                state
                    .config
                    .map
                    .spawns
                    .get(index)
                    .or_else(|| state.config.map.spawns.first())
                    .copied()
                    .unwrap_or_default(),
                state.config.stocks,
                state.config.map.width / 2.0,
                weapon.weapon,
                state.config.weapon(weapon.weapon),
            );
            actor.weapon = weapon;
            actor.protection_remaining = 0.0;
        }
    }
}

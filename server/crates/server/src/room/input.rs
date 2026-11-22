use gunbrawl_core::types::{ActorInput, Control, InputTable};
use gunbrawl_core::{Simulation, FIXED_STEP};
use gunbrawl_proto::InputFrame;
use std::collections::VecDeque;

use super::Room;

pub(super) struct InputQueue {
    frames: VecDeque<InputFrame>,
    last: Option<InputFrame>,
    pub(super) last_seq: u32,
}

impl InputQueue {
    pub(super) fn new() -> Self {
        Self {
            frames: VecDeque::with_capacity(4),
            last: None,
            last_seq: 0,
        }
    }

    pub(super) fn clear_held(&mut self) {
        self.frames.clear();
        self.last = None;
    }

    pub(super) fn push_batch(&mut self, frames: Vec<InputFrame>) {
        for frame in frames.into_iter().take(4) {
            self.push(frame);
        }
    }

    pub(super) fn push(&mut self, frame: InputFrame) {
        if self.frames.len() >= 4 {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
    }

    pub(super) fn consume(&mut self) -> InputFrame {
        // A client whose clock runs slightly ahead of the server tick slowly fills this
        // queue, and popping the oldest frame every tick means the player's input is
        // applied a full queue depth (up to 67 ms) late for the rest of the match. Collapse
        // a backlog into the newest frame instead, keeping edges so a jump or bomb press
        // that arrived in a skipped frame still happens.
        if self.frames.len() > 2 {
            let mut held = 0u8;
            let mut edges = 0u8;
            let mut newest: Option<InputFrame> = None;
            while let Some(frame) = self.frames.pop_front() {
                held |= frame.held;
                edges |= frame.edges;
                newest = Some(frame);
            }
            if let Some(mut frame) = newest {
                frame.held = held;
                frame.edges = edges;
                self.frames.push_front(frame);
            }
        }
        let frame = match self.frames.pop_front() {
            Some(frame) => frame,
            None => match self.last {
                Some(last) => InputFrame::repeat(last, self.last_seq, self.last_seq),
                None => InputFrame {
                    seq: self.last_seq,
                    tick_hint: 0,
                    move_x: 0,
                    held: 0,
                    edges: 0,
                },
            },
        };
        self.last = Some(frame);
        self.last_seq = frame.seq;
        frame
    }
}

impl Room {
    pub(super) fn build_inputs(&mut self, simulation: &Simulation) -> InputTable {
        let mut table: InputTable = [None; 4];
        for (index, actor) in simulation.state.actors.iter().enumerate() {
            let input = if let Some(bot) = &mut self.bots[index] {
                bot.sample(index, &simulation.state, FIXED_STEP)
            } else {
                match actor.config.control {
                    Control::Human(_) => {
                        let frame = self.inputs[self.actor_slots[index]].consume();
                        ActorInput {
                            move_x: frame.move_x.clamp(-1, 1),
                            jump_pressed: frame.jump(),
                            drop_pressed: frame.drop(),
                            shoot_held: frame.fire(),
                            bomb_pressed: frame.bomb(),
                            reload_pressed: frame.reload(),
                        }
                    }
                    Control::Dummy
                        if simulation
                            .training
                            .as_ref()
                            .is_some_and(|training| training.dummy_moving) =>
                    {
                        let state = &simulation.state;
                        let target = state.config.map.width / 2.0
                            + gunbrawl_core::math::sin(state.elapsed * 0.8) * 220.0;
                        let delta = target - actor.position.x;
                        ActorInput {
                            move_x: if delta.abs() < 12.0 {
                                0
                            } else if delta > 0.0 {
                                1
                            } else {
                                -1
                            },
                            ..ActorInput::IDLE
                        }
                    }
                    Control::External => {
                        self.external.as_mut().map_or(ActorInput::IDLE, |external| {
                            external.sample(&simulation.state, self.playing_tick, FIXED_STEP)
                        })
                    }
                    _ => ActorInput::IDLE,
                }
            };
            table[index] = Some(input);
        }
        table
    }
}

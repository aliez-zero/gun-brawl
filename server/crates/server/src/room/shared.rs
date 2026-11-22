//! Membership, lobby controls and reconnection for rooms joined by code.

use bytes::Bytes;
use gunbrawl_bot::BotController;
use gunbrawl_core::types::{ActorStatus, Control, Difficulty, GameMode};
use gunbrawl_proto::{encode, PHASE_LOBBY, PHASE_RESULT, S2C, SLOT_BOT, SLOT_EMPTY, SLOT_HUMAN};
use std::time::Instant;
use tracing::{info, warn};

use super::{difficulty, Command, InputQueue, Room, Slot, MAX_SLOTS, RECONNECT_GRACE};

impl Room {
    /// Fill every empty slot with a bot at the admin-configured difficulty.
    fn fill_empty_slots_with_bots(&mut self) {
        for index in 0..MAX_SLOTS {
            if self.slots[index].kind == SLOT_EMPTY {
                self.slots[index] = Slot {
                    kind: SLOT_BOT,
                    player: 0,
                    name: format!("AI {}", index + 1),
                    ready: true,
                    difficulty: self.rules.bot_difficulty,
                };
            }
        }
    }

    /// Free slots whose reconnect grace ran out, so a stale slot cannot be resumed or keep
    /// a room alive forever.
    pub(super) fn expire_missing(&mut self) {
        if self.missing.is_empty() {
            return;
        }
        let now = Instant::now();
        let mut expired: Vec<u32> = self
            .missing
            .iter()
            .filter(|(_, since)| now.duration_since(**since) >= RECONNECT_GRACE)
            .map(|(player, _)| *player)
            .collect();
        expired.sort_unstable();
        for player in expired {
            info!(room = %self.code, player, "reconnect grace expired, slot freed");
            self.remove_player(player);
        }
    }

    pub(super) fn handle_shared(&mut self, command: Command) {
        match command {
            Command::PrivateInput { .. } | Command::PrivateControl { .. } => {}
            Command::Join { player, sender } => {
                if self.phase != PHASE_LOBBY {
                    let mut bytes = Vec::new();
                    if gunbrawl_proto::encode_into(
                        &S2C::Kick {
                            code: 409,
                            message: "对局进行中".into(),
                        },
                        &mut bytes,
                    )
                    .is_ok()
                    {
                        let _ = sender.send(Bytes::from(bytes));
                    }
                    return;
                }
                if self.slots.iter().all(|slot| slot.kind != SLOT_EMPTY) {
                    return;
                }
                let slot_index = self
                    .slots
                    .iter()
                    .position(|slot| slot.kind == SLOT_EMPTY)
                    .unwrap_or(0);
                if self.host == 0 {
                    self.host = player.id;
                }
                self.slots[slot_index] = Slot {
                    kind: SLOT_HUMAN,
                    player: player.id,
                    name: player.name.clone(),
                    ready: false,
                    difficulty: 1,
                };
                self.players.insert(player.id, sender);
                self.broadcast_room();
                info!(room = %self.code, player = player.id, slot = slot_index, "player joined");
            }
            Command::Leave { player } => {
                self.remove_player(player);
            }
            Command::Disconnect { player } => {
                self.players.remove(&player);
                self.missing.insert(player, Instant::now());
                // Keep the field full for everyone else: the seat plays itself until the
                // player reconnects (or the grace expires), instead of leaving a statue
                // that still takes hits and can even keep the last held fire button down.
                self.hand_off_to_bot(player);
                info!(room = %self.code, player, "player disconnected, slot held for 60s");
            }
            Command::Resume { player, sender } => {
                let known = self
                    .slots
                    .iter()
                    .any(|slot| slot.kind == SLOT_HUMAN && slot.player == player.id);
                if !known {
                    return;
                }
                self.missing.remove(&player.id);
                self.players.insert(player.id, sender.clone());
                self.take_back_from_bot(player.id);
                let view = self.room_view();
                if let Ok(payload) = encode(&S2C::Room(view)) {
                    let _ = sender.send(Bytes::from(payload));
                }
                if let Some(snapshot) = &self.last_snapshot {
                    let _ = sender.send(snapshot.clone());
                }
                self.broadcast_room();
                info!(room = %self.code, player = player.id, "player resumed");
            }
            Command::PickSlot {
                player,
                slot,
                kind,
                difficulty,
            } => {
                let slot_index = slot as usize;
                if slot_index >= MAX_SLOTS || self.phase != PHASE_LOBBY {
                    return;
                }
                if kind == SLOT_BOT {
                    self.slots[slot_index] = Slot {
                        kind: SLOT_BOT,
                        player: 0,
                        name: format!("AI {}", slot_index + 1),
                        ready: true,
                        difficulty,
                    };
                } else if kind == SLOT_EMPTY && self.slots[slot_index].player != player {
                    self.slots[slot_index] = Slot::empty();
                }
                let _ = player;
                self.broadcast_room();
            }
            Command::Ready { player, ready } => {
                if let Some(slot) = self
                    .slots
                    .iter_mut()
                    .find(|slot| slot.kind == SLOT_HUMAN && slot.player == player)
                {
                    slot.ready = ready;
                }
                self.broadcast_room();
            }
            Command::Start { player } => {
                if player == self.host && self.phase == PHASE_LOBBY {
                    self.start_match();
                }
            }
            Command::Rematch { player } => {
                if player == self.host && self.phase == PHASE_RESULT {
                    self.phase = PHASE_LOBBY;
                    self.simulation = None;
                    for slot in &mut self.slots {
                        slot.ready = slot.kind == SLOT_BOT;
                    }
                    self.broadcast_room();
                }
            }
            Command::Input { player, frames } => {
                let Some(slot_index) = self
                    .slots
                    .iter()
                    .position(|slot| slot.kind == SLOT_HUMAN && slot.player == player)
                else {
                    return;
                };
                self.inputs[slot_index].push_batch(frames);
            }
            Command::Close => {
                self.shutdown = true;
            }
        }
    }

    fn start_match(&mut self) {
        let Some(map) = self.content.map(&self.config.map).cloned() else {
            warn!(room = %self.code, map = %self.config.map, "unknown map");
            return;
        };
        if self.rules.bot_fill {
            self.fill_empty_slots_with_bots();
        }
        let controls = self
            .slots
            .iter()
            .enumerate()
            .filter(|(_, slot)| slot.kind != SLOT_EMPTY)
            .map(|(index, slot)| {
                let control = if slot.kind == SLOT_BOT {
                    Control::Bot(difficulty(slot.difficulty))
                } else {
                    Control::Human((index % 2) as u8 + 1)
                };
                (index, control)
            })
            .collect::<Vec<_>>();
        if controls.len() >= 2 {
            self.begin_match(GameMode::Custom, map, controls, 0);
        }
    }

    fn remove_player(&mut self, player: u32) {
        // Resolve the actor before the slot is cleared, or the mapping is lost.
        let actor_index = self.actor_index_of(player);
        if let Some(index) = self
            .slots
            .iter()
            .position(|slot| slot.kind == SLOT_HUMAN && slot.player == player)
        {
            self.slots[index] = Slot::empty();
        }
        if let Some(actor_index) = actor_index {
            // A player who never comes back must not keep a live actor in the arena: it
            // would still block shots, count for the win check and pad the score table.
            if let Some(simulation) = self.simulation.as_mut() {
                if let Some(actor) = simulation.state.actors.get_mut(actor_index) {
                    if actor.status == ActorStatus::Alive {
                        actor.status = ActorStatus::Eliminated;
                        info!(room = %self.code, player, "player gone mid-match, actor eliminated");
                    }
                }
            }
        }
        self.players.remove(&player);
        self.missing.remove(&player);
        if self.host == player {
            self.host = self
                .slots
                .iter()
                .find(|slot| slot.kind == SLOT_HUMAN)
                .map(|slot| slot.player)
                .unwrap_or(0);
        }
        if self.players.is_empty() {
            self.phase = PHASE_LOBBY;
            self.simulation = None;
        }
        self.broadcast_room();
    }

    /// Slot index of a human player, if they still hold a seat.
    fn actor_index_of(&self, player: u32) -> Option<usize> {
        let slot_index = self
            .slots
            .iter()
            .position(|slot| slot.kind == SLOT_HUMAN && slot.player == player)?;
        self.actor_slots
            .iter()
            .position(|index| *index == slot_index)
    }

    fn hand_off_to_bot(&mut self, player: u32) {
        let Some(actor_index) = self.actor_index_of(player) else {
            return;
        };
        let Some(slot) = self.bots.get_mut(actor_index) else {
            return;
        };
        if slot.is_some() {
            return;
        }
        *slot = Some(BotController::new(
            Difficulty::Normal,
            self.seed
                .wrapping_add(actor_index as u32)
                .wrapping_add(self.tick),
        ));
        info!(room = %self.code, player, "bot took over the seat");
    }

    fn take_back_from_bot(&mut self, player: u32) {
        let Some(actor_index) = self.actor_index_of(player) else {
            return;
        };
        if let Some(slot) = self.bots.get_mut(actor_index) {
            if slot.take().is_some() {
                info!(room = %self.code, player, "player resumed control");
            }
        }
        if let Some(slot_index) = self
            .slots
            .iter()
            .position(|slot| slot.kind == SLOT_HUMAN && slot.player == player)
        {
            // Drop frames queued before the disconnect; a stale "fire held" would fire again.
            self.inputs[slot_index] = InputQueue::new();
        }
    }
}

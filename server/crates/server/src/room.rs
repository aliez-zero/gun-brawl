//! One authoritative room: slots, match lifecycle, 60 Hz simulation and
//! 30 Hz snapshot broadcast.
//!
//! The room owns all mutable game state. Sessions only forward commands and
//! receive encoded messages, so no lock is ever held across a tick.

mod external;
mod input;
mod private;
#[cfg(test)]
mod private_tests;
mod shared;
mod snapshot;
#[cfg(test)]
mod tests;

use external::ExternalController;
use input::InputQueue;
use snapshot::{event_snap, phase_id};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use gunbrawl_bot::BotController;
use gunbrawl_content::Content;
use gunbrawl_core::types::{
    ActorConfig, Control, Difficulty, DropMode, GameMode, MapDef, MatchConfig, MatchPhase,
};
use gunbrawl_core::{Simulation, FIXED_STEP, SNAPSHOT_RATE, TICK_RATE};
use gunbrawl_proto::{
    encode, EventSnap, InputFrame, MatchResultWire, PrivateAction, RoomView, SlotView,
    PHASE_COUNTDOWN, PHASE_LOBBY, PHASE_PAUSED, PHASE_RESULT, S2C, SLOT_BOT, SLOT_EMPTY,
    SLOT_HUMAN,
};
use tokio::sync::mpsc;
use tracing::info;

use crate::lobby::RoomDirectory;
use crate::metrics::Metrics;
use crate::persist::{MatchRecord, PlayerRecord};

pub const MAX_SLOTS: usize = 4;
pub const ROOM_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ";

/// How long a dropped human keeps their slot for a reconnect.
pub const RECONNECT_GRACE: Duration = Duration::from_secs(60);
/// Rooms with no connected human (bots only, or never joined) are reclaimed after this,
/// so an abandoned lobby stops burning a 60 Hz tick loop forever.
pub const IDLE_ROOM_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone)]
pub struct RoomConfig {
    pub map: String,
    pub stocks: u8,
    pub duration: u16,
    pub drop_mode: u8,
}

#[derive(Debug, Clone)]
pub struct Player {
    pub id: u32,
    pub name: String,
}

pub enum Command {
    Join {
        player: Player,
        sender: mpsc::UnboundedSender<Bytes>,
    },
    /// Re-attach a known player after a reconnect; the slot is kept for 60 s.
    Resume {
        player: Player,
        sender: mpsc::UnboundedSender<Bytes>,
    },
    Disconnect {
        player: u32,
    },
    Leave {
        player: u32,
    },
    PickSlot {
        player: u32,
        slot: u8,
        kind: u8,
        difficulty: u8,
    },
    Ready {
        player: u32,
        ready: bool,
    },
    Start {
        player: u32,
    },
    Rematch {
        player: u32,
    },
    Input {
        player: u32,
        frames: Vec<InputFrame>,
    },
    PrivateInput {
        player: u32,
        actor: u8,
        frames: Vec<InputFrame>,
    },
    PrivateControl {
        player: u32,
        action: PrivateAction,
    },
    /// Admin action: stop the room and let its task deregister.
    Close,
}

#[derive(Clone)]
struct Slot {
    kind: u8,
    player: u32,
    name: String,
    ready: bool,
    difficulty: u8,
}

impl Slot {
    fn empty() -> Self {
        Self {
            kind: SLOT_EMPTY,
            player: 0,
            name: String::new(),
            ready: false,
            difficulty: 1,
        }
    }
}

pub struct Room {
    code: String,
    host: u32,
    config: RoomConfig,
    slots: [Slot; MAX_SLOTS],
    players: HashMap<u32, mpsc::UnboundedSender<Bytes>>,
    /// Players that dropped but may still reconnect (60 s grace).
    missing: HashMap<u32, Instant>,
    /// Last encoded snapshot, replayed to a reconnecting client.
    last_snapshot: Option<Bytes>,
    /// Events from all simulation ticks since the previous snapshot.
    pending_events: Vec<EventSnap>,
    phase: u8,
    private: bool,
    external: Option<ExternalController>,
    playing_tick: u32,
    simulation: Option<Simulation>,
    /// Actor index -> slot index for the running match.
    actor_slots: Vec<usize>,
    /// One controller per bot actor, aligned with actor index.
    bots: Vec<Option<BotController>>,
    inputs: [InputQueue; MAX_SLOTS],
    tick: u32,
    content: Arc<Content>,
    metrics: Arc<Metrics>,
    persist: Option<mpsc::Sender<MatchRecord>>,
    started_at: i64,
    seed: u32,
    /// Last moment a human was connected; drives idle reclamation.
    last_human_at: Instant,
    /// Live view published for the admin console.
    directory: Arc<RoomDirectory>,
    /// Admin-configured rules captured when the room was created.
    rules: RoomRules,
    /// Set by `Command::Close`; the task leaves the loop on the next tick.
    shutdown: bool,
}

/// Admin rules baked into a room at creation time.
#[derive(Debug, Clone, Copy)]
pub struct RoomRules {
    pub weapon_scale: f32,
    pub bot_fill: bool,
    pub bot_difficulty: u8,
}

impl Default for RoomRules {
    fn default() -> Self {
        Self {
            weapon_scale: 1.0,
            bot_fill: false,
            bot_difficulty: 1,
        }
    }
}

impl Room {
    pub fn new(
        code: String,
        config: RoomConfig,
        content: Arc<Content>,
        metrics: Arc<Metrics>,
        persist: Option<mpsc::Sender<MatchRecord>>,
        directory: Arc<RoomDirectory>,
        rules: RoomRules,
    ) -> Self {
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(1);
        Self {
            code,
            host: 0,
            config,
            slots: [Slot::empty(), Slot::empty(), Slot::empty(), Slot::empty()],
            players: HashMap::new(),
            missing: HashMap::new(),
            last_snapshot: None,
            pending_events: Vec::new(),
            phase: PHASE_LOBBY,
            private: false,
            external: None,
            playing_tick: 0,
            simulation: None,
            actor_slots: Vec::new(),
            bots: Vec::new(),
            inputs: [
                InputQueue::new(),
                InputQueue::new(),
                InputQueue::new(),
                InputQueue::new(),
            ],
            tick: 0,
            content,
            metrics,
            persist,
            started_at: 0,
            seed,
            last_human_at: Instant::now(),
            directory,
            rules,
            shutdown: false,
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn shutdown(&self) -> bool {
        self.shutdown
    }

    /// True once nobody has been connected for [`IDLE_ROOM_TIMEOUT`] and no slot is still
    /// waiting out its reconnect grace.
    pub fn should_close(&self) -> bool {
        self.players.is_empty()
            && self.missing.is_empty()
            && self.last_human_at.elapsed() >= IDLE_ROOM_TIMEOUT
    }

    fn handle(&mut self, command: Command) {
        if self.private {
            self.handle_private(command);
        } else {
            self.handle_shared(command);
        }
    }

    fn begin_match(
        &mut self,
        mode: GameMode,
        map: MapDef,
        controls: Vec<(usize, Control)>,
        training_completed: u8,
    ) {
        self.actor_slots.clear();
        self.bots.clear();
        self.external = None;
        let mut actors = Vec::with_capacity(controls.len());
        for (index, (slot, control)) in controls.into_iter().enumerate() {
            let seed = self.seed.wrapping_add(index as u32);
            if control == Control::External {
                self.external = Some(ExternalController::new(index, seed.wrapping_add(10_000)));
            }
            self.bots.push(match control {
                Control::Bot(difficulty) => Some(BotController::new(difficulty, seed)),
                _ => None,
            });
            actors.push(ActorConfig {
                id: index as u8,
                name: self.slots[slot].name.clone(),
                color: 0xffffff,
                control,
            });
            self.actor_slots.push(slot);
        }
        let pistol = self.content.pistol();
        let drop_mode = match self.config.drop_mode {
            0 => DropMode::All,
            1 => DropMode::Standard,
            _ => DropMode::None,
        };
        // Admin knockback multiplier: the content bundle is shared, so scale a copy.
        let mut weapons = self.content.weapons.clone();
        if (self.rules.weapon_scale - 1.0).abs() > f32::EPSILON {
            for weapon in &mut weapons {
                weapon.knockback *= f64::from(self.rules.weapon_scale);
            }
        }
        let config = MatchConfig {
            mode,
            map,
            weapons,
            actors,
            starting_weapon: pistol,
            pistol,
            stocks: self.config.stocks as i32,
            duration: self.config.duration as f64,
            countdown: 3.0,
            seed: self.seed,
            drop_mode,
        };
        let mut simulation = Simulation::new(config, self.content.drop_pool(drop_mode));
        if let Some(training) = &mut simulation.training {
            training.completed = training_completed;
        }
        if let Some(external) = &mut self.external {
            external.sync(&simulation.state);
        }
        self.simulation = Some(simulation);
        self.playing_tick = 0;
        self.started_at = MatchRecord::now();
        self.phase = PHASE_COUNTDOWN;
        self.tick = 0;
        self.last_snapshot = None;
        self.pending_events.clear();
        for queue in &mut self.inputs {
            *queue = InputQueue::new();
        }
        self.broadcast_room();
        info!(room = %self.code, actors = self.actor_slots.len(), "match started");
    }

    fn step(&mut self) {
        if !self.players.is_empty() {
            self.last_human_at = Instant::now();
        }
        self.expire_missing();
        // A finished match keeps its final state for late joiners, but must not keep
        // simulating: the result branch below broadcasts, persists and counts on every
        // tick, so a room sitting on the result screen was writing 60 match records a
        // second and inflating matches_finished_total without bound.
        if matches!(self.phase, PHASE_RESULT | PHASE_PAUSED) {
            return;
        }
        let Some(mut simulation) = self.simulation.take() else {
            return;
        };
        let table = self.build_inputs(&simulation);
        let was_playing = simulation.state.phase == MatchPhase::Playing;
        simulation.step(FIXED_STEP, &table);
        if was_playing {
            self.playing_tick = self.playing_tick.wrapping_add(1);
        }
        Metrics::incr(&self.metrics.ticks);
        self.collect_events(&mut simulation);

        let finished = simulation.state.phase == MatchPhase::Finished;
        if self.tick.is_multiple_of(TICK_RATE / SNAPSHOT_RATE) || finished {
            self.send_snapshot(&simulation);
        }
        // Runs exactly once: the tick that sees Finished settles the match and flips the
        // phase, and the guard at the top of step() then stops all further ticking.
        if finished {
            if let Some(result) = simulation.state.result.clone() {
                let wire = MatchResultWire {
                    winner: result.winner.map(u32::from),
                    duration_ms: (result.duration * 1000.0) as u32,
                    overtime: result.overtime,
                    actors: result
                        .actors
                        .iter()
                        .map(|actor| gunbrawl_proto::ActorWire {
                            id: u32::from(actor.id),
                            name: actor.name.clone(),
                            stocks: actor.stocks,
                            knockouts: actor.knockouts,
                            falls: actor.falls,
                            self_falls: actor.self_falls,
                        })
                        .collect(),
                };
                self.broadcast(&S2C::MatchEnd(wire));
                // A match that plays itself out after everyone left (bots finishing an
                // abandoned room) must not land in the public match history.
                if self.players.is_empty() {
                    info!(room = %self.code, "match finished with nobody watching, not recorded");
                } else {
                    Metrics::incr(&self.metrics.matches);
                    if let Some(sender) = &self.persist {
                        let record = self.match_record(&result);
                        let _ = sender.try_send(record);
                    }
                }
                self.phase = PHASE_RESULT;
                self.broadcast_room();
            }
        }
        self.tick = self.tick.wrapping_add(1);
        self.simulation = Some(simulation);
    }

    fn collect_events(&mut self, simulation: &mut Simulation) {
        self.phase = phase_id(simulation.state.phase);
        if let Some(external) = &mut self.external {
            external.sync(&simulation.state);
        }
        self.pending_events
            .extend(simulation.drain_events().iter().filter_map(event_snap));
    }

    fn send_snapshot(&mut self, simulation: &Simulation) {
        let snapshot = snapshot::build(
            &simulation.state,
            self.tick,
            self.phase,
            std::array::from_fn(|slot| self.inputs[slot].last_seq),
            &self.pending_events,
            snapshot::ModeState {
                training_completed: simulation
                    .training
                    .as_ref()
                    .map_or(0, |training| training.completed),
                dummy_moving: simulation
                    .training
                    .as_ref()
                    .is_some_and(|training| training.dummy_moving),
                external_epoch: self
                    .external
                    .as_ref()
                    .map_or(0, |external| external.epoch()),
                playing_tick: self.playing_tick,
            },
        );
        if let Ok(payload) = encode(&S2C::Snapshot(Box::new(snapshot))) {
            let payload = Bytes::from(payload);
            self.pending_events.clear();
            Metrics::incr(&self.metrics.snapshots);
            self.last_snapshot = Some(payload.clone());
            self.broadcast_bytes(payload);
        }
    }

    fn room_view(&self) -> RoomView {
        RoomView {
            code: self.code.clone(),
            host: self.host,
            phase: self.phase,
            map: self.config.map.clone(),
            stocks: self.config.stocks,
            duration: self.config.duration,
            drop_mode: self.config.drop_mode,
            slots: self
                .slots
                .iter()
                .map(|slot| SlotView {
                    kind: slot.kind,
                    player: slot.player,
                    name: slot.name.clone(),
                    ready: slot.ready,
                    difficulty: slot.difficulty,
                })
                .collect(),
            weapons: self
                .content
                .weapons
                .iter()
                .map(|weapon| weapon.id.clone())
                .collect(),
        }
    }

    fn match_record(&self, result: &gunbrawl_core::types::MatchResult) -> MatchRecord {
        let players = self
            .actor_slots
            .iter()
            .enumerate()
            .map(|(actor_index, slot_index)| {
                let slot = &self.slots[*slot_index];
                let actor = result
                    .actors
                    .iter()
                    .find(|actor| actor.id as usize == actor_index);
                PlayerRecord {
                    slot: *slot_index,
                    player_id: if slot.kind == SLOT_HUMAN {
                        Some(slot.player)
                    } else {
                        None
                    },
                    name: slot.name.clone(),
                    bot: slot.kind == SLOT_BOT,
                    stocks: actor.map(|actor| actor.stocks).unwrap_or(0),
                    kos: actor.map(|actor| actor.knockouts).unwrap_or(0),
                    falls: actor.map(|actor| actor.falls).unwrap_or(0),
                }
            })
            .collect();
        MatchRecord {
            id: format!("{}-{}", self.code, self.started_at),
            code: self.code.clone(),
            map: self.config.map.clone(),
            mode: "custom".into(),
            started_at: self.started_at,
            ended_at: MatchRecord::now(),
            winner: result.winner.map(u32::from),
            players,
        }
    }

    fn broadcast_room(&self) {
        let view = self.room_view();
        if !self.private {
            self.directory.upsert(view.clone());
        }
        self.broadcast(&S2C::Room(view));
    }

    fn broadcast(&self, message: &S2C) {
        if let Ok(payload) = encode(message) {
            self.broadcast_bytes(Bytes::from(payload));
        }
    }

    fn broadcast_bytes(&self, payload: Bytes) {
        for sender in self.players.values() {
            let _ = sender.send(payload.clone());
        }
    }
}

fn difficulty(wire: u8) -> Difficulty {
    match wire {
        0 => Difficulty::Easy,
        2 => Difficulty::Hard,
        _ => Difficulty::Normal,
    }
}

/// Room loop.
///
/// The tick clock is a wall-time accumulator, not a plain `interval`. With
/// `MissedTickBehavior::Skip` every wake-up spent on a command (input frames arrive 60×/s
/// per player) could push the timer past its deadline and the tick was simply dropped, so
/// a busy room ran at ~56 Hz instead of 60. The client predicts at a true 60 Hz, so that
/// 7 % gap turned into constant reconciliation. Here missed ticks are caught up, capped so
/// a long stall cannot fast-forward the match.
pub async fn run_room(mut room: Room, mut rx: mpsc::Receiver<Command>) {
    const MAX_CATCH_UP_TICKS: u32 = 5;
    let period = Duration::from_micros(1_000_000 / u64::from(TICK_RATE));
    let mut next_tick = tokio::time::Instant::now();
    let mut idle_report = Instant::now();
    loop {
        tokio::select! {
            command = rx.recv() => match command {
                Some(command) => {
                    room.handle(command);
                    if room.shutdown() {
                        info!(room = %room.code(), "room closed by an administrator");
                        break;
                    }
                }
                None => break,
            },
            _ = tokio::time::sleep_until(next_tick) => {
                let now = tokio::time::Instant::now();
                let mut stepped = 0;
                while next_tick <= now && stepped < MAX_CATCH_UP_TICKS {
                    room.step();
                    next_tick += period;
                    stepped += 1;
                }
                if stepped == MAX_CATCH_UP_TICKS {
                    // Fell far behind (scheduler stall): drop the backlog instead of
                    // replaying seconds of simulation in one burst.
                    next_tick = tokio::time::Instant::now();
                }
                if stepped > 0 && idle_report.elapsed() >= Duration::from_secs(60) {
                    idle_report = Instant::now();
                    if room.players.is_empty() {
                        info!(
                            room = %room.code(),
                            missing = room.missing.len(),
                            idle_s = room.last_human_at.elapsed().as_secs(),
                            "room empty, waiting for the idle timeout",
                        );
                    }
                }
                if room.should_close() {
                    info!(room = %room.code(), "room idle, reclaiming");
                    break;
                }
            }
        }
    }
    info!(room = %room.code(), "room closed");
}

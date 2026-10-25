//! One authoritative room: slots, match lifecycle, 60 Hz simulation and
//! 30 Hz snapshot broadcast.
//!
//! The room owns all mutable game state. Sessions only forward commands and
//! receive encoded messages, so no lock is ever held across a tick.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use gunbrawl_bot::BotController;
use gunbrawl_content::Content;
use gunbrawl_core::types::{
    ActorConfig, ActorInput, ActorStatus, BattleEvent, Control, Difficulty, DropMode, DropState,
    GameMode, InputTable, MatchConfig, MatchPhase,
};
use gunbrawl_core::{Simulation, SNAPSHOT_RATE, TICK_RATE};
use gunbrawl_proto::{
    encode, quantize_pos, quantize_vel, ActorSnap, BombSnap, DropSnap, EventSnap, InputFrame,
    MatchResultWire, RoomView, SlotView, Snapshot, EVENT_BOMB, EVENT_DROP_EXPIRED,
    EVENT_DROP_INCOMING, EVENT_DROP_LANDED, EVENT_EXPLOSION, EVENT_HIT, EVENT_PICKUP,
    EVENT_RESPAWN, EVENT_RINGOUT, EVENT_SHOT, PHASE_COUNTDOWN, PHASE_LOBBY, PHASE_PLAYING,
    PHASE_RESULT, S2C, SLOT_BOT, SLOT_EMPTY, SLOT_HUMAN,
};
use tokio::sync::mpsc;
use tracing::{info, warn};

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

struct InputQueue {
    frames: VecDeque<InputFrame>,
    last: Option<InputFrame>,
    last_seq: u32,
}

impl InputQueue {
    fn new() -> Self {
        Self {
            frames: VecDeque::with_capacity(4),
            last: None,
            last_seq: 0,
        }
    }

    fn push(&mut self, frame: InputFrame) {
        if self.frames.len() >= 4 {
            self.frames.pop_front();
        }
        self.frames.push_back(frame);
    }

    fn consume(&mut self) -> InputFrame {
        let frame = match self.frames.pop_front() {
            Some(frame) => frame,
            None => match self.last {
                Some(last) => InputFrame::repeat(last, self.last_seq, self.last_seq),
                None => InputFrame {
                    seq: 0,
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
    phase: u8,
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
}

impl Room {
    pub fn new(
        code: String,
        config: RoomConfig,
        content: Arc<Content>,
        metrics: Arc<Metrics>,
        persist: Option<mpsc::Sender<MatchRecord>>,
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
            phase: PHASE_LOBBY,
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
        }
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    /// True once nobody has been connected for [`IDLE_ROOM_TIMEOUT`] and no slot is still
    /// waiting out its reconnect grace.
    pub fn should_close(&self) -> bool {
        self.players.is_empty()
            && self.missing.is_empty()
            && self.last_human_at.elapsed() >= IDLE_ROOM_TIMEOUT
    }

    /// Free slots whose reconnect grace ran out, so a stale slot cannot be resumed or keep
    /// a room alive forever.
    fn expire_missing(&mut self) {
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

    fn handle(&mut self, command: Command) {
        match command {
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
                for frame in frames.into_iter().take(4) {
                    self.inputs[slot_index].push(frame);
                }
            }
        }
    }

    fn start_match(&mut self) {
        let Some(map) = self.content.map(&self.config.map).cloned() else {
            warn!(room = %self.code, map = %self.config.map, "unknown map");
            return;
        };
        let mut actors: Vec<ActorConfig> = Vec::with_capacity(MAX_SLOTS);
        self.actor_slots.clear();
        self.bots.clear();
        for (index, slot) in self.slots.iter().enumerate() {
            if slot.kind == SLOT_EMPTY {
                continue;
            }
            let control = if slot.kind == SLOT_BOT {
                Control::Bot(match slot.difficulty {
                    0 => Difficulty::Easy,
                    2 => Difficulty::Hard,
                    _ => Difficulty::Normal,
                })
            } else {
                Control::Human((index % 2) as u8 + 1)
            };
            let bot = match control {
                Control::Bot(difficulty) => Some(BotController::new(
                    difficulty,
                    self.seed.wrapping_add(actors.len() as u32),
                )),
                _ => None,
            };
            actors.push(ActorConfig {
                id: actors.len() as u8,
                name: slot.name.clone(),
                color: 0xffffff,
                control,
            });
            self.actor_slots.push(index);
            self.bots.push(bot);
        }
        if actors.len() < 2 {
            return;
        }
        let pistol = self.content.pistol();
        let drop_mode = match self.config.drop_mode {
            0 => DropMode::All,
            1 => DropMode::Standard,
            _ => DropMode::None,
        };
        let config = MatchConfig {
            mode: GameMode::Custom,
            map,
            weapons: self.content.weapons.clone(),
            actors,
            starting_weapon: pistol,
            pistol,
            stocks: self.config.stocks as i32,
            duration: self.config.duration as f64,
            countdown: 3.0,
            seed: self.seed,
            drop_mode,
        };
        self.simulation = Some(Simulation::new(config, self.content.drop_pool(drop_mode)));
        self.started_at = MatchRecord::now();
        self.phase = PHASE_COUNTDOWN;
        self.tick = 0;
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
        if self.phase == PHASE_RESULT {
            return;
        }
        let Some(mut simulation) = self.simulation.take() else {
            return;
        };
        let mut table: InputTable = [None; 4];
        let dt = 1.0 / TICK_RATE as f64;
        for (actor_index, slot) in table.iter_mut().enumerate() {
            if actor_index >= simulation.state.actors.len() {
                break;
            }
            if let Some(Some(bot)) = self.bots.get_mut(actor_index) {
                *slot = Some(bot.sample(actor_index, &simulation.state, dt));
                continue;
            }
            let Some(slot_index) = self.actor_slots.get(actor_index).copied() else {
                continue;
            };
            let frame = self.inputs[slot_index].consume();
            *slot = Some(ActorInput {
                move_x: frame.move_x,
                jump_pressed: frame.edges & gunbrawl_proto::EDGE_JUMP != 0,
                drop_pressed: frame.edges & gunbrawl_proto::EDGE_DROP != 0,
                shoot_held: frame.held & gunbrawl_proto::HELD_FIRE != 0,
                bomb_pressed: frame.edges & gunbrawl_proto::EDGE_BOMB != 0,
                reload_pressed: frame.edges & gunbrawl_proto::EDGE_RELOAD != 0,
            });
        }

        simulation.step(dt, &table);
        Metrics::incr(&self.metrics.ticks);
        let events = simulation.drain_events();

        self.phase = match simulation.state.phase {
            MatchPhase::Countdown => PHASE_COUNTDOWN,
            MatchPhase::Playing | MatchPhase::Paused => PHASE_PLAYING,
            MatchPhase::Finished => PHASE_RESULT,
        };

        let finished = simulation.state.phase == MatchPhase::Finished;
        if self.tick.is_multiple_of(TICK_RATE / SNAPSHOT_RATE) || finished {
            let snapshot = self.build_snapshot(&simulation, &events);
            if let Ok(payload) = encode(&S2C::Snapshot(Box::new(snapshot))) {
                let payload = Bytes::from(payload);
                Metrics::incr(&self.metrics.snapshots);
                self.last_snapshot = Some(payload.clone());
                self.broadcast_bytes(payload);
            }
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
                Metrics::incr(&self.metrics.matches);
                if let Some(sender) = &self.persist {
                    let record = self.match_record(&result);
                    let _ = sender.try_send(record);
                }
                self.phase = PHASE_RESULT;
                self.broadcast_room();
            }
        }
        self.tick += 1;
        self.simulation = Some(simulation);
    }

    fn build_snapshot(&self, simulation: &Simulation, events: &[BattleEvent]) -> Snapshot {
        let state = &simulation.state;
        let acks = std::array::from_fn(|slot| self.inputs[slot].last_seq);
        let actors = state
            .actors
            .iter()
            .map(|actor| {
                let flags =
                    u8::from(actor.grounded_on.is_some()) | ((actor.jumps_remaining.min(3)) << 1);
                ActorSnap {
                    id: actor.config.id,
                    x: quantize_pos(actor.position.x as f32),
                    y: quantize_pos(actor.position.y as f32),
                    vx: quantize_vel(actor.move_velocity as f32),
                    vy: quantize_vel(actor.vertical_velocity as f32),
                    facing: actor.facing,
                    flags,
                    status: match actor.status {
                        ActorStatus::Alive => 0,
                        ActorStatus::Respawning => 1,
                        ActorStatus::Eliminated => 2,
                    },
                    stocks: actor.stocks.clamp(0, 255) as u8,
                    weapon: actor.weapon.weapon,
                    ammo: actor
                        .weapon
                        .ammo
                        .map(|ammo| ammo.clamp(0, 254) as u8)
                        .unwrap_or(255),
                    reserve: actor.weapon.reserve.clamp(0, 255) as u8,
                    fire_cd: (actor.fire_cooldown * 100.0).clamp(0.0, 255.0) as u8,
                    reload: (actor.reload_remaining * 100.0).clamp(0.0, 255.0) as u8,
                    protection: (actor.protection_remaining * 10.0).clamp(0.0, 255.0) as u8,
                    respawn: (actor.respawn_remaining * 10.0).clamp(0.0, 255.0) as u8,
                }
            })
            .collect();
        let projectiles = state
            .projectiles
            .iter()
            .map(|projectile| gunbrawl_proto::ProjSnap {
                id: projectile.id as u8,
                owner: projectile.owner,
                weapon: projectile.weapon,
                x: quantize_pos(projectile.position.x as f32),
                y: quantize_pos(projectile.position.y as f32),
                vx: quantize_vel(projectile.velocity.x as f32),
                vy: quantize_vel(projectile.velocity.y as f32),
            })
            .collect();
        let bombs = state
            .bombs
            .iter()
            .map(|bomb| BombSnap {
                id: bomb.id as u8,
                owner: bomb.owner,
                x: quantize_pos(bomb.position.x as f32),
                y: quantize_pos(bomb.position.y as f32),
            })
            .collect();
        let drops = state
            .drops
            .iter()
            .map(|drop| DropSnap {
                id: drop.id as u8,
                weapon: drop.weapon,
                x: quantize_pos(drop.position.x as f32),
                y: quantize_pos(drop.position.y as f32),
                state: u8::from(drop.state == DropState::Active),
                warning: drop.warning,
            })
            .collect();
        let events = events.iter().map(event_snap).collect();
        Snapshot {
            tick: self.tick,
            server_ms: (state.elapsed * 1000.0) as u64,
            phase: self.phase,
            remaining_ms: (state.remaining * 1000.0) as u32,
            acks,
            actors,
            projectiles,
            bombs,
            drops,
            events,
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
        self.broadcast(&S2C::Room(self.room_view()));
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
        self.actor_slots.iter().position(|index| *index == slot_index)
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

fn event_snap(event: &BattleEvent) -> EventSnap {
    let (kind, actor, position) = match event {
        BattleEvent::Shot {
            actor, position, ..
        } => (EVENT_SHOT, *actor, *position),
        BattleEvent::Hit { actor, position } => (EVENT_HIT, *actor, *position),
        BattleEvent::Bomb {
            actor, position, ..
        } => (EVENT_BOMB, *actor, *position),
        BattleEvent::Explosion { position, .. } => (EVENT_EXPLOSION, 0, *position),
        BattleEvent::Ringout {
            actor, position, ..
        } => (EVENT_RINGOUT, *actor, *position),
        BattleEvent::Respawn { actor, position } => (EVENT_RESPAWN, *actor, *position),
        BattleEvent::Pickup {
            actor, position, ..
        } => (EVENT_PICKUP, *actor, *position),
        BattleEvent::DropIncoming { position, .. } => (EVENT_DROP_INCOMING, 0, *position),
        BattleEvent::DropLanded { position, .. } => (EVENT_DROP_LANDED, 0, *position),
        BattleEvent::DropExpired { position, .. } => (EVENT_DROP_EXPIRED, 0, *position),
        BattleEvent::Phase(_) | BattleEvent::Overtime | BattleEvent::Finished(_) => {
            (0, 0, gunbrawl_core::types::Vec2::ZERO)
        }
        _ => (0, 0, gunbrawl_core::types::Vec2::ZERO),
    };
    EventSnap {
        kind,
        actor,
        x: quantize_pos(position.x as f32),
        y: quantize_pos(position.y as f32),
    }
}

pub async fn run_room(mut room: Room, mut rx: mpsc::Receiver<Command>) {
    let period = Duration::from_micros(1_000_000 / u64::from(TICK_RATE));
    let mut ticker = tokio::time::interval(period);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            command = rx.recv() => match command {
                Some(command) => room.handle(command),
                None => break,
            },
            _ = ticker.tick() => {
                room.step();
                if room.should_close() {
                    info!(room = %room.code(), "room idle, reclaiming");
                    break;
                }
            }
        }
    }
    info!(room = %room.code(), "room closed");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    fn test_room() -> Room {
        let content = Arc::new(Content::parse().expect("content data"));
        let metrics = Arc::new(Metrics::default());
        let config = RoomConfig {
            map: "sky-citadel".to_string(),
            stocks: 3,
            duration: 180,
            drop_mode: 0,
        };
        Room::new("TEST01".to_string(), config, content, metrics, None)
    }

    #[test]
    fn a_fresh_room_stays_open() {
        assert!(!test_room().should_close());
    }

    #[test]
    fn an_abandoned_room_is_reclaimed() {
        let mut room = test_room();
        room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
        assert!(room.should_close());
    }

    #[test]
    fn a_room_with_a_connected_human_is_never_reclaimed() {
        let mut room = test_room();
        let (tx, _rx) = mpsc::unbounded_channel();
        room.handle(Command::Join {
            player: Player { id: 7, name: "p".to_string() },
            sender: tx,
        });
        room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
        room.step();
        assert!(!room.should_close());
    }

    #[test]
    fn expired_reconnect_grace_frees_the_slot_and_lets_the_room_go() {
        let mut room = test_room();
        let (tx, _rx) = mpsc::unbounded_channel();
        room.handle(Command::Join {
            player: Player { id: 7, name: "p".to_string() },
            sender: tx,
        });
        room.handle(Command::Disconnect { player: 7 });
        assert!(room.slots.iter().any(|slot| slot.player == 7));
        assert!(!room.should_close(), "the grace period must outlive the disconnect");

        room.missing.insert(7, Instant::now() - RECONNECT_GRACE - Duration::from_secs(1));
        room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
        room.step();

        assert!(!room.slots.iter().any(|slot| slot.player == 7), "slot should be freed");
        assert!(room.should_close());
    }

    #[test]
    fn a_room_on_the_result_screen_stops_ticking() {
        let mut room = test_room();
        room.phase = PHASE_RESULT;
        let ticks_before = room.metrics.ticks.load(Ordering::Relaxed);
        let matches_before = room.metrics.matches.load(Ordering::Relaxed);

        for _ in 0..120 {
            room.step();
        }

        assert_eq!(room.metrics.ticks.load(Ordering::Relaxed), ticks_before);
        assert_eq!(room.metrics.matches.load(Ordering::Relaxed), matches_before);
    }

    #[test]
    fn a_match_that_runs_out_of_time_is_settled_exactly_once() {
        let mut room = test_room();
        room.config.duration = 1;
        let (tx, _rx) = mpsc::unbounded_channel();
        room.handle(Command::Join {
            player: Player { id: 1, name: "a".to_string() },
            sender: tx,
        });
        room.handle(Command::PickSlot { player: 1, slot: 1, kind: SLOT_BOT, difficulty: 1 });
        room.handle(Command::Start { player: 1 });
        assert_eq!(room.phase, PHASE_COUNTDOWN, "the match should have started");

        // 3 s countdown + 1 s match + overtime; 50 s of ticks is far past any of them.
        for _ in 0..3000 {
            room.step();
        }
        let settled = room.metrics.matches.load(Ordering::Relaxed);
        assert_eq!(settled, 1, "the finished match must be settled once");
        assert_eq!(room.phase, PHASE_RESULT);

        for _ in 0..300 {
            room.step();
        }
        assert_eq!(room.metrics.matches.load(Ordering::Relaxed), settled);
    }

    fn playing_room() -> Room {
        let mut room = test_room();
        let (tx, rx) = mpsc::unbounded_channel();
        std::mem::forget(rx); // keep the seat connected for the whole test
        room.handle(Command::Join {
            player: Player { id: 1, name: "human".to_string() },
            sender: tx,
        });
        room.handle(Command::PickSlot { player: 1, slot: 1, kind: SLOT_BOT, difficulty: 1 });
        room.handle(Command::Start { player: 1 });
        for _ in 0..200 {
            room.step(); // past the three second countdown
        }
        room
    }

    fn actor(room: &Room, index: usize) -> (ActorStatus, gunbrawl_core::types::Vec2) {
        let actor = &room.simulation.as_ref().expect("match running").state.actors[index];
        (actor.status, actor.position)
    }

    #[test]
    fn a_disconnected_player_keeps_playing_under_a_bot() {
        let mut room = playing_room();
        let (status, start) = actor(&room, 0);
        assert_eq!(status, ActorStatus::Alive);

        room.handle(Command::Disconnect { player: 1 });
        assert!(room.bots[0].is_some(), "a bot should take the seat");

        for _ in 0..120 {
            room.step();
        }
        let (status, moved) = actor(&room, 0);
        assert_eq!(status, ActorStatus::Alive);
        assert!(
            (moved.x - start.x).abs() > 1.0 || (moved.y - start.y).abs() > 1.0,
            "the seat should still be moving: {start:?} -> {moved:?}",
        );
    }

    #[test]
    fn reconnecting_takes_control_back_from_the_bot() {
        let mut room = playing_room();
        room.handle(Command::Disconnect { player: 1 });
        assert!(room.bots[0].is_some());

        let (tx, rx) = mpsc::unbounded_channel();
        std::mem::forget(rx);
        room.handle(Command::Resume {
            player: Player { id: 1, name: "human".to_string() },
            sender: tx,
        });
        assert!(room.bots[0].is_none(), "the human owns the seat again");
    }

    #[test]
    fn a_player_who_never_returns_is_eliminated_mid_match() {
        // Two humans, so the room keeps running after the first one gives up.
        let mut room = test_room();
        for (id, name) in [(1u32, "one"), (2, "two")] {
            let (tx, rx) = mpsc::unbounded_channel();
            std::mem::forget(rx);
            room.handle(Command::Join {
                player: Player { id, name: name.to_string() },
                sender: tx,
            });
        }
        room.handle(Command::Start { player: 1 });
        for _ in 0..200 {
            room.step();
        }

        room.handle(Command::Disconnect { player: 2 });
        room.missing
            .insert(2, Instant::now() - RECONNECT_GRACE - Duration::from_secs(1));
        room.step();

        let (status, _) = actor(&room, 1);
        assert_eq!(status, ActorStatus::Eliminated, "no ghost actors in the arena");
        assert!(room.slots.iter().all(|slot| slot.player != 2), "the seat is released");
    }
}

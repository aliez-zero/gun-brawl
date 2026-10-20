//! One authoritative room: slots, match lifecycle, 60 Hz simulation and
//! 30 Hz snapshot broadcast.
//!
//! The room owns all mutable game state. Sessions only forward commands and
//! receive encoded messages, so no lock is ever held across a tick.

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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

pub const MAX_SLOTS: usize = 4;
pub const ROOM_CODE_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTVWXYZ";

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
    phase: u8,
    simulation: Option<Simulation>,
    /// Actor index -> slot index for the running match.
    actor_slots: Vec<usize>,
    /// One controller per bot actor, aligned with actor index.
    bots: Vec<Option<BotController>>,
    inputs: [InputQueue; MAX_SLOTS],
    tick: u32,
    content: Arc<Content>,
    seed: u32,
}

impl Room {
    pub fn new(code: String, config: RoomConfig, content: Arc<Content>) -> Self {
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
            seed,
        }
    }

    pub fn code(&self) -> &str {
        &self.code
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
                if let Some(index) = self
                    .slots
                    .iter()
                    .position(|slot| slot.kind == SLOT_HUMAN && slot.player == player)
                {
                    self.slots[index] = Slot::empty();
                }
                self.players.remove(&player);
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
        self.phase = PHASE_COUNTDOWN;
        self.tick = 0;
        for queue in &mut self.inputs {
            *queue = InputQueue::new();
        }
        self.broadcast_room();
        info!(room = %self.code, actors = self.actor_slots.len(), "match started");
    }

    fn step(&mut self) {
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
        let events = simulation.drain_events();

        self.phase = match simulation.state.phase {
            MatchPhase::Countdown => PHASE_COUNTDOWN,
            MatchPhase::Playing | MatchPhase::Paused => PHASE_PLAYING,
            MatchPhase::Finished => PHASE_RESULT,
        };

        let finished = simulation.state.phase == MatchPhase::Finished;
        if self.tick.is_multiple_of(TICK_RATE / SNAPSHOT_RATE) || finished {
            let snapshot = self.build_snapshot(&simulation, &events);
            self.broadcast(&S2C::Snapshot(Box::new(snapshot)));
        }
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

    fn broadcast_room(&self) {
        self.broadcast(&S2C::Room(self.room_view()));
    }

    fn broadcast(&self, message: &S2C) {
        let Ok(payload) = encode(message) else {
            warn!(room = %self.code, "failed to encode message");
            return;
        };
        let payload = Bytes::from(payload);
        for sender in self.players.values() {
            let _ = sender.send(payload.clone());
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
            _ = ticker.tick() => room.step(),
        }
    }
    info!(room = %room.code(), "room closed");
}

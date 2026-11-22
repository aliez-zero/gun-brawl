//! Wire protocol shared by the browser client and the authoritative server.
//!
//! See `docs/CLIENT_SERVER_PLAN_V2.md` §6. Everything is `postcard`-encoded and
//! sent as WebSocket binary frames; the server never trusts positions, health or
//! hit results from a client.

use serde::{Deserialize, Serialize};

mod private;
mod snapshot;
pub use private::*;
pub use snapshot::*;

/// Bumped whenever the message layout or its meaning changes. The server
/// rejects `Hello` with any other value.
pub const PROTO_VERSION: u16 = 4;

/// One sampled input frame.
///
/// `held` carries buttons that stay down (fire); `edges` carries press-edges
/// that must be consumed exactly once. The server clears `edges` when it has to
/// repeat the previous frame, otherwise a lost packet turns into an auto-jump.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct InputFrame {
    pub seq: u32,
    /// Client's idea of the tick; used only for jitter statistics, never for rulings.
    pub tick_hint: u32,
    pub move_x: i8,
    pub held: u8,
    pub edges: u8,
}

pub const HELD_FIRE: u8 = 1 << 0;

pub const EDGE_JUMP: u8 = 1 << 0;
pub const EDGE_DROP: u8 = 1 << 1;
pub const EDGE_BOMB: u8 = 1 << 2;
pub const EDGE_RELOAD: u8 = 1 << 3;

impl InputFrame {
    pub fn fire(&self) -> bool {
        self.held & HELD_FIRE != 0
    }

    pub fn jump(&self) -> bool {
        self.edges & EDGE_JUMP != 0
    }

    pub fn drop(&self) -> bool {
        self.edges & EDGE_DROP != 0
    }

    pub fn bomb(&self) -> bool {
        self.edges & EDGE_BOMB != 0
    }

    pub fn reload(&self) -> bool {
        self.edges & EDGE_RELOAD != 0
    }

    /// A repeated frame keeps held buttons but never repeats an edge.
    pub fn repeat(previous: InputFrame, seq: u32, tick_hint: u32) -> Self {
        Self {
            seq,
            tick_hint,
            move_x: previous.move_x,
            held: previous.held,
            edges: 0,
        }
    }
}

/// Room slot kind on the wire.
pub const SLOT_EMPTY: u8 = 0;
pub const SLOT_HUMAN: u8 = 1;
pub const SLOT_BOT: u8 = 2;
pub const SLOT_DUMMY: u8 = 3;
pub const SLOT_EXTERNAL: u8 = 4;

/// Phase on the wire: lobby, countdown, playing, result.
pub const PHASE_LOBBY: u8 = 0;
pub const PHASE_COUNTDOWN: u8 = 1;
pub const PHASE_PLAYING: u8 = 2;
pub const PHASE_RESULT: u8 = 3;
pub const PHASE_PAUSED: u8 = 4;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotView {
    pub kind: u8,
    pub player: u32,
    pub name: String,
    pub ready: bool,
    pub difficulty: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomView {
    pub code: String,
    pub host: u32,
    pub phase: u8,
    pub map: String,
    pub stocks: u8,
    pub duration: u16,
    pub drop_mode: u8,
    pub slots: Vec<SlotView>,
    /// Weapons in server index order; snapshots refer to these indices.
    pub weapons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorWire {
    pub id: u32,
    pub name: String,
    pub stocks: i32,
    pub knockouts: u32,
    pub falls: u32,
    pub self_falls: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchResultWire {
    pub winner: Option<u32>,
    pub duration_ms: u32,
    pub overtime: bool,
    pub actors: Vec<ActorWire>,
}

/// Client -> server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum C2S {
    Hello {
        proto: u16,
        /// Hash of the content bundle the client was built with.
        content: u64,
        token: String,
        build: String,
    },
    CreateRoom {
        name: String,
        map: String,
        stocks: u8,
        duration: u16,
        drop_mode: u8,
    },
    JoinRoom {
        code: String,
        name: String,
    },
    PickSlot {
        slot: u8,
        kind: u8,
        difficulty: u8,
    },
    Ready {
        ready: bool,
    },
    Start,
    Rematch,
    Input {
        frames: Vec<InputFrame>,
    },
    Ping {
        t: u64,
    },
    Leave,
    StartPrivate {
        setup: PrivateMatch,
    },
    PrivateInput {
        actor: u8,
        frames: Vec<InputFrame>,
    },
    PrivateControl {
        action: PrivateAction,
    },
}

/// Server -> client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum S2C {
    Welcome {
        player_id: u32,
        name: String,
        token_expires: u64,
        tick_rate: u16,
        snapshot_rate: u16,
    },
    Room(RoomView),
    Snapshot(Box<Snapshot>),
    MatchEnd(MatchResultWire),
    Pong {
        t: u64,
        server_tick: u32,
    },
    Kick {
        code: u16,
        message: String,
    },
}

pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, postcard::Error> {
    postcard::to_allocvec(value)
}

/// Adapter so postcard can write into a borrowed `Vec<u8>` without taking
/// ownership; `Vec<u8>` itself only implements `Extend<u8>` by value.
struct BufferWriter<'a>(&'a mut Vec<u8>);

impl Extend<u8> for BufferWriter<'_> {
    fn extend<I: IntoIterator<Item = u8>>(&mut self, iter: I) {
        self.0.extend(iter);
    }
}

/// Encode into a caller-owned buffer so a room can reuse one allocation per
/// connection instead of allocating a fresh `Vec` for every snapshot.
pub fn encode_into<T: Serialize>(value: &T, out: &mut Vec<u8>) -> Result<(), postcard::Error> {
    out.clear();
    postcard::to_extend(value, BufferWriter(out)).map(|_| ())
}

pub fn decode<'a, T: Deserialize<'a>>(bytes: &'a [u8]) -> Result<T, postcard::Error> {
    postcard::from_bytes(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_round_trips() {
        let hello = C2S::Hello {
            proto: PROTO_VERSION,
            content: 0xdead_beef,
            token: "t".into(),
            build: "test".into(),
        };
        let bytes = encode(&hello).expect("encode");
        match decode::<C2S>(&bytes).expect("decode") {
            C2S::Hello {
                proto,
                content,
                token,
                ..
            } => {
                assert_eq!(proto, PROTO_VERSION);
                assert_eq!(content, 0xdead_beef);
                assert_eq!(token, "t");
            }
            other => panic!("unexpected message: {other:?}"),
        }
    }

    #[test]
    fn repeated_frame_clears_edges() {
        let pressed = InputFrame {
            seq: 7,
            tick_hint: 7,
            move_x: 1,
            held: HELD_FIRE,
            edges: EDGE_JUMP | EDGE_BOMB,
        };
        let repeated = InputFrame::repeat(pressed, 8, 8);
        assert!(repeated.fire());
        assert!(!repeated.jump());
        assert!(!repeated.bomb());
        assert_eq!(repeated.move_x, 1);
    }

    fn sample_snapshot() -> Snapshot {
        let actor = ActorSnap {
            id: 0,
            x: 1600,
            y: -320,
            vx: 240,
            vy: -160,
            impulse_x: 480,
            impulse_y: -320,
            facing: 1,
            flags: 0b1011,
            status: 0,
            stocks: 3,
            weapon: 2,
            ammo: 12,
            reserve: 48,
            fire_cd: 0,
            reload_ms: 0,
            protection: 0,
            respawn: 0,
            grounded_platform: 4,
            drop_platform: u8::MAX,
            drop_timer: 0,
            coyote_timer: 2,
            jump_timer: 0,
            bombs: 2,
            bomb_cooldown_ms: 0,
            knockouts: 1,
            falls: 0,
            self_falls: 0,
        };
        Snapshot {
            tick: 12_345,
            server_ms: 205_750,
            phase: PHASE_PLAYING,
            remaining_ms: 120_000,
            countdown_ms: 0,
            overtime: false,
            training_completed: 0,
            dummy_moving: false,
            external_epoch: 0,
            playing_tick: 12_000,
            acks: [42, 41, 40, 0],
            actors: vec![
                actor,
                ActorSnap { id: 1, ..actor },
                ActorSnap { id: 2, ..actor },
                ActorSnap { id: 3, ..actor },
            ],
            projectiles: (0..20)
                .map(|index| ProjSnap {
                    id: index as u32,
                    owner: (index % 4) as u8,
                    weapon: 2,
                    x: 900 + index * 40,
                    y: 300,
                    vx: 960,
                    vy: -480,
                })
                .collect(),
            bombs: vec![BombSnap {
                id: 1,
                owner: 0,
                x: 640,
                y: 500,
                fuse_ms: 1200,
                vx: 10,
                vy: -4,
            }],
            drops: vec![DropSnap {
                id: 1,
                weapon: 5,
                x: 320,
                y: 445,
                state: 1,
                warning: false,
                timer_ms: 4000,
            }],
            events: vec![EventSnap {
                kind: EVENT_HIT,
                actor: 0,
                x: 1600,
                y: -348,
                weapon: 0,
                object: 0,
                other: 255,
                radius: 0,
            }],
        }
    }

    #[test]
    fn browser_snapshot_fixture_matches_the_server() {
        let mut snapshot = sample_snapshot();
        snapshot.actors.truncate(1);
        snapshot.actors[0].reload_ms = 3200;
        snapshot.actors[0].bomb_cooldown_ms = 583;
        snapshot.projectiles.truncate(1);
        snapshot.projectiles[0].id = 321;
        snapshot.training_completed = 33;
        snapshot.dummy_moving = true;
        snapshot.external_epoch = 8;
        let bytes = encode(&S2C::Snapshot(Box::new(snapshot))).unwrap();
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/v4-snapshot.bin");
        if std::env::var("UPDATE_PROTOCOL_FIXTURE").as_deref() == Ok("1") {
            std::fs::write(&fixture, &bytes).unwrap();
        }
        assert_eq!(bytes, std::fs::read(fixture).unwrap());
    }

    #[test]
    fn snapshot_round_trips_and_stays_small() {
        let snapshot = sample_snapshot();
        let bytes = encode(&snapshot).expect("encode");
        assert!(
            bytes.len() < 900,
            "4 actors + 20 projectiles should stay under 900 B, got {}",
            bytes.len()
        );
        assert_eq!(decode::<Snapshot>(&bytes).expect("decode"), snapshot);
    }

    #[test]
    fn encode_into_reuses_the_buffer() {
        let snapshot = sample_snapshot();
        let mut buffer = Vec::with_capacity(1024);
        let capacity = buffer.capacity();
        encode_into(&snapshot, &mut buffer).expect("encode");
        assert!(!buffer.is_empty());
        encode_into(&snapshot, &mut buffer).expect("encode again");
        assert_eq!(
            buffer.capacity(),
            capacity,
            "encoding must not grow a warm buffer"
        );
    }
}

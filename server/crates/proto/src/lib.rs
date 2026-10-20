//! Wire protocol shared by the browser client and the authoritative server.
//!
//! See `docs/CLIENT_SERVER_PLAN_V2.md` §6. Everything is `postcard`-encoded and
//! sent as WebSocket binary frames; the server never trusts positions, health or
//! hit results from a client.

use serde::{Deserialize, Serialize};

/// Bumped whenever the message layout or its meaning changes. The server
/// rejects `Hello` with any other value.
pub const PROTO_VERSION: u16 = 1;

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
    Ready {
        ready: bool,
    },
    Input {
        frames: Vec<InputFrame>,
    },
    Ping {
        t: u64,
    },
    Leave,
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
    Pong {
        t: u64,
        server_tick: u32,
    },
    Kick {
        code: u16,
        message: String,
    },
}

/// Quantized snapshot wire format (plan §6.3).
///
/// Positions travel as 1/16 px and velocities as 1/8 px/s, stored in integers
/// so postcard can varint-encode them and both ends agree on the exact value.
pub const POS_SCALE: f32 = 16.0;
/// Velocity quantization factor for `ProjSnap`/`ActorSnap`.
pub const VEL_SCALE: f32 = 8.0;

pub fn quantize_pos(value: f32) -> i32 {
    (value * POS_SCALE).round() as i32
}

pub fn dequantize_pos(value: i32) -> f32 {
    value as f32 / POS_SCALE
}

pub fn quantize_vel(value: f32) -> i16 {
    (value * VEL_SCALE)
        .round()
        .clamp(i16::MIN as f32, i16::MAX as f32) as i16
}

pub fn dequantize_vel(value: i16) -> f32 {
    value as f32 / VEL_SCALE
}

/// One actor, 15 fields, roughly 20-24 bytes on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActorSnap {
    pub id: u8,
    pub x: i32,
    pub y: i32,
    pub vx: i16,
    pub vy: i16,
    pub facing: i8,
    /// bit0 grounded, bit1-2 jumps remaining, bit3 respawn protection.
    pub flags: u8,
    pub status: u8,
    pub stocks: u8,
    pub weapon: u8,
    pub ammo: u8,
    pub reserve: u8,
    pub fire_cd: u8,
    pub reload: u8,
    pub respawn: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjSnap {
    pub id: u8,
    pub owner: u8,
    pub x: i32,
    pub y: i32,
    pub vx: i16,
    pub vy: i16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventSnap {
    pub tick: u32,
    pub kind: u8,
    pub a: i32,
    pub b: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub tick: u32,
    pub server_ms: u64,
    /// Last consumed input seq per slot, 0 = none.
    pub acks: [u32; 4],
    pub actors: Vec<ActorSnap>,
    pub projectiles: Vec<ProjSnap>,
    pub events: Vec<EventSnap>,
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
            facing: 1,
            flags: 0b1011,
            status: 0,
            stocks: 3,
            weapon: 2,
            ammo: 12,
            reserve: 48,
            fire_cd: 0,
            reload: 0,
            respawn: 0,
        };
        Snapshot {
            tick: 12_345,
            server_ms: 205_750,
            acks: [42, 41, 40, 0],
            actors: vec![
                actor,
                ActorSnap { id: 1, ..actor },
                ActorSnap { id: 2, ..actor },
                ActorSnap { id: 3, ..actor },
            ],
            projectiles: (0..20)
                .map(|index| ProjSnap {
                    id: index as u8,
                    owner: (index % 4) as u8,
                    x: 900 + index * 40,
                    y: 300,
                    vx: 960,
                    vy: -480,
                })
                .collect(),
            events: vec![EventSnap {
                tick: 12_345,
                kind: 1,
                a: 0,
                b: 2,
            }],
        }
    }

    #[test]
    fn snapshot_round_trips_and_stays_small() {
        let snapshot = sample_snapshot();
        let bytes = encode(&snapshot).expect("encode");
        assert!(
            bytes.len() < 800,
            "4 actors + 20 projectiles should stay under 800 B, got {}",
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

use serde::{Deserialize, Serialize};

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

/// Authoritative actor state for rendering and movement replay.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActorSnap {
    pub id: u8,
    pub x: i32,
    pub y: i32,
    pub vx: i16,
    pub vy: i16,
    pub impulse_x: i16,
    pub impulse_y: i16,
    pub facing: i8,
    /// bit0 grounded, bit1-2 jumps remaining.
    pub flags: u8,
    pub status: u8,
    pub stocks: u8,
    pub weapon: u8,
    pub ammo: u8,
    pub reserve: u8,
    /// Centiseconds of fire cooldown left.
    pub fire_cd: u8,
    /// Milliseconds until the current weapon finishes reloading.
    pub reload_ms: u16,
    /// Deciseconds of spawn protection left.
    pub protection: u8,
    /// Deciseconds until respawn.
    pub respawn: u8,
    /// Platform IDs, with 255 representing no platform.
    pub grounded_platform: u8,
    pub drop_platform: u8,
    /// Movement timers encode elapsed fixed steps plus one. Zero means inactive.
    pub drop_timer: u8,
    pub coyote_timer: u8,
    pub jump_timer: u8,
    pub bombs: u8,
    /// Milliseconds until this actor may throw another bomb.
    pub bomb_cooldown_ms: u16,
    pub knockouts: u32,
    pub falls: u32,
    pub self_falls: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjSnap {
    pub id: u32,
    pub owner: u8,
    pub weapon: u8,
    pub x: i32,
    pub y: i32,
    pub vx: i16,
    pub vy: i16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BombSnap {
    pub id: u32,
    pub owner: u8,
    pub x: i32,
    pub y: i32,
    pub fuse_ms: u16,
    pub vx: i16,
    pub vy: i16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct DropSnap {
    pub id: u32,
    pub weapon: u8,
    pub x: i32,
    pub y: i32,
    /// 0 incoming, 1 active.
    pub state: u8,
    pub warning: bool,
    pub timer_ms: u16,
}

/// Visual/audio event kinds. Coordinates are quantized like actor positions.
pub const EVENT_SHOT: u8 = 1;
pub const EVENT_HIT: u8 = 2;
pub const EVENT_EXPLOSION: u8 = 3;
pub const EVENT_BOMB: u8 = 4;
pub const EVENT_RINGOUT: u8 = 5;
pub const EVENT_RESPAWN: u8 = 6;
pub const EVENT_PICKUP: u8 = 7;
pub const EVENT_DROP_INCOMING: u8 = 8;
pub const EVENT_DROP_LANDED: u8 = 9;
pub const EVENT_DROP_EXPIRED: u8 = 10;
pub const EVENT_PHASE: u8 = 11;
pub const EVENT_RELOAD: u8 = 12;
pub const EVENT_BOMB_EMPTY: u8 = 13;
pub const EVENT_OVERTIME: u8 = 14;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventSnap {
    pub kind: u8,
    pub actor: u8,
    pub x: i32,
    pub y: i32,
    pub weapon: u8,
    pub object: u32,
    /// Credited actor (255 for none), explosion source, or new phase by event kind.
    pub other: u8,
    pub radius: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub tick: u32,
    pub server_ms: u64,
    pub phase: u8,
    pub remaining_ms: u32,
    pub countdown_ms: u32,
    pub overtime: bool,
    /// Training bits in order: move, double jump, drop, hit, ringout, bomb.
    pub training_completed: u8,
    pub dummy_moving: bool,
    pub external_epoch: u32,
    /// Counts playing steps only, the time base for external AI decisions.
    pub playing_tick: u32,
    /// Last consumed input seq per slot, 0 = none.
    pub acks: [u32; 4],
    pub actors: Vec<ActorSnap>,
    pub projectiles: Vec<ProjSnap>,
    pub bombs: Vec<BombSnap>,
    pub drops: Vec<DropSnap>,
    pub events: Vec<EventSnap>,
}

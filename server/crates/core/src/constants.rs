//! Tuning constants, mirrored from `web/src/game/core/constants.ts`.

pub const TICK_RATE: u32 = 60;
pub const SNAPSHOT_RATE: u32 = 30;
pub const FIXED_STEP: f64 = 1.0 / TICK_RATE as f64;

pub const ACTOR_WIDTH: f64 = 36.0;
pub const ACTOR_HEIGHT: f64 = 52.0;

pub struct Movement {
    pub speed: f64,
    pub acceleration: f64,
    pub braking: f64,
    pub gravity: f64,
    pub jump: f64,
    pub air_jump: f64,
    pub coyote_time: f64,
    pub input_buffer: f64,
    pub drop_time: f64,
    pub impulse_half_life: f64,
    pub max_impulse: f64,
}

pub const MOVEMENT: Movement = Movement {
    speed: 300.0,
    acceleration: 2500.0,
    braking: 3000.0,
    gravity: 1800.0,
    jump: 720.0,
    air_jump: 620.0,
    coyote_time: 0.1,
    input_buffer: 0.1,
    drop_time: 0.2,
    impulse_half_life: 0.3,
    max_impulse: 900.0,
};

pub const RESPAWN_DELAY: f64 = 1.0;
pub const PROTECTION_TIME: f64 = 1.5;
pub const HIT_CREDIT_WINDOW: f64 = 5.0;

pub struct BombParams {
    pub per_life: u8,
    pub cooldown: f64,
    pub max_active: usize,
    pub fuse: f64,
    pub radius: f64,
    pub center_impulse: f64,
    pub edge_impulse: f64,
    pub gravity: f64,
    pub throw_velocity_x: f64,
    pub throw_velocity_y: f64,
    pub throw_offset_x: f64,
    pub throw_offset_y: f64,
    pub bounce: f64,
    pub body_radius: f64,
    pub min_bounce_speed: f64,
}

pub const BOMB: BombParams = BombParams {
    per_life: 2,
    cooldown: 0.6,
    max_active: 2,
    fuse: 1.1,
    radius: 170.0,
    center_impulse: 900.0,
    edge_impulse: 200.0,
    gravity: 1400.0,
    throw_velocity_x: 320.0,
    throw_velocity_y: -340.0,
    throw_offset_x: 18.0,
    throw_offset_y: 34.0,
    bounce: 0.45,
    body_radius: 10.0,
    min_bounce_speed: 40.0,
};

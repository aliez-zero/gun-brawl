//! Authoritative simulation state.
//!
//! Mirrors `web/src/game/core/types.ts` field by field. Identifiers that are
//! strings in TypeScript (actors, platforms, weapons) are indices here: the wire
//! format and the hot loop both want fixed-width ids, and content loading maps
//! the names once.

use serde::{Deserialize, Serialize};

pub type ActorId = u8;
pub type WeaponId = u8;
pub type PlatformId = u8;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const ZERO: Vec2 = Vec2 { x: 0.0, y: 0.0 };

    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GameMode {
    #[serde(rename = "duel-ai")]
    DuelAi,
    #[serde(rename = "local-duel")]
    LocalDuel,
    #[serde(rename = "training")]
    Training,
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "campaign")]
    Campaign,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchPhase {
    Countdown,
    Playing,
    Paused,
    Finished,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorStatus {
    Alive,
    Respawning,
    Eliminated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Difficulty {
    Easy,
    Normal,
    Hard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DropMode {
    All,
    Standard,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Control {
    Human(u8),
    Bot(Difficulty),
    Dummy,
    External,
}

#[derive(Debug, Clone)]
pub struct ActorConfig {
    pub id: ActorId,
    pub name: String,
    pub color: u32,
    pub control: Control,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActorInput {
    pub move_x: i8,
    pub jump_pressed: bool,
    pub drop_pressed: bool,
    pub shoot_held: bool,
    pub bomb_pressed: bool,
    pub reload_pressed: bool,
}

impl ActorInput {
    pub const IDLE: ActorInput = ActorInput {
        move_x: 0,
        jump_pressed: false,
        drop_pressed: false,
        shoot_held: false,
        bomb_pressed: false,
        reload_pressed: false,
    };
}

/// Fixed four-slot input table; missing slots read as idle.
pub type InputTable = [Option<ActorInput>; 4];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlatformKind {
    #[serde(rename = "one-way")]
    OneWay,
    #[serde(rename = "solid")]
    Solid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Platform {
    #[serde(skip)]
    pub id: PlatformId,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub kind: PlatformKind,
}

impl Platform {
    pub fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Bounds {
    pub left: f64,
    pub right: f64,
    pub top: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapDef {
    pub id: String,
    pub name: String,
    pub width: f64,
    pub height: f64,
    pub platforms: Vec<Platform>,
    pub spawns: Vec<Vec2>,
    #[serde(default, rename = "dropPoints")]
    pub drop_points: Vec<Vec2>,
    pub bounds: Bounds,
    #[serde(default)]
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeaponTier {
    #[serde(rename = "standard")]
    Standard,
    #[serde(rename = "ultimate")]
    Ultimate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ExplosionProfile {
    pub radius: f64,
    #[serde(rename = "centerImpulse")]
    pub center_impulse: f64,
    #[serde(rename = "edgeImpulse")]
    pub edge_impulse: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct Muzzle {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeaponDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub family: Option<String>,
    /// Model-specific muzzle offset, resolved from the presentation tables at
    /// content export time so the core does not carry art data.
    #[serde(default)]
    pub muzzle: Muzzle,
    pub tier: WeaponTier,
    pub interval: f64,
    #[serde(rename = "projectileSpeed")]
    pub projectile_speed: f64,
    pub range: f64,
    pub knockback: f64,
    pub recoil: f64,
    #[serde(default, rename = "recoilY")]
    pub recoil_y: Option<f64>,
    /// `None` means an infinite magazine (the baseline pistol).
    #[serde(default, rename = "maxAmmo")]
    pub max_ammo: Option<u16>,
    #[serde(default, rename = "reserveAmmo")]
    pub reserve_ammo: Option<u16>,
    #[serde(default, rename = "reloadTime")]
    pub reload_time: Option<f64>,
    pub pellets: u8,
    #[serde(rename = "spreadRadians")]
    pub spread_radians: f64,
    #[serde(default)]
    pub explosion: Option<ExplosionProfile>,
    #[serde(default, rename = "impulseCap")]
    pub impulse_cap: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WeaponInstance {
    pub weapon: WeaponId,
    pub ammo: Option<i32>,
    pub reserve: i32,
}

#[derive(Debug, Clone)]
pub struct MatchConfig {
    pub mode: GameMode,
    pub map: MapDef,
    pub weapons: Vec<WeaponDef>,
    pub actors: Vec<ActorConfig>,
    pub starting_weapon: WeaponId,
    /// Baseline fallback weapon (the infinite pistol), resolved by name.
    pub pistol: WeaponId,
    pub stocks: i32,
    pub duration: f64,
    pub countdown: f64,
    pub seed: u32,
    pub drop_mode: DropMode,
}

impl MatchConfig {
    pub fn weapon(&self, id: WeaponId) -> &WeaponDef {
        &self.weapons[id as usize]
    }

    pub fn weapon_id(&self, name: &str) -> Option<WeaponId> {
        self.weapons
            .iter()
            .position(|weapon| weapon.id == name)
            .map(|index| index as WeaponId)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LastHit {
    pub by: ActorId,
    pub at: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Stats {
    pub knockouts: u32,
    pub falls: u32,
    pub self_falls: u32,
}

#[derive(Debug, Clone)]
pub struct ActorState {
    pub config: ActorConfig,
    pub position: Vec2,
    pub previous: Vec2,
    pub move_velocity: f64,
    pub vertical_velocity: f64,
    pub impulse: Vec2,
    pub facing: i8,
    pub grounded_on: Option<PlatformId>,
    pub jumps_remaining: u8,
    pub coyote_remaining: f64,
    pub jump_buffer: f64,
    pub drop_platform: Option<PlatformId>,
    pub drop_remaining: f64,
    pub stocks: i32,
    pub status: ActorStatus,
    pub respawn_remaining: f64,
    pub protection_remaining: f64,
    pub fire_cooldown: f64,
    pub reload_remaining: f64,
    pub weapon: WeaponInstance,
    pub bombs_remaining: u8,
    pub bomb_cooldown: f64,
    pub last_hit: Option<LastHit>,
    pub stats: Stats,
}

impl ActorState {
    pub fn id(&self) -> ActorId {
        self.config.id
    }
}

#[derive(Debug, Clone)]
pub struct Projectile {
    pub id: u32,
    pub owner: ActorId,
    pub weapon: WeaponId,
    pub position: Vec2,
    pub previous: Vec2,
    pub origin: Option<Vec2>,
    pub direction: i8,
    pub velocity: Vec2,
    pub impulse: Vec2,
    pub distance_remaining: f64,
    pub explosion: Option<ExplosionProfile>,
    pub impulse_cap: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct WeaponDrop {
    pub id: u32,
    pub weapon: WeaponId,
    pub position: Vec2,
    pub state: DropState,
    pub timer: f64,
    pub warning: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DropState {
    Incoming,
    Active,
}

#[derive(Debug, Clone)]
pub struct Bomb {
    pub id: u32,
    pub owner: ActorId,
    pub position: Vec2,
    pub previous: Vec2,
    pub velocity: Vec2,
    pub fuse_remaining: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExplosionSource {
    Bomb,
    Rocket,
}

#[derive(Debug, Clone, Copy)]
pub struct ExplosionRequest {
    pub owner: ActorId,
    pub source: ExplosionSource,
    pub center: Vec2,
    pub radius: f64,
    pub center_impulse: f64,
    pub edge_impulse: f64,
    pub direction: Option<Vec2>,
}

#[derive(Debug, Clone)]
pub struct ActorResult {
    pub id: ActorId,
    pub name: String,
    pub stocks: i32,
    pub knockouts: u32,
    pub falls: u32,
    pub self_falls: u32,
}

#[derive(Debug, Clone)]
pub struct MatchResult {
    pub winner: Option<ActorId>,
    pub duration: f64,
    pub overtime: bool,
    pub actors: Vec<ActorResult>,
}

#[derive(Debug, Clone)]
pub enum BattleEvent {
    Shot {
        actor: ActorId,
        position: Vec2,
        weapon: WeaponId,
    },
    ReloadStart {
        actor: ActorId,
        position: Vec2,
        weapon: WeaponId,
    },
    Hit {
        actor: ActorId,
        position: Vec2,
    },
    Bomb {
        actor: ActorId,
        position: Vec2,
        bomb_id: u32,
    },
    BombEmpty {
        actor: ActorId,
        position: Vec2,
    },
    Explosion {
        source: ExplosionSource,
        owner: ActorId,
        position: Vec2,
        radius: f64,
    },
    DropIncoming {
        drop_id: u32,
        weapon: WeaponId,
        position: Vec2,
    },
    DropLanded {
        drop_id: u32,
        weapon: WeaponId,
        position: Vec2,
    },
    DropExpired {
        drop_id: u32,
        position: Vec2,
    },
    Pickup {
        actor: ActorId,
        weapon: WeaponId,
        position: Vec2,
        drop_id: u32,
    },
    Ringout {
        actor: ActorId,
        position: Vec2,
        credited_to: Option<ActorId>,
    },
    Respawn {
        actor: ActorId,
        position: Vec2,
    },
    Phase(MatchPhase),
    Overtime,
    Finished(MatchResult),
}

#[derive(Debug, Clone)]
pub struct MatchState {
    pub config: MatchConfig,
    pub phase: MatchPhase,
    pub actors: Vec<ActorState>,
    pub projectiles: Vec<Projectile>,
    pub bombs: Vec<Bomb>,
    pub drops: Vec<WeaponDrop>,
    pub elapsed: f64,
    pub remaining: f64,
    pub countdown_remaining: f64,
    pub overtime: bool,
    pub result: Option<MatchResult>,
}

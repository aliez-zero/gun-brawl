export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type GameMode = 'duel-ai' | 'local-duel' | 'training' | 'custom' | 'campaign';
export type MatchPhase = 'countdown' | 'playing' | 'paused' | 'finished';
export type ActorStatus = 'alive' | 'respawning' | 'eliminated';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type DropMode = 'all' | 'standard' | 'none';
export type TrainingTaskId = 'move' | 'double-jump' | 'drop' | 'hit' | 'ringout' | 'bomb';
export interface TrainingState {
  completed: Record<TrainingTaskId, boolean>;
  completedTasks: TrainingTaskId[];
  moveTime: number;
  dummyMoving: boolean;
}
export type HumanSlot = 1 | 2;
/** Stable IDs for the six PRD families. Five non-rocket families have content; rocket waits for T02. */
export type WeaponId =
  | 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rocket' | 'gatling' | 'cannon'
  | 'p1911' | 'deagle'
  | 'ump45' | 'vector' | 'uzi'
  | 'm416' | 'akm' | 'scar-l'
  | 's686' | 's1897' | 's12k'
  | 'kar98k' | 'm24' | 'awm'
  | 'rpg7' | 'at4';
export type WeaponTier = 'standard' | 'ultimate';
export type CharacterStyle = 'cowboy' | 'ronin' | 'operative' | 'astronaut' | 'knight';
export type Headwear = 'cowboy' | 'straw' | 'beret' | 'space' | 'knight' | 'none';
export interface CharacterAppearance {
  style: CharacterStyle;
  hat: Headwear;
  outfit: CharacterStyle;
  color: number;
  skin: number;
}
export type MapTheme = 'training' | 'citadel' | 'city' | 'starship';

export type ActorConfig = {
  id: string;
  name: string;
  color: number;
  appearance?: CharacterAppearance;
} & (
  | { control: 'human'; inputSlot: HumanSlot }
  | { control: 'bot'; difficulty: Difficulty }
  | { control: 'dummy' }
  | { control: 'external'; provider: 'deepseek' }
);

export interface ActorInput {
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  dropPressed: boolean;
  shootHeld: boolean;
  /** Press-edge consumed by T02; K / Numpad1 are wired by the keyboard adapter. */
  bombPressed: boolean;
  /** Press-edge; starts a manual reload when magazine and reserve allow it. */
  reloadPressed: boolean;
}

export const idleInput = (): ActorInput => ({
  moveX: 0, jumpPressed: false, dropPressed: false, shootHeld: false, bombPressed: false,
  reloadPressed: false,
});

export interface Platform extends Rect { id: string; kind: 'one-way' | 'solid' }

export interface MapDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  platforms: readonly Platform[];
  spawns: readonly Vec2[];
  /** Optional T04-provided safe drop points; T03 derives platform points when absent. */
  dropPoints?: readonly Vec2[];
  bounds: { left: number; right: number; top: number; bottom: number };
  theme?: MapTheme;
  subtitle?: string;
  description?: string;
  accent?: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  /** Concrete model uses a family's art / audio silhouette. */
  family?: WeaponId;
  /** Ultimate weapons are rare drops / training-only showcases, never the default pistol. */
  tier: WeaponTier;
  interval: number;
  projectileSpeed: number;
  range: number;
  knockback: number;
  recoil: number;
  /** Optional separate vertical recoil; models use it while legacy families keep 0. */
  recoilY?: number;
  /** Magazine capacity; null means infinite magazine (pistol). */
  maxAmmo: number | null;
  /** Rounds carried outside the magazine; refilled on pickup / spawn, not by firing. */
  reserveAmmo?: number;
  /** Seconds to refill the magazine from reserve. */
  reloadTime?: number;
  /** Projectiles per trigger; one trigger consumes one ammo even when this is greater than one. */
  pellets: number;
  /** Maximum absolute spread from the facing axis, in radians; 0 means a straight shot. */
  spreadRadians: number;
  /** Rocket-style payload; absent for ordinary bullets. */
  explosion?: ExplosionProfile;
  /** Optional higher clamp for a single direct hit (cannon-style launch). */
  impulseCap?: number;
}

export interface ExplosionProfile {
  radius: number;
  centerImpulse: number;
  edgeImpulse: number;
}

/**
 * Per-actor weapon state. The definition is a content value shared by all instances;
 * ammo is per actor. Fire cooldown stays on ActorState so switching guns cannot reset it.
 */
export interface WeaponInstance {
  readonly definition: WeaponDefinition;
  /** Rounds currently in the magazine; null for the infinite pistol. */
  ammoRemaining: number | null;
  /** Rounds available for reloads; starts at WeaponDefinition.reserveAmmo. */
  reserveRemaining: number;
}

export const createWeaponInstance = (definition: WeaponDefinition): WeaponInstance => ({
  definition, ammoRemaining: definition.maxAmmo, reserveRemaining: definition.reserveAmmo ?? 0,
});

export interface MatchConfig {
  mode: GameMode;
  map: MapDefinition;
  actors: readonly ActorConfig[];
  /** Reset target for spawn, respawn and overtime; pickups only change the current instance. */
  startingWeapon: WeaponDefinition;
  stocks: number;
  duration: number;
  countdown: number;
  seed: number;
  /** Per-match identity; decoupled from seed so the same seed can produce distinct results. */
  matchId?: string;
  /** Custom matches can disable drops or keep the standard pool only. */
  dropMode?: DropMode;
  /** Training progress restored from the save file. */
  trainingCompleted?: TrainingTaskId[];
  /** Set only by campaign levels; used for independent progression submission. */
  campaignLevelId?: string;
}

export interface ActorState {
  config: ActorConfig;
  position: Vec2;
  previous: Vec2;
  moveVelocity: number;
  verticalVelocity: number;
  impulse: Vec2;
  facing: -1 | 1;
  groundedOn: string | null;
  jumpsRemaining: number;
  coyoteRemaining: number;
  jumpBuffer: number;
  dropPlatform: string | null;
  dropRemaining: number;
  stocks: number;
  status: ActorStatus;
  respawnRemaining: number;
  protectionRemaining: number;
  fireCooldown: number;
  /** Seconds left in the current reload; 0 means not reloading. */
  reloadRemaining: number;
  weapon: WeaponInstance;
  bombsRemaining: number;
  bombCooldown: number;
  lastHit: { by: string; at: number } | null;
  stats: { knockouts: number; falls: number; selfFalls: number };
}

export interface Projectile {
  id: number;
  owner: string;
  /** Weapon and hit parameters are frozen when the shot is created; switching guns cannot alter it. */
  weaponId: WeaponId;
  position: Vec2;
  previous: Vec2;
  /** Muzzle spawn point; keeps the visual trail from extending behind the barrel. */
  origin?: Vec2;
  direction: -1 | 1;
  velocity: Vec2;
  impulse: Vec2;
  distanceRemaining: number;
  /** Frozen at fire time; rockets explode instead of applying a direct hit. */
  explosion?: ExplosionProfile;
  /** Frozen clamp override for this projectile's direct hit. */
  impulseCap?: number;
}

export interface WeaponDrop {
  id: number;
  weaponId: WeaponId;
  position: Vec2;
  state: 'incoming' | 'active';
  /** Seconds until landing, then seconds of active lifetime. */
  timer: number;
  warning: boolean;
}

export interface Bomb {
  id: number;
  owner: string;
  position: Vec2;
  previous: Vec2;
  velocity: Vec2;
  /** Remaining logical seconds before this bomb explodes. */
  fuseRemaining: number;
  /** Collision radius, kept in the frozen state so rendering and physics agree. */
  radius: number;
}

export type ExplosionSource = 'bomb' | 'rocket';

/** T02 owns the resolver. T01's rocket and T02's bomb pass a request, then apply the returned hits. */
export interface ExplosionRequest {
  ownerId: string;
  source: ExplosionSource;
  center: Vec2;
  radius: number;
  centerImpulse: number;
  edgeImpulse: number;
  /** Travel direction for a direct rocket impact; bombs omit it and stay radial. */
  direction?: Vec2;
}

export interface ExplosionHit {
  actorId: string;
  impulse: Vec2;
}

export interface ExplosionResolver {
  resolve(state: MatchState, request: ExplosionRequest): ExplosionHit[];
}

export interface MatchResult {
  id: string;
  mode: GameMode;
  campaignLevelId?: string;
  winner: string | null;
  duration: number;
  overtime: boolean;
  actors: Array<{
    id: string;
    name: string;
    stocks: number;
    knockouts: number;
    falls: number;
    selfFalls: number;
  }>;
}

export interface MatchState {
  config: MatchConfig;
  phase: MatchPhase;
  actors: ActorState[];
  projectiles: Projectile[];
  bombs: Bomb[];
  drops: WeaponDrop[];
  elapsed: number;
  remaining: number;
  countdownRemaining: number;
  overtime: boolean;
  result: MatchResult | null;
  training?: TrainingState;
}

export type BattleEvent =
  | { type: 'shot'; actorId: string; position: Vec2; weaponId?: WeaponId }
  | { type: 'reload-start'; actorId: string; position: Vec2; weaponId: WeaponId }
  | { type: 'hit'; actorId: string; position: Vec2 }
  | { type: 'bomb'; actorId: string; position: Vec2; bombId: number }
  | { type: 'bomb-empty'; actorId: string; position: Vec2 }
  | { type: 'explosion'; source: ExplosionSource; ownerId: string; position: Vec2; radius: number }
  | { type: 'drop-incoming'; dropId: number; weaponId: WeaponId; position: Vec2 }
  | { type: 'drop-landed'; dropId: number; weaponId: WeaponId; position: Vec2 }
  | { type: 'drop-expired'; dropId: number; position: Vec2 }
  | { type: 'pickup'; actorId: string; weaponId: WeaponId; position: Vec2; dropId: number }
  | { type: 'ringout'; actorId: string; position: Vec2; creditedTo: string | null }
  | { type: 'respawn'; actorId: string; position: Vec2 }
  | { type: 'phase'; phase: MatchPhase }
  | { type: 'overtime' }
  | { type: 'finished'; result: MatchResult };

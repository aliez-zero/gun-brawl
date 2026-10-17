export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type GameMode = 'duel-ai' | 'local-duel' | 'training';
export type MatchPhase = 'countdown' | 'playing' | 'paused' | 'finished';
export type ActorStatus = 'alive' | 'respawning' | 'eliminated';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type HumanSlot = 1 | 2;
/** Stable IDs for the six PRD weapon families. Only pistol has content in the current build. */
export type WeaponId = 'pistol' | 'smg' | 'rifle' | 'shotgun' | 'sniper' | 'rocket';
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
);

export interface ActorInput {
  moveX: -1 | 0 | 1;
  jumpPressed: boolean;
  dropPressed: boolean;
  shootHeld: boolean;
  /** Press-edge reserved for T02. Always false until T02/T06 wire the bomb key. */
  bombPressed: boolean;
}

export const idleInput = (): ActorInput => ({
  moveX: 0, jumpPressed: false, dropPressed: false, shootHeld: false, bombPressed: false,
});

export interface Platform extends Rect { id: string; kind: 'one-way' | 'solid' }

export interface MapDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  platforms: readonly Platform[];
  spawns: readonly Vec2[];
  bounds: { left: number; right: number; top: number; bottom: number };
  theme?: MapTheme;
  subtitle?: string;
  description?: string;
  accent?: number;
}

export interface WeaponDefinition {
  id: WeaponId;
  name: string;
  interval: number;
  projectileSpeed: number;
  range: number;
  knockback: number;
  recoil: number;
  /** null means infinite ammo. Finite weapons reset to this value on spawn/respawn. */
  maxAmmo: number | null;
}

/**
 * Per-actor weapon state. The definition is a content value shared by all instances;
 * ammo is per actor. Fire cooldown stays on ActorState so switching guns cannot reset it.
 */
export interface WeaponInstance {
  readonly definition: WeaponDefinition;
  ammoRemaining: number | null;
}

export const createWeaponInstance = (definition: WeaponDefinition): WeaponInstance => ({
  definition, ammoRemaining: definition.maxAmmo,
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
  weapon: WeaponInstance;
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
  direction: -1 | 1;
  velocity: Vec2;
  impulse: Vec2;
  distanceRemaining: number;
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
  elapsed: number;
  remaining: number;
  countdownRemaining: number;
  overtime: boolean;
  result: MatchResult | null;
}

export type BattleEvent =
  | { type: 'shot'; actorId: string; position: Vec2 }
  | { type: 'hit'; actorId: string; position: Vec2 }
  | { type: 'ringout'; actorId: string; position: Vec2; creditedTo: string | null }
  | { type: 'respawn'; actorId: string; position: Vec2 }
  | { type: 'phase'; phase: MatchPhase }
  | { type: 'overtime' }
  | { type: 'finished'; result: MatchResult };

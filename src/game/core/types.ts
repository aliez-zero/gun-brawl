export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }
export type GameMode = 'duel-ai' | 'local-duel' | 'training';
export type MatchPhase = 'countdown' | 'playing' | 'paused' | 'finished';
export type ActorStatus = 'alive' | 'respawning' | 'eliminated';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type HumanSlot = 1 | 2;
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
}

export const idleInput = (): ActorInput => ({
  moveX: 0, jumpPressed: false, dropPressed: false, shootHeld: false,
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
  id: string;
  name: string;
  interval: number;
  projectileSpeed: number;
  range: number;
  knockback: number;
  recoil: number;
}

export interface MatchConfig {
  mode: GameMode;
  map: MapDefinition;
  actors: readonly ActorConfig[];
  stocks: number;
  duration: number;
  countdown: number;
  seed: number;
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
  lastHit: { by: string; at: number } | null;
  stats: { knockouts: number; falls: number; selfFalls: number };
}

export interface Projectile {
  id: number;
  owner: string;
  position: Vec2;
  previous: Vec2;
  direction: -1 | 1;
  distanceRemaining: number;
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

export const FIXED_STEP = 1 / 60;
export const ACTOR_WIDTH = 36;
export const ACTOR_HEIGHT = 52;
export const MOVEMENT = {
  speed: 300,
  acceleration: 2500,
  braking: 3000,
  gravity: 1800,
  jump: 720,
  airJump: 620,
  coyoteTime: 0.1,
  inputBuffer: 0.1,
  dropTime: 0.2,
  impulseHalfLife: 0.3,
  maxImpulse: 900,
} as const;
export const RESPAWN_DELAY = 1;
export const PROTECTION_TIME = 1.5;
export const HIT_CREDIT_WINDOW = 5;
export const BOMB = {
  perLife: 2,
  cooldown: 0.6,
  maxActive: 2,
  // Short fuse so the throw is a commit: you cannot throw and walk away from it.
  fuse: 1.1,
  radius: 170,
  centerImpulse: 900,
  edgeImpulse: 200,
  gravity: 1400,
  throwVelocityX: 320,
  throwVelocityY: -340,
  throwOffsetX: 18,
  throwOffsetY: 34,
  bounce: 0.45,
  bodyRadius: 10,
  minBounceSpeed: 40,
} as const;

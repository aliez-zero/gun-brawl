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

import { ACTOR_HEIGHT, ACTOR_WIDTH, MOVEMENT } from './constants';
import type { ActorState, Rect, Vec2 } from './types';

export const approach = (value: number, target: number, amount: number): number =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);

export const actorRect = (actor: ActorState): Rect => ({
  x: actor.position.x - ACTOR_WIDTH / 2,
  y: actor.position.y - ACTOR_HEIGHT,
  width: ACTOR_WIDTH,
  height: ACTOR_HEIGHT,
});

export function addImpulse(actor: ActorState, x: number, y: number): void {
  actor.impulse.x += x;
  actor.impulse.y += y;
  const length = Math.hypot(actor.impulse.x, actor.impulse.y);
  if (length > MOVEMENT.maxImpulse) {
    actor.impulse.x *= MOVEMENT.maxImpulse / length;
    actor.impulse.y *= MOVEMENT.maxImpulse / length;
  }
}

// Swept intersection prevents fast projectiles from tunneling through a character.
export function segmentRect(from: Vec2, to: Vec2, rect: Rect): number | null {
  let entry = 0;
  let exit = 1;
  for (const axis of ['x', 'y'] as const) {
    const minimum = rect[axis];
    const maximum = minimum + (axis === 'x' ? rect.width : rect.height);
    const delta = to[axis] - from[axis];
    if (Math.abs(delta) < 1e-9) {
      if (from[axis] < minimum || from[axis] > maximum) return null;
      continue;
    }
    const a = (minimum - from[axis]) / delta;
    const b = (maximum - from[axis]) / delta;
    entry = Math.max(entry, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (entry > exit) return null;
  }
  return entry;
}

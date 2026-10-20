import type { Vec2 } from '../../game/core/types';

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function rotate(point: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: point.x * c - point.y * s, y: point.x * s + point.y * c };
}

export function offset(point: Vec2, origin: Vec2, angle = 0): Vec2 {
  const result = rotate(point, angle);
  return { x: result.x + origin.x, y: result.y + origin.y };
}

/** A bounded two-bone solve. Unreachable targets stop at reach; never produce NaN. */
export function solveLimb(root: Vec2, target: Vec2, upper: number, lower: number, bend: -1 | 1 = 1): { joint: Vec2; end: Vec2 } {
  const dx = target.x - root.x, dy = target.y - root.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.max(0.0001, Math.min(upper + lower - 0.0001, Math.max(Math.abs(upper - lower) + 0.0001, distance)));
  const ux = distance > 0.0001 ? dx / distance : 0;
  const uy = distance > 0.0001 ? dy / distance : 1;
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const across = Math.sqrt(Math.max(0, upper * upper - along * along)) * bend;
  return {
    joint: { x: root.x + ux * along - uy * across, y: root.y + uy * along + ux * across },
    end: { x: root.x + ux * reach, y: root.y + uy * reach },
  };
}

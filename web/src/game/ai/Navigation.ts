import type { ActorState, MapDefinition, Platform } from '../core/types';

export type NavAction = 'walk' | 'jump' | 'drop';
export interface NavStep { platform: Platform; action: NavAction }

const horizontalGap = (a: Platform, b: Platform): number => Math.max(
  0,
  a.x - (b.x + b.width),
  b.x - (a.x + a.width),
);

export function platformAt(map: MapDefinition, x: number, y: number): Platform | undefined {
  return map.platforms
    .filter((platform) => x >= platform.x - 8 && x <= platform.x + platform.width + 8 && Math.abs(platform.y - y) <= 42)
    .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0];
}

export function platformForActor(map: MapDefinition, actor: ActorState): Platform | undefined {
  if (actor.groundedOn) {
    const grounded = map.platforms.find((platform) => platform.id === actor.groundedOn);
    if (grounded) return grounded;
  }
  return platformAt(map, actor.position.x, actor.position.y);
}

/** Nearest platform by horizontal distance, used when a target is airborne. */
export function nearestPlatform(map: MapDefinition, x: number, y: number): Platform | undefined {
  return [...map.platforms].sort((a, b) => {
    const ax = Math.max(a.x - x, 0, x - (a.x + a.width));
    const bx = Math.max(b.x - x, 0, x - (b.x + b.width));
    return ax + Math.abs(a.y - y) * 0.35 - bx - Math.abs(b.y - y) * 0.35;
  })[0];
}

function edgeAction(from: Platform, to: Platform): NavAction | null {
  const gap = horizontalGap(from, to);
  if (gap > 240) return null;
  if (to.y < from.y - 24) return from.y - to.y <= 220 ? 'jump' : null;
  if (to.y > from.y + 24) return to.y - from.y <= 360 ? 'drop' : null;
  return gap <= 12 ? 'walk' : 'jump';
}

/**
 * Breadth-first route across platform landing edges. This is deliberately a
 * navigation helper, not a physics oracle: level routes are still validated by
 * the real movement tests, and an unreachable target falls back to local chase.
 */
export function planRoute(map: MapDefinition, fromId: string, toId: string): NavStep[] {
  if (fromId === toId) return [];
  const start = map.platforms.find((platform) => platform.id === fromId);
  const goal = map.platforms.find((platform) => platform.id === toId);
  if (!start || !goal) return [];
  const queue: Platform[] = [start];
  const previous = new Map<string, { from: Platform; action: NavAction }>();
  const seen = new Set<string>([start.id]);
  while (queue.length) {
    const current = queue.shift()!;
    const next = map.platforms
      .filter((platform) => !seen.has(platform.id))
      .sort((a, b) => {
        const aGoal = Math.hypot(a.x + a.width / 2 - goal.x - goal.width / 2, a.y - goal.y);
        const bGoal = Math.hypot(b.x + b.width / 2 - goal.x - goal.width / 2, b.y - goal.y);
        return aGoal - bGoal;
      });
    for (const platform of next) {
      const action = edgeAction(current, platform);
      if (!action) continue;
      seen.add(platform.id);
      previous.set(platform.id, { from: current, action });
      if (platform.id === goal.id) {
        const steps: NavStep[] = [];
        let cursor = platform;
        while (cursor.id !== start.id) {
          const entry = previous.get(cursor.id);
          if (!entry) break;
          steps.unshift({ platform: cursor, action: entry.action });
          cursor = entry.from;
        }
        return steps;
      }
      queue.push(platform);
    }
  }
  return [];
}

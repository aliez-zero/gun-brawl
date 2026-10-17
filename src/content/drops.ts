import type { WeaponId } from '../game/core/types';

export interface DropPoolEntry {
  weaponId: WeaponId;
  weight: number;
}

/** PRD family weights: SMG 25 / rifle 30 / shotgun 20 / sniper 15 / rocket 10. */
export const DEFAULT_DROP_POOL: readonly DropPoolEntry[] = [
  { weaponId: 'smg', weight: 25 },
  { weaponId: 'rifle', weight: 30 },
  { weaponId: 'shotgun', weight: 20 },
  { weaponId: 'sniper', weight: 15 },
  { weaponId: 'rocket', weight: 10 },
];

/** Invalid or non-positive weights are ignored; an empty pool is a legal "no drops" rule. */
export function normalizeDropPool(pool: readonly DropPoolEntry[]): DropPoolEntry[] {
  return pool
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .map((entry) => ({ weaponId: entry.weaponId, weight: entry.weight }));
}

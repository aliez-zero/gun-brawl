import type { WeaponId } from '../game/core/types';

export interface DropPoolEntry {
  weaponId: WeaponId;
  weight: number;
}

/** Standard family weights plus rare ultimate weapons. */
export const DEFAULT_DROP_POOL: readonly DropPoolEntry[] = [
  { weaponId: 'smg', weight: 25 },
  { weaponId: 'rifle', weight: 30 },
  { weaponId: 'shotgun', weight: 20 },
  { weaponId: 'sniper', weight: 15 },
  { weaponId: 'rocket', weight: 10 },
  { weaponId: 'gatling', weight: 5 },
  { weaponId: 'cannon', weight: 2 },
];

/** No ultimate weapons; used by custom "standard only" matches. */
export const STANDARD_DROP_POOL: readonly DropPoolEntry[] = DEFAULT_DROP_POOL.filter(
  (entry) => entry.weaponId !== 'gatling' && entry.weaponId !== 'cannon',
);

/** Invalid or non-positive weights are ignored; an empty pool is a legal "no drops" rule. */
export function normalizeDropPool(pool: readonly DropPoolEntry[]): DropPoolEntry[] {
  return pool
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)
    .map((entry) => ({ weaponId: entry.weaponId, weight: entry.weight }));
}

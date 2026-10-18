import type { WeaponId } from '../game/core/types';

export interface DropPoolEntry {
  weaponId: WeaponId;
  weight: number;
}

/** Seventeen-model weights; generic family ids remain training / legacy aliases. */
export const DEFAULT_DROP_POOL: readonly DropPoolEntry[] = [
  { weaponId: 'p1911', weight: 8 },
  { weaponId: 'deagle', weight: 4 },
  { weaponId: 'ump45', weight: 22 },
  { weaponId: 'vector', weight: 14 },
  { weaponId: 'uzi', weight: 12 },
  { weaponId: 'm416', weight: 26 },
  { weaponId: 'akm', weight: 18 },
  { weaponId: 'scar-l', weight: 16 },
  { weaponId: 's686', weight: 14 },
  { weaponId: 's1897', weight: 10 },
  { weaponId: 's12k', weight: 8 },
  { weaponId: 'kar98k', weight: 10 },
  { weaponId: 'm24', weight: 7 },
  { weaponId: 'awm', weight: 4 },
  { weaponId: 'rpg7', weight: 7 },
  { weaponId: 'at4', weight: 4 },
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

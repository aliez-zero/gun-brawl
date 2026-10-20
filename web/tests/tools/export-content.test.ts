import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DROP_POOL, STANDARD_DROP_POOL } from '../../src/content/drops';
import { ARENAS } from '../../src/content/maps';
import { WEAPONS, WEAPON_MODELS, weaponMuzzle } from '../../src/content/weapons';
import type { WeaponDefinition } from '../../src/game/core/types';

// One-shot generator: `EXPORT_CONTENT=1 pnpm vitest run tests/tools/export-content.test.ts`
const enabled = process.env.EXPORT_CONTENT === '1';
const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, '../../../server/crates/content/data');

function write(name: string, value: unknown): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(resolve(dataDir, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

describe.skipIf(!enabled)('content export', () => {
  it('writes maps, weapons and drop pools for the Rust core', () => {
    const maps = ARENAS.map((map) => ({ ...map }));
    const weapons = [...Object.values(WEAPONS), ...Object.values(WEAPON_MODELS)]
      .filter((weapon): weapon is WeaponDefinition => Boolean(weapon))
      .map((weapon) => ({ ...weapon, muzzle: weaponMuzzle(weapon.id) }));
    write('maps.json', maps);
    write('weapons.json', weapons);
    write('drops.json', { default: DEFAULT_DROP_POOL, standard: STANDARD_DROP_POOL });

    expect(maps).toHaveLength(4);
    expect(weapons.length).toBeGreaterThan(20);
    expect(new Set(weapons.map((weapon) => weapon.id)).size).toBe(weapons.length);
  });
});

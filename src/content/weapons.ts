import type { WeaponDefinition } from '../game/core/types';

export const BASIC_PISTOL: WeaponDefinition = {
  id: 'pistol', name: '基础手枪', interval: 0.28,
  // Sustained hits must beat inward running, while one hit still permits recovery.
  projectileSpeed: 1200, range: 750, knockback: 480, recoil: 12, maxAmmo: null,
};

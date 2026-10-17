import { createWeapon } from '../../content/weapons';
import type { ActorState, WeaponId } from '../core/types';

/**
 * Legal weapon entry points for T03 / T08. None of these touch fireCooldown:
 * switching or refilling must not let the next shot bypass the current cadence.
 */
export function equipWeapon(actor: ActorState, id: WeaponId): void {
  actor.weapon = createWeapon(id);
}

export function refillWeapon(actor: ActorState): void {
  actor.weapon.ammoRemaining = actor.weapon.definition.maxAmmo;
}

export function revertToPistol(actor: ActorState): void {
  actor.weapon = createWeapon('pistol');
}

export function hasAmmo(actor: ActorState): boolean {
  return actor.weapon.ammoRemaining === null || actor.weapon.ammoRemaining > 0;
}

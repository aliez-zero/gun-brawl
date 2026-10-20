import { createWeapon } from '../../content/weapons';
import type { ActorState, WeaponId } from '../core/types';

/**
 * Legal weapon entry points for T03 / T08. None of these touch fireCooldown:
 * switching or refilling must not let the next shot bypass the current cadence.
 */
export function equipWeapon(actor: ActorState, id: WeaponId): void {
  actor.weapon = createWeapon(id);
  actor.reloadRemaining = 0;
}

export function refillWeapon(actor: ActorState): void {
  actor.weapon.ammoRemaining = actor.weapon.definition.maxAmmo;
  actor.weapon.reserveRemaining = actor.weapon.definition.reserveAmmo ?? 0;
  actor.reloadRemaining = 0;
}

export function revertToPistol(actor: ActorState): void {
  actor.weapon = createWeapon('pistol');
  actor.reloadRemaining = 0;
}

/** A loaded magazine; reserve rounds alone cannot fire. */
export function hasAmmo(actor: ActorState): boolean {
  return actor.weapon.ammoRemaining === null || actor.weapon.ammoRemaining > 0;
}

export function canReload(actor: ActorState): boolean {
  const { definition } = actor.weapon;
  const magazine = actor.weapon.ammoRemaining;
  return definition.maxAmmo !== null && magazine !== null
    && magazine < definition.maxAmmo && actor.weapon.reserveRemaining > 0
    && actor.reloadRemaining <= 1e-8;
}

/** Begin a reload and return true when it actually started (or completed instantly). */
export function startReload(actor: ActorState): boolean {
  if (!canReload(actor)) return false;
  const time = actor.weapon.definition.reloadTime ?? 1.5;
  actor.reloadRemaining = Math.max(0, time);
  if (actor.reloadRemaining <= 1e-8) finishReload(actor);
  return true;
}

/** Transfer rounds from reserve to magazine; partial reload when reserve is short. */
export function finishReload(actor: ActorState): void {
  const max = actor.weapon.definition.maxAmmo;
  const magazine = actor.weapon.ammoRemaining;
  if (max === null || magazine === null) { actor.reloadRemaining = 0; return; }
  const missing = Math.max(0, max - magazine);
  const loaded = Math.min(missing, actor.weapon.reserveRemaining);
  actor.weapon.ammoRemaining = magazine + loaded;
  actor.weapon.reserveRemaining -= loaded;
  actor.reloadRemaining = 0;
}

/** Advance one reload timer; returns true while the actor is still reloading. */
export function tickReload(actor: ActorState, dt: number): boolean {
  if (actor.reloadRemaining <= 1e-8) return false;
  actor.reloadRemaining = Math.max(0, actor.reloadRemaining - dt);
  if (actor.reloadRemaining <= 1e-8) finishReload(actor);
  return actor.reloadRemaining > 1e-8;
}

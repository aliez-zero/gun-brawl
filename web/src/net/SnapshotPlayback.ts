import { BOMB, FIXED_STEP } from '../game/core/constants';
import type { MatchState, Vec2, WeaponDefinition } from '../game/core/types';
import type { LocalRenderPose } from './MatchSource';
import { EVENT_SHOT, PHASE_PLAYING, type Snapshot } from './protocol';
import { applyActorSnapshot, position, velocity } from './snapshotState';

const REMOTE_DELAY_TICKS = 4;
const EXTRAPOLATION_TICKS = 2;
const BUFFER_SIZE = 12;

type Point = { id: number; x: number; y: number };

function endpoints<T extends Point>(visible: T, first: T | undefined, second: T | undefined): { previous: Vec2; position: Vec2 } {
  if (first && second) return { previous: position(first), position: position(second) };
  const at = position(visible);
  return { previous: at, position: at };
}

/** Present actor and entity state at one pair of snapshot endpoints. */
export function presentPair(
  state: MatchState, weapons: readonly WeaponDefinition[], local: ReadonlyMap<number, LocalRenderPose>,
  from: Snapshot, to: Snapshot, visible: Snapshot,
): void {
  const { map, startingWeapon } = state.config;
  for (const wire of visible.actors) {
    const actor = state.actors[wire.id];
    if (!actor || local.has(wire.id)) continue;
    const first = from.actors.find((entry) => entry.id === wire.id);
    const second = to.actors.find((entry) => entry.id === wire.id);
    const continuous = first?.status === second?.status && first?.stocks === second?.stocks;
    Object.assign(actor, endpoints(wire, continuous ? first : undefined, second));
    applyActorSnapshot(actor, wire, map, weapons[wire.weapon] ?? startingWeapon);
  }

  state.projectiles = visible.projectiles.map((wire) => {
    const weapon = weapons[wire.weapon] ?? startingWeapon;
    const owner = state.config.actors[wire.owner]!.id;
    const match = (item: typeof wire) => item.id === wire.id && item.owner === wire.owner && item.weapon === wire.weapon;
    const path = endpoints(wire, from.projectiles.find(match), to.projectiles.find(match));
    const prior = state.projectiles.find((item) => item.id === wire.id && item.owner === owner && item.weaponId === weapon.id);
    const shot = visible.events.find((event) => event.kind === EVENT_SHOT && event.actor === wire.owner && event.weapon === wire.weapon);
    const origin = prior?.origin ?? (shot ? position(shot) : path.previous);
    const direction = wire.vx < 0 ? -1 : 1;
    return {
      id: wire.id, owner, weaponId: weapon.id, ...path, origin, direction, velocity: velocity(wire.vx, wire.vy),
      impulse: { x: direction * weapon.knockback, y: -0.2 * weapon.knockback },
      distanceRemaining: Math.max(0, weapon.range - Math.hypot(path.position.x - origin.x, path.position.y - origin.y)),
      explosion: weapon.explosion, impulseCap: weapon.impulseCap,
    };
  });

  state.bombs = visible.bombs.map((wire) => {
    const match = (item: typeof wire) => item.id === wire.id && item.owner === wire.owner;
    return {
      id: wire.id, owner: state.config.actors[wire.owner]!.id,
      ...endpoints(wire, from.bombs.find(match), to.bombs.find(match)),
      velocity: velocity(wire.vx, wire.vy), fuseRemaining: wire.fuseMs / 1000, radius: BOMB.bodyRadius,
    };
  });
  state.drops = visible.drops.map((wire) => ({
    id: wire.id, weaponId: (weapons[wire.weapon] ?? startingWeapon).id, position: position(wire),
    state: wire.state === 0 ? 'incoming' : 'active', timer: wire.timerMs / 1000, warning: wire.warning,
  }));
}

/** Continuous delayed playback for entities without a local WASM movement predictor. */
export class SnapshotPlayback {
  alpha = 0;
  private readonly snapshots: Snapshot[] = [];
  private playhead: number | null = null;
  private from?: Snapshot;
  private to?: Snapshot;
  private visible?: Snapshot;

  constructor(private readonly state: MatchState, private readonly weapons: readonly WeaponDefinition[],
    private readonly local: ReadonlyMap<number, LocalRenderPose>) {}

  get latest(): Snapshot | undefined { return this.snapshots.at(-1); }

  reset(): void {
    this.snapshots.length = 0;
    this.playhead = null;
    this.from = this.to = this.visible = undefined;
    this.alpha = 0;
  }

  push(wire: Snapshot): void {
    const latest = this.latest;
    if (latest && (latest.phase !== wire.phase || wire.serverMs < latest.serverMs || wire.overtime !== latest.overtime)) this.reset();
    this.snapshots.push(wire);
    if (this.snapshots.length > BUFFER_SIZE) this.snapshots.shift();
    if (this.playhead === null || wire.phase !== PHASE_PLAYING) this.advance(0);
  }

  advance(elapsed: number): void {
    const newest = this.latest;
    const oldest = this.snapshots[0];
    if (!oldest || !newest) return;
    if (newest.phase !== PHASE_PLAYING || oldest === newest) {
      this.present(newest, newest, 0);
      return;
    }
    const target = Math.max(oldest.tick, newest.tick - REMOTE_DELAY_TICKS);
    if (this.playhead === null || this.playhead < oldest.tick || target - this.playhead > 8) {
      this.playhead = target;
    } else {
      const drift = target - this.playhead + 0.5;
      const rate = 1 + Math.max(-0.1, Math.min(0.1, drift * 0.025));
      this.playhead = Math.min(newest.tick + EXTRAPOLATION_TICKS, this.playhead + elapsed / FIXED_STEP * rate);
    }
    const right = this.snapshots.findIndex((frame) => frame.tick > this.playhead!);
    const to = right < 0 ? newest : this.snapshots[right]!;
    const from = right < 0 ? this.snapshots.at(-2) ?? newest : this.snapshots[right - 1] ?? to;
    this.present(from, to, from === to ? 0 : (this.playhead - from.tick) / (to.tick - from.tick));
  }

  private present(from: Snapshot, to: Snapshot, alpha: number): void {
    this.alpha = alpha;
    const visible = alpha >= 1 ? to : from;
    if (from === this.from && to === this.to && visible === this.visible) return;
    this.from = from;
    this.to = to;
    this.visible = visible;
    presentPair(this.state, this.weapons, this.local, from, to, visible);
  }
}

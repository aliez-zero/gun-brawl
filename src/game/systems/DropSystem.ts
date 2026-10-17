import { DEFAULT_DROP_POOL, normalizeDropPool } from '../../content/drops';
import type { DropPoolEntry } from '../../content/drops';
import { actorRect } from '../core/math';
import type { ActorState, BattleEvent, MapDefinition, MatchState, Vec2, WeaponDrop } from '../core/types';
import { equipWeapon } from './WeaponSystem';

const FIRST_DROP = 8;
const DROP_INTERVAL = 8;
const INCOMING_TIME = 1;
const ACTIVE_LIFE = 20;
const WARNING_TIME = 3;
const MAX_ACTIVE = 3;
const PICKUP_WIDTH = 32;
const PICKUP_HEIGHT = 32;
const SAFE_SPAWN_DISTANCE = 120;

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  next(): number {
    this.state = (Math.imul(1664525, this.state) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }
}

/**
 * T03 drop scheduler and pickup resolver. It owns its timer/random streams so
 * countdown/pause cannot advance them accidentally; callers only invoke update
 * while the simulation is playing.
 */
export class DropSystem {
  private readonly pool: DropPoolEntry[];
  private nextDropIn = FIRST_DROP;
  private nextDropId = 0;
  private initialized = false;
  private overtimeHandled = false;
  private pointsRandom!: SeededRandom;
  private weaponsRandom!: SeededRandom;
  private tieRandom!: SeededRandom;

  constructor(pool: readonly DropPoolEntry[] = DEFAULT_DROP_POOL) {
    this.pool = normalizeDropPool(pool);
  }

  update(state: MatchState, dt: number, events: BattleEvent[]): void {
    this.initialize(state);
    if (state.overtime && !this.overtimeHandled) {
      this.overtimeHandled = true;
      this.nextDropIn = FIRST_DROP;
      state.drops = [];
    }

    this.updateTimers(state, dt, events);
    this.nextDropIn -= dt;
    if (this.nextDropIn <= 1e-8) {
      this.nextDropIn += DROP_INTERVAL;
      this.trySpawn(state, events);
    }
    this.resolvePickups(state, events);
  }

  private initialize(state: MatchState): void {
    if (this.initialized) return;
    this.initialized = true;
    this.pointsRandom = new SeededRandom(state.config.seed ^ 0x9e3779b9);
    this.weaponsRandom = new SeededRandom(state.config.seed ^ 0x85ebca6b);
    this.tieRandom = new SeededRandom(state.config.seed ^ 0xc2b2ae35);
    this.overtimeHandled = state.overtime;
  }

  private updateTimers(state: MatchState, dt: number, events: BattleEvent[]): void {
    for (const drop of state.drops) {
      drop.timer -= dt;
      if (drop.state === 'incoming' && drop.timer <= 0) {
        drop.state = 'active';
        drop.timer = ACTIVE_LIFE;
        drop.warning = false;
        events.push({ type: 'drop-landed', dropId: drop.id, weaponId: drop.weaponId, position: { ...drop.position } });
      } else if (drop.state === 'active') {
        drop.warning = drop.timer <= WARNING_TIME;
      }
    }
  }

  private trySpawn(state: MatchState, events: BattleEvent[]): void {
    if (state.drops.length >= MAX_ACTIVE || this.pool.length === 0) return;
    const points = this.safePoints(state.config.map);
    if (points.length === 0) return;
    const point = points[Math.floor(this.pointsRandom.next() * points.length)]!;
    const weaponId = this.pickWeapon();
    const drop: WeaponDrop = {
      id: this.nextDropId++, weaponId, position: { ...point },
      state: 'incoming', timer: INCOMING_TIME, warning: false,
    };
    state.drops.push(drop);
    events.push({ type: 'drop-incoming', dropId: drop.id, weaponId: drop.weaponId, position: { ...drop.position } });
  }

  private safePoints(map: MapDefinition): Vec2[] {
    const raw: Vec2[] = map.dropPoints ? [...map.dropPoints] : [];
    if (raw.length === 0) {
      for (const platform of map.platforms) {
        if (platform.width < 80) continue;
        for (const fraction of [0.25, 0.5, 0.75]) {
          raw.push({ x: platform.x + platform.width * fraction, y: platform.y });
        }
      }
    }
    const { left, right, top, bottom } = map.bounds;
    return raw.filter((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= left + 16 && point.x <= right - 16
      && point.y >= top + 16 && point.y <= bottom - 16
      && map.spawns.every((spawn) => Math.hypot(spawn.x - point.x, spawn.y - point.y) >= SAFE_SPAWN_DISTANCE));
  }

  private pickWeapon() {
    const total = this.pool.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = this.weaponsRandom.next() * total;
    for (const entry of this.pool) {
      roll -= entry.weight;
      if (roll <= 1e-8) return entry.weaponId;
    }
    return this.pool[this.pool.length - 1]!.weaponId;
  }

  private resolvePickups(state: MatchState, events: BattleEvent[]): void {
    const picked = new Set<number>();
    const recipients = new Set<string>();
    for (const drop of state.drops) {
      if (drop.state !== 'active') continue;
      const candidates = state.actors.filter((actor) =>
        actor.status === 'alive' && !recipients.has(actor.config.id) && this.touches(actor, drop.position));
      if (candidates.length === 0) continue;
      const ranked = candidates.map((actor) => ({
        actor,
        distance: Math.hypot(actor.position.x - drop.position.x, actor.position.y - drop.position.y),
        tie: this.tieRandom.next(),
      })).sort((a, b) => a.distance - b.distance || a.tie - b.tie);
      const winner = ranked[0]!.actor;
      equipWeapon(winner, drop.weaponId);
      recipients.add(winner.config.id);
      picked.add(drop.id);
      events.push({
        type: 'pickup', actorId: winner.config.id, weaponId: drop.weaponId,
        position: { ...drop.position }, dropId: drop.id,
      });
    }

    state.drops = state.drops.filter((drop) => {
      if (picked.has(drop.id)) return false;
      if (drop.state === 'active' && drop.timer <= 0) {
        events.push({ type: 'drop-expired', dropId: drop.id, position: { ...drop.position } });
        return false;
      }
      return true;
    });
  }

  private touches(actor: ActorState, point: Vec2): boolean {
    const body = actorRect(actor);
    const box = { x: point.x - PICKUP_WIDTH / 2, y: point.y - PICKUP_HEIGHT, width: PICKUP_WIDTH, height: PICKUP_HEIGHT };
    return body.x < box.x + box.width && body.x + body.width > box.x
      && body.y < box.y + box.height && body.y + body.height > box.y;
  }
}

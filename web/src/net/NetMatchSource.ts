/**
 * Snapshot-driven match source: renders the authoritative state and forwards
 * local input. Prediction lands in P4; for now the local actor moves when the
 * server confirms, and remote actors interpolate between snapshots.
 */
import { presetAppearance } from '../content/appearances';
import { getArena } from '../content/maps';
import { BASIC_PISTOL, getWeapon } from '../content/weapons';
import { createActor } from '../game/core/actors';
import type {
  ActorConfig,
  ActorInput,
  ActorState,
  BattleEvent,
  Bomb,
  GameMode,
  MapDefinition,
  MatchConfig,
  MatchPhase,
  MatchState,
  Projectile,
  Vec2,
  WeaponDefinition,
  WeaponDrop,
  WeaponId,
} from '../game/core/types';
import type { MatchSource } from './MatchSource';
import type { NetClient } from './NetClient';
import type { Predictor } from './Predictor';
import {
  EDGE_BOMB,
  EDGE_DROP,
  EDGE_JUMP,
  EDGE_RELOAD,
  EVENT_BOMB,
  EVENT_DROP_EXPIRED,
  EVENT_DROP_INCOMING,
  EVENT_DROP_LANDED,
  EVENT_EXPLOSION,
  EVENT_HIT,
  EVENT_PICKUP,
  EVENT_RESPAWN,
  EVENT_RINGOUT,
  EVENT_SHOT,
  HELD_FIRE,
  PHASE_PLAYING,
  PHASE_RESULT,
  SLOT_BOT,
  SLOT_EMPTY,
  type RoomView,
  type Snapshot,
} from './protocol';

const SNAPSHOT_INTERVAL = 1000 / 30;
/** Local simulation step, matching the server tick rate. */
const FIXED_STEP = 1 / 60;
/** Never simulate more than this much wall time in one frame (tab stall, breakpoint). */
const MAX_CATCH_UP = 0.1;
const POS_SCALE = 16;
const VEL_SCALE = 8;

const STYLES = ['cowboy', 'ronin', 'operative', 'astronaut', 'knight'] as const;

function position(x: number, y: number): Vec2 {
  return { x: x / POS_SCALE, y: y / POS_SCALE };
}

export class NetMatchSource implements MatchSource {
  readonly client: NetClient;
  readonly room: RoomView;
  private readonly map: MapDefinition;
  private readonly weapons: WeaponDefinition[];
  private readonly config: MatchConfig;
  private readonly stateValue: MatchState;
  private snapshot: Snapshot | null = null;
  private snapshotAt = 0;
  private snapshotInterval = SNAPSHOT_INTERVAL;
  private stepAccumulator = 0;
  private lastAdvanceAt = 0;
  private alphaValue = 0;
  private seq = 0;
  private pendingEvents: BattleEvent[] = [];
  private readonly predictor: Predictor | null;
  private predictHandle: number | null = null;
  readonly localActor: number;

  constructor(client: NetClient, room: RoomView, predictor: Predictor | null = null) {
    this.client = client;
    this.room = room;
    this.predictor = predictor;
    this.map = getArena(room.map);
    this.weapons = room.weapons.map((id) => getWeapon(id as WeaponId));
    const active = room.slots
      .map((slot, slotIndex) => ({ slot, slotIndex }))
      .filter(({ slot }) => slot.kind !== SLOT_EMPTY);
    this.localActor = active.findIndex(({ slot }) => slot.player === client.playerId);
    if (predictor && this.localActor >= 0) {
      const spawn = this.map.spawns[this.localActor] ?? this.map.spawns[0]!;
      this.predictHandle = predictor.create(predictor.mapIndex(this.map.id), spawn.x, spawn.y);
    }

    const actors: ActorState[] = active.map(({ slot }, index) => {
      const style = STYLES[index % STYLES.length]!;
      const config: ActorConfig = slot.kind === SLOT_BOT
        ? { id: `p${index}`, name: slot.name, color: 0xffffff, control: 'bot', difficulty: 'normal' }
        : { id: `p${index}`, name: slot.name, color: 0xffffff, control: 'human', inputSlot: ((index % 2) + 1) as 1 | 2 };
      config.appearance = presetAppearance(style);
      const spawn = this.map.spawns[index] ?? this.map.spawns[0]!;
      return createActor(config, spawn, room.stocks, this.map.width / 2, BASIC_PISTOL);
    });

    this.config = {
      mode: 'custom' as GameMode,
      map: this.map,
      actors: actors.map((actor) => actor.config),
      startingWeapon: BASIC_PISTOL,
      stocks: room.stocks,
      duration: room.duration,
      countdown: 3,
      seed: 0,
    };
    this.stateValue = {
      config: this.config,
      phase: 'countdown',
      actors,
      projectiles: [],
      bombs: [],
      drops: [],
      elapsed: 0,
      remaining: room.duration,
      countdownRemaining: 0,
      overtime: false,
      result: null,
    };
  }

  get state(): Readonly<MatchState> {
    return this.stateValue;
  }

  get alpha(): number {
    return this.alphaValue;
  }

  get latency(): { rtt: number; jitter: number } {
    return this.latencyValue;
  }

  private latencyValue = { rtt: 0, jitter: 0 };

  setLatency(rtt: number, jitter: number): void {
    this.latencyValue = { rtt, jitter };
  }

  applySnapshot(snapshot: Snapshot): void {
    const now = performance.now();
    const delta = now - this.snapshotAt;
    // Track the real arrival interval so remote interpolation plays back at the rate the
    // snapshots actually arrive; a fixed 33 ms divisor made jittery links stutter.
    if (this.snapshotAt !== 0 && delta > 8 && delta < 250) {
      this.snapshotInterval = this.snapshotInterval * 0.8 + delta * 0.2;
    }
    this.snapshot = snapshot;
    this.snapshotAt = now;
    const state = this.stateValue;
    state.phase = this.phaseOf(snapshot);
    state.remaining = snapshot.remainingMs / 1000;
    state.elapsed = snapshot.serverMs / 1000;

    for (let index = 0; index < state.actors.length; index++) {
      const actor = state.actors[index]!;
      const wire = snapshot.actors[index];
      if (!wire) continue;
      // The locally predicted actor owns its own position: copying the authoritative one
      // here (and re-predicting a frame later) made the sprite alternate between two
      // coordinates every snapshot — the visible jitter.
      const predictedLocally = this.predictor !== null && this.predictHandle !== null && index === this.localActor;
      if (!predictedLocally) {
        actor.previous = { ...actor.position };
        actor.position = position(wire.x, wire.y);
        actor.facing = wire.facing < 0 ? -1 : 1;
        actor.groundedOn = wire.flags & 1 ? 'net' : null;
        actor.jumpsRemaining = (wire.flags >> 1) & 0b11;
      }
      actor.status = wire.status === 0 ? 'alive' : wire.status === 1 ? 'respawning' : 'eliminated';
      actor.stocks = wire.stocks;
      actor.weapon = {
        definition: this.weapons[wire.weapon] ?? BASIC_PISTOL,
        ammoRemaining: wire.ammo === 255 ? null : wire.ammo,
        reserveRemaining: wire.reserve,
      };
      actor.fireCooldown = wire.fireCd / 100;
      actor.reloadRemaining = wire.reload / 100;
      actor.protectionRemaining = wire.protection / 10;
      actor.respawnRemaining = wire.respawn / 10;
    }

    // Reconcile the local prediction; small errors are ignored, big ones snap.
    if (this.predictor && this.predictHandle !== null && this.localActor >= 0) {
      const wire = snapshot.actors[this.localActor];
      if (wire) {
        const predicted = this.predictor.pose(this.predictHandle);
        const authoritative = position(wire.x, wire.y);
        if (
          wire.status !== 0
          || Math.abs(predicted.x - authoritative.x) > 24
          || Math.abs(predicted.y - authoritative.y) > 24
        ) {
          this.predictor.reconcile(this.predictHandle, {
            x: authoritative.x,
            y: authoritative.y,
            vx: wire.vx / VEL_SCALE,
            vy: wire.vy / VEL_SCALE,
            facing: wire.facing,
            grounded: wire.flags & 1,
            jumps: (wire.flags >> 1) & 0b11,
            dropRemaining: 0,
          });
        }
      }
    }

    state.projectiles = snapshot.projectiles.map((wire) => {
      const at = position(wire.x, wire.y);
      const velocity = { x: wire.vx / VEL_SCALE, y: wire.vy / VEL_SCALE };
      const projectile: Projectile = {
        id: wire.id,
        owner: `p${wire.owner}`,
        weaponId: (this.weapons[wire.weapon]?.id ?? 'pistol') as WeaponId,
        position: at,
        previous: { x: at.x - velocity.x / 120, y: at.y - velocity.y / 120 },
        origin: at,
        direction: velocity.x < 0 ? -1 : 1,
        velocity,
        impulse: { x: 0, y: 0 },
        distanceRemaining: 1000,
      };
      return projectile;
    });

    state.bombs = snapshot.bombs.map((wire): Bomb => {
      const at = position(wire.x, wire.y);
      return {
        id: wire.id,
        owner: `p${wire.owner}`,
        position: at,
        previous: at,
        velocity: { x: 0, y: 0 },
        fuseRemaining: 1,
        radius: 10,
      };
    });

    state.drops = snapshot.drops.map((wire): WeaponDrop => {
      const at = position(wire.x, wire.y);
      const definition = this.weapons[wire.weapon];
      return {
        id: wire.id,
        weaponId: (definition?.id ?? 'pistol') as WeaponId,
        position: at,
        state: wire.state === 0 ? 'incoming' : 'active',
        timer: wire.warning ? 3 : 10,
        warning: wire.warning,
      };
    });

    for (const event of snapshot.events) {
      const at = position(event.x, event.y);
      const actorId = `p${event.actor}`;
      switch (event.kind) {
        case EVENT_SHOT:
          this.pendingEvents.push({ type: 'shot', actorId, position: at });
          break;
        case EVENT_HIT:
          this.pendingEvents.push({ type: 'hit', actorId, position: at });
          break;
        case EVENT_EXPLOSION:
          this.pendingEvents.push({ type: 'explosion', source: 'rocket', ownerId: actorId, position: at, radius: 200 });
          break;
        case EVENT_BOMB:
          this.pendingEvents.push({ type: 'bomb', actorId, position: at, bombId: 0 });
          break;
        case EVENT_RINGOUT:
          this.pendingEvents.push({ type: 'ringout', actorId, position: at, creditedTo: null });
          break;
        case EVENT_RESPAWN:
          this.pendingEvents.push({ type: 'respawn', actorId, position: at });
          break;
        case EVENT_PICKUP:
          this.pendingEvents.push({ type: 'pickup', actorId, weaponId: 'pistol', position: at, dropId: 0 });
          break;
        case EVENT_DROP_INCOMING:
          this.pendingEvents.push({ type: 'drop-incoming', dropId: 0, weaponId: 'pistol', position: at });
          break;
        case EVENT_DROP_LANDED:
          this.pendingEvents.push({ type: 'drop-landed', dropId: 0, weaponId: 'pistol', position: at });
          break;
        case EVENT_DROP_EXPIRED:
          this.pendingEvents.push({ type: 'drop-expired', dropId: 0, position: at });
          break;
        default:
          break;
      }
    }
  }

  private phaseOf(snapshot: Snapshot): MatchPhase {
    if (snapshot.phase === PHASE_RESULT) return 'finished';
    if (snapshot.phase === PHASE_PLAYING) return 'playing';
    return 'countdown';
  }

  advance(_deltaMs: number, readHuman: (slot: 1 | 2) => ActorInput): BattleEvent[] {
    const input = readHuman(1);
    const edges =
      (input.jumpPressed ? EDGE_JUMP : 0) |
      (input.dropPressed ? EDGE_DROP : 0) |
      (input.bombPressed ? EDGE_BOMB : 0) |
      (input.reloadPressed ? EDGE_RELOAD : 0);

    const canPredict = this.predictor !== null
      && this.predictHandle !== null
      && this.localActor >= 0
      && this.stateValue.phase === 'playing';

    // Fixed 1/60 s local clock driven by wall time. Two bugs hid here before: stepping once
    // per rendered frame ran a 144 Hz display 2.4× too fast, and trusting Phaser's smoothed
    // `delta` (pinned to 16.7 ms) made a slow frame rate simulate in slow motion. Both
    // desynced the client from the 60 Hz server and showed up as jitter.
    const now = performance.now();
    const elapsed = this.lastAdvanceAt === 0 ? 0 : (now - this.lastAdvanceAt) / 1000;
    this.lastAdvanceAt = now;
    this.stepAccumulator = Math.min(
      this.stepAccumulator + Math.min(Math.max(elapsed, 0), MAX_CATCH_UP),
      MAX_CATCH_UP,
    );
    let first = true;
    while (this.stepAccumulator >= FIXED_STEP) {
      this.stepAccumulator -= FIXED_STEP;
      this.seq += 1;
      this.client.sendInput([{
        seq: this.seq,
        tickHint: 0,
        moveX: input.moveX,
        held: input.shootHeld ? HELD_FIRE : 0,
        edges: first ? edges : 0,
      }]);
      if (canPredict) {
        this.predictor!.step(this.predictHandle!, {
          moveX: input.moveX,
          jump: first && input.jumpPressed,
          drop: first && input.dropPressed,
          fire: input.shootHeld,
          bomb: first && input.bombPressed,
          reload: first && input.reloadPressed,
        });
      }
      first = false;
    }

    if (canPredict) {
      const predicted = this.predictor!.pose(this.predictHandle!);
      const actor = this.stateValue.actors[this.localActor];
      if (actor) {
        const at = { x: predicted.x, y: predicted.y };
        actor.position = at;
        actor.previous = at;
        actor.facing = predicted.facing < 0 ? -1 : 1;
        actor.groundedOn = predicted.grounded ? 'net' : null;
        actor.jumpsRemaining = predicted.jumps;
      }
    }

    this.alphaValue = this.snapshot
      ? Math.min(1, (performance.now() - this.snapshotAt) / this.snapshotInterval)
      : 0;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  dispose(): void {
    if (this.predictor && this.predictHandle !== null) {
      this.predictor.destroy(this.predictHandle);
      this.predictHandle = null;
    }
  }

  pause(): void {
    // An authoritative room cannot be paused by one client.
  }

  resume(): void {
    // No local pause state to resume.
  }
}

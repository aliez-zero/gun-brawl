/**
 * Predicts local movement and renders other entities from buffered server snapshots.
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
import { netStats } from './NetStats';
import type { PredictedPose, Predictor } from './Predictor';
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
  type ActorSnap,
  type InputFrame,
  type RoomView,
  type Snapshot,
} from './protocol';

/** Local simulation step, matching the server tick rate. */
const FIXED_STEP = 1 / 60;
/** Never simulate more than this much wall time in one frame (tab stall, breakpoint). */
const MAX_CATCH_UP = 0.1;
const MAX_PENDING_INPUTS = 60;
const LARGE_CORRECTION_PX = 24;
const REMOTE_DELAY_TICKS = 4;
const EXTRAPOLATION_TICKS = 2;
const SNAPSHOT_BUFFER_SIZE = 12;
const POS_SCALE = 16;
const VEL_SCALE = 8;

const STYLES = ['cowboy', 'ronin', 'operative', 'astronaut', 'knight'] as const;

function position(x: number, y: number): Vec2 {
  return { x: x / POS_SCALE, y: y / POS_SCALE };
}

function predictInput(frame: InputFrame) {
  return {
    moveX: frame.moveX,
    jump: (frame.edges & EDGE_JUMP) !== 0,
    drop: (frame.edges & EDGE_DROP) !== 0,
    fire: (frame.held & HELD_FIRE) !== 0,
    bomb: (frame.edges & EDGE_BOMB) !== 0,
    reload: (frame.edges & EDGE_RELOAD) !== 0,
  };
}

export class NetMatchSource implements MatchSource {
  readonly client: NetClient;
  readonly room: RoomView;
  private readonly map: MapDefinition;
  private readonly weapons: WeaponDefinition[];
  private readonly config: MatchConfig;
  private readonly stateValue: MatchState;
  private readonly snapshots: Snapshot[] = [];
  private renderTick: number | null = null;
  private presentedFrom: Snapshot | null = null;
  private presentedTo: Snapshot | null = null;
  private presentedVisible: Snapshot | null = null;
  private snapshotAt = 0;
  private lastSnapshotTick: number | null = null;
  private stepAccumulator = 0;
  private lastAdvanceAt = 0;
  /** Presses waiting for the next fixed step; see the note in `advance`. */
  private pendingEdges = 0;
  /**
   * Visual residue of a reconciliation: the sprite keeps its old screen position and slides
   * to the corrected one instead of teleporting. Purely cosmetic — the simulation state is
   * already the authoritative one.
   */
  private localOffsetValue = { x: 0, y: 0 };
  /** Pose after the most recent prediction step, used as the interpolation origin. */
  private lastStepPose: { x: number; y: number } | null = null;
  private localAlphaValue = 0;
  private alphaValue = 0;
  private seq = 0;
  private readonly pendingInputs: InputFrame[] = [];
  private awaitingPredictionSnapshot = true;
  private lastLocalStatus = -1;
  private lastLocalStocks = -1;
  private pendingEvents: BattleEvent[] = [];
  private readonly predictor: Predictor | null;
  private predictHandle: number | null = null;
  readonly localActorValue: number;
  private readonly localSlot: number;

  constructor(client: NetClient, room: RoomView, predictor: Predictor | null = null) {
    this.client = client;
    this.room = room;
    this.predictor = predictor;
    this.map = getArena(room.map);
    this.weapons = room.weapons.map((id) => getWeapon(id as WeaponId));
    const active = room.slots
      .map((slot, slotIndex) => ({ slot, slotIndex }))
      .filter(({ slot }) => slot.kind !== SLOT_EMPTY);
    this.localActorValue = active.findIndex(({ slot }) => slot.player === client.playerId);
    this.localSlot = active[this.localActorValue]?.slotIndex ?? -1;
    if (predictor && this.localActorValue >= 0) {
      const spawn = this.map.spawns[this.localActorValue] ?? this.map.spawns[0]!;
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

  get localActor(): number | undefined {
    return this.predictor && this.predictHandle !== null ? this.localActorValue : undefined;
  }

  get localAlpha(): number | undefined {
    return this.predictor && this.predictHandle !== null ? this.localAlphaValue : undefined;
  }

  /** Cosmetic residue of the last reconciliation, added to the rendered position. */
  get localOffset(): { x: number; y: number } | undefined {
    return this.predictor && this.predictHandle !== null ? this.localOffsetValue : undefined;
  }

  get latency(): { rtt: number; jitter: number } {
    return this.latencyValue;
  }

  private latencyValue = { rtt: 0, jitter: 0 };

  setLatency(rtt: number, jitter: number): void {
    this.latencyValue = { rtt, jitter };
  }

  applySnapshot(snapshot: Snapshot): void {
    let latest = this.snapshots.at(-1);
    if (latest?.phase === PHASE_RESULT && snapshot.phase !== PHASE_RESULT && snapshot.tick < latest.tick) {
      this.resetConnection();
      this.seq = 0;
      this.lastSnapshotTick = null;
      latest = undefined;
    }
    if (latest && snapshot.tick <= latest.tick) return;
    const now = performance.now();
    if (latest) {
      const delta = now - this.snapshotAt;
      netStats.gapSumMs += delta;
      netStats.gapMaxMs = Math.max(netStats.gapMaxMs, delta);
    }
    const previousTick = this.lastSnapshotTick;
    netStats.snapshots += 1;
    if (previousTick !== null && snapshot.tick > previousTick) {
      netStats.serverTicks += snapshot.tick - previousTick;
    }
    this.lastSnapshotTick = snapshot.tick;
    this.snapshotAt = now;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > SNAPSHOT_BUFFER_SIZE) this.snapshots.shift();

    const state = this.stateValue;
    const wasPlaying = state.phase === 'playing';
    state.phase = this.phaseOf(snapshot);
    state.remaining = snapshot.remainingMs / 1000;
    state.elapsed = snapshot.serverMs / 1000;
    const localActor = this.localActor;
    if (localActor !== undefined) {
      const actor = state.actors[localActor];
      const wire = snapshot.actors[localActor];
      if (actor && wire) this.updateActorInfo(actor, wire);
    }
    this.reconcileLocal(snapshot);
    if (!wasPlaying || state.phase !== 'playing') this.renderTick = null;
    if (this.renderTick === null) this.presentSnapshots(0);

    // The server replays the last snapshot after reconnect. Its visual state is useful,
    // but battle events in an already received packet must not play a second time.
    if (previousTick !== snapshot.tick) this.queueEvents(snapshot);
  }

  private updateActorInfo(actor: ActorState, wire: ActorSnap): void {
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

  private presentSnapshots(elapsed: number): void {
    const oldest = this.snapshots[0];
    const newest = this.snapshots.at(-1);
    if (!oldest || !newest) return;
    if (this.stateValue.phase !== 'playing' || oldest === newest) {
      this.presentPair(newest, newest, 0);
      return;
    }

    const target = Math.max(oldest.tick, newest.tick - REMOTE_DELAY_TICKS);
    // Recover promptly after a tab stall. Otherwise steer a continuous playhead
    // toward the target without resetting it on every packet arrival.
    if (this.renderTick === null || this.renderTick < oldest.tick || target - this.renderTick > 8) {
      this.renderTick = target;
    } else {
      const drift = target - this.renderTick + 0.5;
      const rate = 1 + Math.max(-0.1, Math.min(0.1, drift * 0.025));
      this.renderTick = Math.min(newest.tick + EXTRAPOLATION_TICKS, this.renderTick + elapsed / FIXED_STEP * rate);
    }
    const right = this.snapshots.findIndex((frame) => frame.tick > this.renderTick!);
    const to = right < 0 ? newest : this.snapshots[right]!;
    const from = right < 0 ? this.snapshots.at(-2) ?? newest : this.snapshots[right - 1] ?? to;
    const alpha = from === to ? 0 : (this.renderTick - from.tick) / (to.tick - from.tick);
    this.presentPair(from, to, alpha);
  }

  private presentPair(from: Snapshot, to: Snapshot, alpha: number): void {
    this.alphaValue = alpha;
    const visible = alpha >= 1 ? to : from;
    if (this.presentedFrom === from && this.presentedTo === to && this.presentedVisible === visible) return;
    this.presentedFrom = from;
    this.presentedTo = to;
    this.presentedVisible = visible;
    const state = this.stateValue;
    const localActor = this.localActor;
    for (let index = 0; index < state.actors.length; index++) {
      const actor = state.actors[index]!;
      const wire = visible.actors[index];
      if (!wire || index === localActor) continue;
      const first = from.actors[index];
      const second = to.actors[index];
      const continuous = first && second && first.status === second.status && first.stocks === second.stocks;
      actor.previous = continuous ? position(first.x, first.y) : position(wire.x, wire.y);
      actor.position = continuous ? position(second.x, second.y) : actor.previous;
      actor.facing = wire.facing < 0 ? -1 : 1;
      actor.groundedOn = wire.flags & 1 ? 'net' : null;
      actor.jumpsRemaining = (wire.flags >> 1) & 0b11;
      actor.moveVelocity = wire.vx / VEL_SCALE;
      actor.verticalVelocity = wire.vy / VEL_SCALE;
      this.updateActorInfo(actor, wire);
    }

    state.projectiles = visible.projectiles.map((wire) => {
      const first = from.projectiles.find((item) => item.id === wire.id && item.owner === wire.owner && item.weapon === wire.weapon);
      const second = to.projectiles.find((item) => item.id === wire.id && item.owner === wire.owner && item.weapon === wire.weapon);
      const previous = first && second ? position(first.x, first.y) : position(wire.x, wire.y);
      const at = first && second ? position(second.x, second.y) : previous;
      const velocity = { x: wire.vx / VEL_SCALE, y: wire.vy / VEL_SCALE };
      const prior = state.projectiles.find((item) => item.id === wire.id);
      const projectile: Projectile = {
        id: wire.id,
        owner: `p${wire.owner}`,
        weaponId: (this.weapons[wire.weapon]?.id ?? 'pistol') as WeaponId,
        position: at,
        previous,
        origin: prior?.origin ?? previous,
        direction: velocity.x < 0 ? -1 : 1,
        velocity,
        impulse: { x: 0, y: 0 },
        distanceRemaining: 1000,
      };
      return projectile;
    });

    state.bombs = visible.bombs.map((wire): Bomb => {
      const first = from.bombs.find((item) => item.id === wire.id && item.owner === wire.owner);
      const second = to.bombs.find((item) => item.id === wire.id && item.owner === wire.owner);
      const previous = first && second ? position(first.x, first.y) : position(wire.x, wire.y);
      const at = first && second ? position(second.x, second.y) : previous;
      return {
        id: wire.id,
        owner: `p${wire.owner}`,
        position: at,
        previous,
        velocity: { x: 0, y: 0 },
        fuseRemaining: 1,
        radius: 10,
      };
    });

    state.drops = visible.drops.map((wire): WeaponDrop => {
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
  }

  private queueEvents(snapshot: Snapshot): void {
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

  private reconcileLocal(snapshot: Snapshot): void {
    const predictor = this.predictor;
    const handle = this.predictHandle;
    const actor = this.stateValue.actors[this.localActorValue];
    const wire = snapshot.actors[this.localActorValue];
    if (!predictor || handle === null || !actor || !wire) return;

    const reset = this.awaitingPredictionSnapshot || snapshot.phase !== PHASE_PLAYING
      || wire.status !== 0 || this.lastLocalStatus !== wire.status || this.lastLocalStocks !== wire.stocks;
    this.awaitingPredictionSnapshot = false;
    this.lastLocalStatus = wire.status;
    this.lastLocalStocks = wire.stocks;
    const ack = snapshot.acks[this.localSlot] ?? 0;
    if (reset) this.pendingInputs.length = 0;
    else {
      const next = this.pendingInputs.findIndex((frame) => frame.seq > ack);
      this.pendingInputs.splice(0, next === -1 ? this.pendingInputs.length : next);
    }

    const before = predictor.pose(handle);
    predictor.reconcile(handle, this.authoritativePose(wire));
    let pose = predictor.pose(handle);
    let previous = pose;
    for (const frame of this.pendingInputs) {
      previous = pose;
      predictor.step(handle, predictInput(frame));
      pose = predictor.pose(handle);
    }

    // Compare the two predictions at the current input point. The un-replayed
    // snapshot is older and can differ even when client and server agree.
    if (reset) {
      this.localOffsetValue.x = 0;
      this.localOffsetValue.y = 0;
    } else {
      const error = Math.hypot(before.x - pose.x, before.y - pose.y);
      netStats.lastErrorPx = error;
      netStats.errorMaxPx = Math.max(netStats.errorMaxPx, error);
      if (error > LARGE_CORRECTION_PX) netStats.reconciles += 1;
      if (Math.hypot(before.impulseX - pose.impulseX, before.impulseY - pose.impulseY) > 40) {
        netStats.velocityAdoptions += 1;
      }

      // Keep the displayed position continuous when replacing both interpolation endpoints.
      const alpha = this.localAlphaValue;
      const shiftX = (actor.previous.x - previous.x) * (1 - alpha) + (actor.position.x - pose.x) * alpha;
      const shiftY = (actor.previous.y - previous.y) * (1 - alpha) + (actor.position.y - pose.y) * alpha;
      if (Math.hypot(shiftX, shiftY) > 1) {
        this.localOffsetValue.x += shiftX;
        this.localOffsetValue.y += shiftY;
      }
    }
    this.writeLocalPose(actor, previous, pose);
  }

  private authoritativePose(wire: ActorSnap): Parameters<Predictor['reconcile']>[1] {
    return {
      ...position(wire.x, wire.y),
      vx: wire.vx / VEL_SCALE,
      vy: wire.vy / VEL_SCALE,
      impulseX: wire.impulseX / VEL_SCALE,
      impulseY: wire.impulseY / VEL_SCALE,
      facing: wire.facing,
      grounded: wire.flags & 1,
      jumps: (wire.flags >> 1) & 0b11,
      groundedPlatform: wire.groundedPlatform,
      dropPlatform: wire.dropPlatform,
      dropTimer: wire.dropTimer,
      coyoteTimer: wire.coyoteTimer,
      jumpTimer: wire.jumpTimer,
    };
  }

  private writeLocalPose(actor: ActorState, previous: Vec2, pose: PredictedPose): void {
    actor.previous = { x: previous.x, y: previous.y };
    actor.position = { x: pose.x, y: pose.y };
    actor.facing = pose.facing < 0 ? -1 : 1;
    actor.groundedOn = pose.grounded ? 'net' : null;
    actor.jumpsRemaining = pose.jumps;
    actor.moveVelocity = pose.vx;
    actor.verticalVelocity = pose.vy;
    this.lastStepPose = actor.position;
  }

  resetConnection(): void {
    this.pendingInputs.length = 0;
    this.pendingEdges = 0;
    this.stepAccumulator = 0;
    this.lastAdvanceAt = 0;
    this.awaitingPredictionSnapshot = true;
    this.snapshots.length = 0;
    this.renderTick = null;
    this.pendingEvents.length = 0;
  }

  advance(_deltaMs: number, readHuman: (slot: 1 | 2) => ActorInput): BattleEvent[] {
    const input = readHuman(1);
    const edges =
      (input.jumpPressed ? EDGE_JUMP : 0) |
      (input.dropPressed ? EDGE_DROP : 0) |
      (input.bombPressed ? EDGE_BOMB : 0) |
      (input.reloadPressed ? EDGE_RELOAD : 0);
    // A press lasts one rendered frame, but a frame does not always advance the fixed step
    // clock (100/144 Hz displays run 0 steps on ~40 % of frames). Dropping the pulse there
    // is what made jumps — especially the second jump of a double jump — feel swallowed.
    this.pendingEdges |= edges;
    if (this.pendingEdges !== edges) {
      netStats.bufferedEdges += 1;
    }

    const canPredict = this.predictor !== null
      && this.predictHandle !== null
      && !this.awaitingPredictionSnapshot
      && this.lastLocalStatus === 0
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
    let previousStep: { x: number; y: number } | null = null;
    let lastPose: PredictedPose | null = null;
    while (this.stepAccumulator >= FIXED_STEP) {
      this.stepAccumulator -= FIXED_STEP;
      this.seq += 1;
      // Every edge that arrived since the previous step rides on this one, so nothing is
      // lost when a frame advances two steps or none.
      const frameEdges = this.pendingEdges;
      this.pendingEdges = 0;
      const frame: InputFrame = {
        seq: this.seq,
        tickHint: 0,
        moveX: input.moveX,
        held: input.shootHeld ? HELD_FIRE : 0,
        edges: frameEdges,
      };
      this.client.sendInput([frame]);
      netStats.inputFrames += 1;
      if (canPredict) {
        if (this.pendingInputs.length === MAX_PENDING_INPUTS) this.pendingInputs.shift();
        this.pendingInputs.push(frame);
        this.predictor!.step(this.predictHandle!, predictInput(frame));
        netStats.steps += 1;
        previousStep = this.lastStepPose;
        const pose = this.predictor!.pose(this.predictHandle!);
        this.lastStepPose = { x: pose.x, y: pose.y };
        lastPose = pose;
      }
    }

    if (canPredict) {
      // Keep the pair distinct so the renderer can interpolate between the two most recent
      // prediction steps; collapsing them (the old code) froze interpolation and turned
      // 60 Hz motion into visible steps on a faster display.
      if (lastPose) {
        const actor = this.stateValue.actors[this.localActorValue];
        if (actor) {
          this.writeLocalPose(actor, previousStep ?? lastPose, lastPose);
        }
      }
      this.localAlphaValue = Math.max(0, Math.min(1, this.stepAccumulator / FIXED_STEP));
    }

    // Exponential decay of the reconciliation residue: ~80 ms to settle, so a correction
    // reads as the character being carried by the knockback rather than snapping back.
    if (this.localOffsetValue.x !== 0 || this.localOffsetValue.y !== 0) {
      const decay = Math.exp(-Math.max(0, elapsed) / 0.08);
      this.localOffsetValue.x *= decay;
      this.localOffsetValue.y *= decay;
      if (Math.abs(this.localOffsetValue.x) < 0.4 && Math.abs(this.localOffsetValue.y) < 0.4) {
        this.localOffsetValue.x = 0;
        this.localOffsetValue.y = 0;
      }
    }

    this.presentSnapshots(Math.min(elapsed, MAX_CATCH_UP));
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

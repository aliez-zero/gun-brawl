import { ACTOR_WIDTH, FIXED_STEP } from '../game/core/constants';
import type { ActorInput, ActorState, HumanSlot, MapDefinition, MatchState, Vec2, WeaponDefinition } from '../game/core/types';
import { idleInput } from '../game/core/types';
import type { LocalRenderPose } from './MatchSource';
import type { NetClient } from './NetClient';
import { netStats } from './NetStats';
import type { PredictedPose, Predictor } from './Predictor';
import { EDGE_BOMB, EDGE_DROP, EDGE_JUMP, EDGE_RELOAD, HELD_FIRE, SLOT_EMPTY, SLOT_HUMAN,
  type ActorSnap, type InputFrame, type RoomView, type Snapshot } from './protocol';
import { applyActorSnapshot, position } from './snapshotState';

const MAX_PENDING_INPUTS = 60;
export const MAX_CATCH_UP = 0.1;

function inputEdges(input: ActorInput): number {
  return (input.jumpPressed ? EDGE_JUMP : 0) | (input.dropPressed ? EDGE_DROP : 0)
    | (input.bombPressed ? EDGE_BOMB : 0) | (input.reloadPressed ? EDGE_RELOAD : 0);
}

export function inputFrame(input: ActorInput, seq: number, tickHint: number, edges = inputEdges(input)): InputFrame {
  return { seq, tickHint, moveX: input.moveX, held: input.shootHeld ? HELD_FIRE : 0, edges };
}

function predictInput(frame: InputFrame) {
  return {
    moveX: frame.moveX, jump: !!(frame.edges & EDGE_JUMP), drop: !!(frame.edges & EDGE_DROP),
    bomb: !!(frame.edges & EDGE_BOMB), reload: !!(frame.edges & EDGE_RELOAD), fire: !!(frame.held & HELD_FIRE),
  };
}

/** One WASM actor and its unacknowledged inputs. All players share the same 60 Hz render clock. */
class LocalPrediction {
  readonly render: LocalRenderPose = { alpha: 0, offset: { x: 0, y: 0 } };
  private readonly history: InputFrame[] = [];
  private active = false;
  private stocks = -1;

  constructor(private readonly wasm: Predictor, private readonly handle: number,
    private readonly actor: ActorState, private readonly map: MapDefinition) {}

  reset(): void {
    this.history.length = 0;
    this.active = false;
    this.render.alpha = 0;
    this.render.offset.x = this.render.offset.y = 0;
  }

  reconcile(wire: ActorSnap, ack: number, playing: boolean): void {
    const active = playing && wire.status === 0;
    const reset = !active || !this.active || this.stocks !== wire.stocks;
    if (reset) this.reset();
    this.active = active;
    this.stocks = wire.stocks;
    while (this.history.length && this.history[0]!.seq <= ack) this.history.shift();

    const before = this.wasm.pose(this.handle);
    this.wasm.reconcile(this.handle, {
      ...position(wire), vx: wire.vx / 8, vy: wire.vy / 8, impulseX: wire.impulseX / 8, impulseY: wire.impulseY / 8,
      facing: wire.facing, grounded: wire.flags & 1, jumps: (wire.flags >> 1) & 3,
      groundedPlatform: wire.groundedPlatform, dropPlatform: wire.dropPlatform,
      dropTimer: wire.dropTimer, coyoteTimer: wire.coyoteTimer, jumpTimer: wire.jumpTimer,
    });
    let pose = this.wasm.pose(this.handle);
    let previous = pose;
    for (const frame of this.history) {
      previous = pose;
      this.wasm.step(this.handle, predictInput(frame));
      pose = this.wasm.pose(this.handle);
    }
    if (!reset) {
      const error = Math.hypot(before.x - pose.x, before.y - pose.y);
      netStats.lastErrorPx = error;
      netStats.errorMaxPx = Math.max(netStats.errorMaxPx, error);
      if (error > 24) netStats.reconciles++;
      if (Math.hypot(before.impulseX - pose.impulseX, before.impulseY - pose.impulseY) > 40) netStats.velocityAdoptions++;
      // Translate both interpolation endpoints so the sprite stays continuous through reconciliation.
      const { alpha, offset } = this.render;
      const shiftX = (this.actor.previous.x - previous.x) * (1 - alpha) + (this.actor.position.x - pose.x) * alpha;
      const shiftY = (this.actor.previous.y - previous.y) * (1 - alpha) + (this.actor.position.y - pose.y) * alpha;
      if (Math.hypot(shiftX, shiftY) > 1) { offset.x += shiftX; offset.y += shiftY; }
    }
    const ground = this.history.length ? undefined : this.map.platforms[wire.groundedPlatform]?.id;
    this.write(previous, pose, ground);
  }

  step(frame: InputFrame): void {
    if (!this.active) return;
    if (this.history.length >= MAX_PENDING_INPUTS) this.history.shift();
    this.history.push(frame);
    this.wasm.step(this.handle, predictInput(frame));
    this.write(this.actor.position, this.wasm.pose(this.handle));
    netStats.steps++;
  }

  private write(previous: Vec2, pose: PredictedPose, authoritativeGround?: string): void {
    const actor = this.actor;
    actor.previous = { x: previous.x, y: previous.y };
    actor.position = { x: pose.x, y: pose.y };
    actor.facing = pose.facing < 0 ? -1 : 1;
    actor.groundedOn = pose.grounded ? authoritativeGround ?? this.map.platforms.find((platform) =>
      Math.abs(pose.y - platform.y) < 0.07 && pose.x + ACTOR_WIDTH / 2 > platform.x && pose.x - ACTOR_WIDTH / 2 < platform.x + platform.width)?.id ?? null : null;
    actor.jumpsRemaining = pose.jumps;
    actor.moveVelocity = pose.vx;
    actor.verticalVelocity = pose.vy;
    actor.impulse = { x: pose.impulseX, y: pose.impulseY };
    actor.dropRemaining = pose.dropRemaining;
  }

  interpolate(alpha: number, elapsed: number): void {
    this.render.alpha = alpha;
    const { offset } = this.render;
    const decay = Math.exp(-elapsed / 0.08);
    offset.x *= decay;
    offset.y *= decay;
    if (Math.abs(offset.x) < 0.4 && Math.abs(offset.y) < 0.4) offset.x = offset.y = 0;
  }

  dispose(): void { this.wasm.destroy(this.handle); }
}

interface KeyboardPlayer {
  index: number;
  keyboard: HumanSlot;
  ackSlot: number;
  seq: number;
  pendingEdges: number;
  sampled: ActorInput;
  prediction?: LocalPrediction;
}

export class LocalPlayers {
  readonly poses = new Map<number, LocalRenderPose>();
  private readonly players: KeyboardPlayer[] = [];
  private accumulator = 0;
  private receivedSnapshot = false;

  constructor(private readonly client: NetClient, private readonly state: MatchState,
    private readonly privateMatch: boolean, room: RoomView, predictor: Predictor | null) {
    const { map } = state.config;
    const mapIndex = predictor?.mapIndex(map.id) ?? -1;
    const slots = room.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.kind !== SLOT_EMPTY);
    state.actors.forEach((actor, index) => {
      if (actor.config.control !== 'human') return;
      const shared = slots[index];
      if (!privateMatch && (shared?.slot.kind !== SLOT_HUMAN || shared.slot.player !== client.playerId)) return;
      const handle = predictor?.create(mapIndex, actor.position.x, actor.position.y);
      const prediction = predictor && handle != null ? new LocalPrediction(predictor, handle, actor, map) : undefined;
      if (prediction) this.poses.set(index, prediction.render);
      this.players.push({ index, keyboard: privateMatch ? actor.config.inputSlot : 1,
        ackSlot: privateMatch ? index : shared!.index, seq: 0, pendingEdges: 0, sampled: idleInput(), prediction });
    });
  }

  reconcile(snapshot: Snapshot, weapons: readonly WeaponDefinition[]): void {
    this.receivedSnapshot = true;
    for (const player of this.players) {
      const ack = snapshot.acks[player.ackSlot] ?? 0;
      // A refreshed public client can rejoin a slot whose server-side sequence has already advanced.
      player.seq = Math.max(player.seq, ack);
      if (!player.prediction) continue;
      const wire = snapshot.actors.find((entry) => entry.id === player.index);
      if (!wire) continue;
      const actor = this.state.actors[player.index]!;
      const { map, startingWeapon } = this.state.config;
      applyActorSnapshot(actor, wire, map, weapons[wire.weapon] ?? startingWeapon);
      player.prediction.reconcile(wire, ack, this.state.phase === 'playing');
    }
  }

  advance(elapsed: number, readHuman: (slot: HumanSlot) => ActorInput, tick: number): void {
    if (!this.receivedSnapshot || this.state.phase !== 'playing') return;
    this.accumulator = Math.min(this.accumulator + elapsed, MAX_CATCH_UP);
    const willStep = this.accumulator >= FIXED_STEP;
    for (const player of this.players) {
      player.sampled = readHuman(player.keyboard);
      const edges = inputEdges(player.sampled);
      player.pendingEdges |= edges;
      if (edges && !willStep) netStats.bufferedEdges++;
    }
    while (this.accumulator >= FIXED_STEP) {
      this.accumulator -= FIXED_STEP;
      for (const player of this.players) {
        const frame = inputFrame(player.sampled, ++player.seq, tick, player.pendingEdges);
        player.pendingEdges = 0;
        if (this.privateMatch) this.client.sendPrivateInput(player.index, [frame]);
        else this.client.sendInput([frame]);
        netStats.inputFrames++;
        player.prediction?.step(frame);
      }
    }
    for (const player of this.players) player.prediction?.interpolate(this.accumulator / FIXED_STEP, elapsed);
  }

  reset(newMatch = false): void {
    this.receivedSnapshot = false;
    this.accumulator = 0;
    for (const player of this.players) {
      if (newMatch) player.seq = 0;
      player.pendingEdges = 0;
      player.prediction?.reset();
    }
  }

  dispose(): void {
    for (const player of this.players) player.prediction?.dispose();
    this.players.length = 0;
    this.poses.clear();
  }
}

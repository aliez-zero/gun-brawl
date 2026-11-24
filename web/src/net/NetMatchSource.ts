import { getWeapon, WEAPON_SLOTS } from '../content/weapons';
import { MAX_OBSERVATION_AGE, parseExternalAction, type CommandContext } from '../game/ai/external/Protocol';
import type { ActorInput, BattleEvent, HumanSlot, MatchConfig, MatchResult, MatchState, WeaponDefinition, WeaponId } from '../game/core/types';
import { inputFrame, LocalPlayers, MAX_CATCH_UP } from './LocalPlayers';
import type { LocalRenderPose, MatchSource } from './MatchSource';
import { initialMatchState, sharedMatchConfig } from './matchSetup';
import type { NetClient } from './NetClient';
import { netStats } from './NetStats';
import type { Predictor } from './Predictor';
import { PHASE_COUNTDOWN, type MatchResultWire, type RoomView, type Snapshot } from './protocol';
import { presentPair, SnapshotPlayback } from './SnapshotPlayback';
import { battleEvent, updateMatchInfo } from './snapshotState';

const noPredictions: ReadonlyMap<number, LocalRenderPose> = new Map();
const intents = { attack: 1, recover: 2, collect: 3, reposition: 4 } as const;

/** One authoritative match, with buffered remote playback and prediction for this keyboard's players. */
export class NetMatchSource implements MatchSource {
  private readonly privateMatch: boolean;
  private readonly current: MatchState;
  private readonly weapons: WeaponDefinition[];
  private readonly players: LocalPlayers;
  private readonly playback: SnapshotPlayback;
  private readonly externalIndex: number;
  private externalSequence = -1;
  private observation?: { wire: Snapshot; state: MatchState };
  private lastSnapshotTick: number | null = null;
  private lastSnapshotAt = 0;
  private lastAdvanceAt: number | null = null;
  private events: BattleEvent[] = [];

  constructor(readonly client: NetClient, readonly room: RoomView, predictor: Predictor | null = null, config?: MatchConfig) {
    this.privateMatch = config !== undefined;
    this.current = initialMatchState(config ?? sharedMatchConfig(room));
    this.weapons = room.weapons.map((id) => getWeapon(id as WeaponId));
    this.players = new LocalPlayers(client, this.current, this.privateMatch, room, predictor);
    this.playback = new SnapshotPlayback(this.current, this.weapons, this.players.poses);
    this.externalIndex = this.current.config.actors.findIndex((actor) => actor.control === 'external');
  }

  get state(): Readonly<MatchState> { return this.current; }
  /** DeepSeek observations and their tick come from the same snapshot, before presentation interpolation or prediction. */
  get observationState(): Readonly<MatchState> {
    const wire = this.playback.latest;
    if (!wire || this.externalIndex < 0 || this.current.result) return this.current;
    if (this.observation?.wire !== wire) {
      const state = this.observation?.state ?? initialMatchState(this.current.config);
      updateMatchInfo(state, wire);
      presentPair(state, this.weapons, noPredictions, wire, wire, wire);
      this.observation = { wire, state };
    }
    return this.observation.state;
  }
  get alpha(): number { return this.playback.alpha; }
  get localPoses(): ReadonlyMap<number, LocalRenderPose> { return this.players.poses; }
  get tick(): number { return this.playback.latest?.playingTick ?? 0; }

  applySnapshot(wire: Snapshot): void {
    const previous = this.playback.latest;
    if (this.current.phase === 'finished' && wire.phase === PHASE_COUNTDOWN && wire.tick < (this.lastSnapshotTick ?? 0)) {
      this.resetConnection();
      this.lastSnapshotTick = null;
      this.current.result = null;
      this.players.reset(true);
    } else if (this.lastSnapshotTick !== null && (wire.tick < this.lastSnapshotTick || (previous && wire.tick === this.lastSnapshotTick))) {
      return;
    }
    const now = performance.now();
    if (this.playback.latest) {
      const gap = now - this.lastSnapshotAt;
      netStats.gapSumMs += gap;
      netStats.gapMaxMs = Math.max(netStats.gapMaxMs, gap);
    }
    netStats.snapshots++;
    const replay = this.lastSnapshotTick === wire.tick;
    if (this.lastSnapshotTick !== null) netStats.serverTicks += wire.tick - this.lastSnapshotTick;
    this.lastSnapshotAt = now;
    this.lastSnapshotTick = wire.tick;
    if (previous?.externalEpoch !== wire.externalEpoch) this.externalSequence = -1;
    if (previous && previous.phase !== wire.phase) {
      this.players.reset();
      this.lastAdvanceAt = null;
    }
    updateMatchInfo(this.current, wire);
    this.players.reconcile(wire, this.weapons);
    this.playback.push(wire);
    // A reconnect replays the previous snapshot. Its positions still matter, but its effects have already played.
    if (!replay) for (const entry of wire.events) {
      const event = battleEvent(entry, this.current, this.weapons);
      if (event) this.events.push(event);
    }
  }

  advance(_deltaMs: number, readHuman: (slot: HumanSlot) => ActorInput): BattleEvent[] {
    // Phaser's smoothed delta can stay at 16.7 ms across slow frames. Use elapsed wall time for the 60 Hz input clock.
    const now = performance.now();
    const elapsed = this.lastAdvanceAt === null ? 0 : Math.max(0, Math.min(MAX_CATCH_UP, (now - this.lastAdvanceAt) / 1000));
    this.lastAdvanceAt = now;
    this.players.advance(elapsed, readHuman, this.lastSnapshotTick ?? 0);
    this.playback.advance(elapsed);
    const events = this.events;
    this.events = [];
    return events;
  }

  finish(wire: MatchResultWire): MatchResult {
    if (this.current.result) return this.current.result;
    const { config } = this.current;
    const result: MatchResult = {
      id: config.matchId ?? `${config.seed}-${config.mode}`, mode: config.mode,
      ...(config.campaignLevelId && { campaignLevelId: config.campaignLevelId }),
      winner: wire.winner === null ? null : config.actors[wire.winner]?.id ?? null,
      duration: wire.durationMs / 1000, overtime: wire.overtime,
      actors: wire.actors.map(({ id, ...score }) => ({ ...score, id: config.actors[id]!.id })),
    };
    this.current.phase = 'finished';
    this.current.elapsed = result.duration;
    this.current.overtime = result.overtime;
    this.current.result = result;
    return result;
  }

  externalEpoch(actorId: string): number | undefined {
    if (this.current.config.actors[this.externalIndex]?.id !== actorId) return undefined;
    return this.playback.latest?.externalEpoch;
  }

  applyExternalInput(actorId: string, value: unknown, context: CommandContext): boolean {
    const wire = this.playback.latest;
    const action = parseExternalAction(value);
    if (!wire || !action || !this.client.connected || !this.privateMatch || this.current.phase !== 'playing'
      || this.externalEpoch(actorId) !== context.epoch || wire.actors.find((actor) => actor.id === this.externalIndex)?.status !== 0
      || !Number.isSafeInteger(context.sequence) || context.sequence <= this.externalSequence || context.sequence > 0xffffffff
      || !Number.isSafeInteger(context.observationTick) || context.observationTick < 0 || context.observationTick > this.tick
      || this.tick - context.observationTick >= MAX_OBSERVATION_AGE) return false;
    this.externalSequence = context.sequence;
    this.client.privateControl({
      type: 'external', actor: this.externalIndex, ...context, hold: action.holdFrames,
      input: inputFrame(action, context.sequence, context.observationTick), intent: action.intent ? intents[action.intent] : 0,
    });
    return true;
  }

  pause(): void { if (this.privateMatch) this.client.privateControl({ type: 'pause' }); }
  resume(): void { if (this.privateMatch) this.client.privateControl({ type: 'resume' }); }
  resetTraining(): boolean {
    if (!this.current.training) return false;
    this.client.privateControl({ type: 'resetTraining' });
    return true;
  }
  setDummyMoving(moving: boolean): void {
    if (this.current.training) this.client.privateControl({ type: 'setDummy', moving });
  }
  selectTrainingWeapon(slotOrId: number | WeaponId): boolean {
    const weapon = typeof slotOrId === 'number' ? WEAPON_SLOTS[slotOrId - 1] : slotOrId;
    if (!this.current.training || !weapon || !this.room.weapons.includes(weapon)) return false;
    this.client.privateControl({ type: 'selectWeapon', weapon });
    return true;
  }

  resetConnection(): void {
    this.players.reset();
    this.playback.reset();
    this.observation = undefined;
    this.externalSequence = -1;
    this.lastAdvanceAt = null;
    this.events.length = 0;
  }

  dispose(): void {
    this.resetConnection();
    this.players.dispose();
  }
}

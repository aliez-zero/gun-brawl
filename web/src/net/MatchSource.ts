import { MatchRunner } from '../game/core/MatchRunner';
import type { ActorInput, BattleEvent, HumanSlot, MatchConfig, MatchState } from '../game/core/types';

/**
 * The single seam between the scene and whatever produces battle state.
 *
 * Local play wraps `MatchRunner`; the networked build swaps in a source that
 * feeds snapshots into the same interface, so `ArenaScene` never learns where
 * state came from. Rendering already reads only `(state, alpha)`, so the draw
 * layers stay untouched.
 */
export interface MatchSource {
  readonly state: Readonly<MatchState>;
  readonly alpha: number;
  /**
   * Index into `state.actors` of the actor driven locally, when the source predicts it.
   * The renderer interpolates that actor with {@link localAlpha} instead of the shared
   * snapshot alpha, otherwise a 60 Hz prediction would step visibly on a 100/144 Hz
   * display while everything else interpolates smoothly.
   */
  readonly localActor?: number;
  readonly localAlpha?: number;
  advance(deltaMs: number, readHuman: (slot: HumanSlot) => ActorInput): BattleEvent[];
  pause(): void;
  resume(): void;
}

/** Local single-player / split-screen source: the existing runner, unchanged. */
export class LocalMatchSource implements MatchSource {
  private readonly runner: MatchRunner;

  constructor(config: MatchConfig) {
    this.runner = new MatchRunner(config);
  }

  get state(): Readonly<MatchState> {
    return this.runner.state;
  }

  get alpha(): number {
    return this.runner.alpha;
  }

  advance(deltaMs: number, readHuman: (slot: HumanSlot) => ActorInput): BattleEvent[] {
    return this.runner.advance(deltaMs, readHuman);
  }

  pause(): void {
    this.runner.pause();
  }

  resume(): void {
    this.runner.resume();
  }
}

import type { ActorInput, BattleEvent, HumanSlot, MatchState, Vec2 } from '../game/core/types';

/** Interpolation between two local prediction steps, with a decaying correction in pixels. */
export interface LocalRenderPose {
  alpha: number;
  offset: Vec2;
}

export interface MatchSource {
  readonly state: Readonly<MatchState>;
  readonly alpha: number;
  /** Predicted poses keyed by index in state.actors. */
  readonly localPoses: ReadonlyMap<number, LocalRenderPose>;
  advance(deltaMs: number, readHuman: (slot: HumanSlot) => ActorInput): BattleEvent[];
  pause(): void;
  resume(): void;
}

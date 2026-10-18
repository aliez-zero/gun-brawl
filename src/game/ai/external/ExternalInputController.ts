import { idleInput } from '../../core/types';
import type { ActorInput, ActorState, MatchState } from '../../core/types';
import { ACTOR_WIDTH } from '../../core/constants';
import { MAX_OBSERVATION_AGE, parseExternalAction } from './Protocol';
import type { CommandContext, ExternalAction } from './Protocol';

/** Synchronous input mailbox. Network and wall-clock decisions stay outside the simulation; only emergency safety input is local. */
export class ExternalInputController {
  epoch = 0;
  private lifecycle = '';
  private active = false;
  private lastSequence = -1;
  private action: ExternalAction | null = null;
  private untilTick = 0;
  private edgePending = false;
  private lastFallbackJumpTick = -Infinity;

  synchronize(actor: ActorState, state: Readonly<MatchState>): void {
    const key = `${state.phase}:${state.overtime}:${actor.status}:${actor.stocks}`;
    if (key !== this.lifecycle) {
      this.lifecycle = key;
      this.epoch++;
      this.action = null;
      this.edgePending = false;
      this.lastSequence = -1;
      this.lastFallbackJumpTick = -Infinity;
    }
    this.active = state.phase === 'playing' && actor.status === 'alive';
  }

  accept(value: unknown, context: CommandContext, tick: number): boolean {
    const action = parseExternalAction(value);
    const age = tick - context.observationTick;
    if (!this.active || !action || context.epoch !== this.epoch
      || !Number.isSafeInteger(context.sequence) || context.sequence <= this.lastSequence
      || !Number.isSafeInteger(context.observationTick) || age < 0 || age >= MAX_OBSERVATION_AGE) return false;
    this.lastSequence = context.sequence;
    this.action = action;
    this.untilTick = Math.min(tick + action.holdFrames, context.observationTick + MAX_OBSERVATION_AGE);
    this.edgePending = true;
    return true;
  }

  sample(tick: number, actor: ActorState, state: Readonly<MatchState>): ActorInput {
    if (!this.active) return idleInput();
    const emergency = this.emergencyInput(tick, actor, state);
    if (!this.action || tick >= this.untilTick) return emergency ?? idleInput();
    const edge = this.edgePending;
    this.edgePending = false;
    const a = this.action;
    if (emergency) return { ...emergency, shootHeld: a.shootHeld && emergency.moveX === a.moveX };
    return {
      moveX: a.moveX, shootHeld: a.shootHeld, jumpPressed: edge && a.jumpPressed,
      dropPressed: edge && a.dropPressed, bombPressed: edge && a.bombPressed,
      reloadPressed: edge && a.reloadPressed,
    };
  }

  /**
   * A tiny safety controller only takes over when a command is absent or the
   * actor is already in danger. It emits normal input and never edits state.
   */
  private emergencyInput(tick: number, actor: ActorState, state: Readonly<MatchState>): ActorInput | null {
    const map = state.config.map;
    const margin = Math.max(64, ACTOR_WIDTH * 1.5);
    const nearLeft = actor.position.x - ACTOR_WIDTH / 2 <= map.bounds.left + margin;
    const nearRight = actor.position.x + ACTOR_WIDTH / 2 >= map.bounds.right - margin;
    const falling = actor.groundedOn === null && actor.verticalVelocity > 0;
    let targetX: number | null = null;
    if (falling) {
      const candidates = map.platforms
        .filter((platform) => platform.y >= actor.position.y - 8 && platform.y - actor.position.y < 280)
        .map((platform) => {
          const overlaps = actor.position.x >= platform.x - ACTOR_WIDTH / 2
            && actor.position.x <= platform.x + platform.width + ACTOR_WIDTH / 2;
          const center = platform.x + platform.width / 2;
          return { platform, score: (overlaps ? 0 : 500) + Math.abs(platform.y - actor.position.y) + Math.abs(center - actor.position.x) * 0.08 };
        })
        .sort((a, b) => a.score - b.score)[0];
      if (candidates && (actor.position.x < candidates.platform.x - ACTOR_WIDTH / 2
        || actor.position.x > candidates.platform.x + candidates.platform.width + ACTOR_WIDTH / 2)) {
        targetX = candidates.platform.x + candidates.platform.width / 2;
      }
    }
    if (!nearLeft && !nearRight && targetX === null) return null;
    const moveX: -1 | 0 | 1 = nearLeft ? 1 : nearRight ? -1
      : targetX === null ? 0 : targetX > actor.position.x ? 1 : -1;
    const shouldJump = actor.jumpsRemaining > 0
      && (nearLeft || nearRight || (falling && targetX !== null))
      && tick - this.lastFallbackJumpTick >= 18;
    if (shouldJump) this.lastFallbackJumpTick = tick;
    return { ...idleInput(), moveX, jumpPressed: shouldJump };
  }
}

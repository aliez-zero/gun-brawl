import { idleInput } from '../../core/types';
import type { ActorInput, ActorState, MatchState } from '../../core/types';
import { MAX_OBSERVATION_AGE, parseExternalAction } from './Protocol';
import type { CommandContext, ExternalAction } from './Protocol';

/** Synchronous input mailbox. No network, wall clock, navigation or hidden rule-bot fallback. */
export class ExternalInputController {
  epoch = 0;
  private lifecycle = '';
  private active = false;
  private lastSequence = -1;
  private action: ExternalAction | null = null;
  private untilTick = 0;
  private edgePending = false;

  synchronize(actor: ActorState, state: Readonly<MatchState>): void {
    const key = `${state.phase}:${state.overtime}:${actor.status}:${actor.stocks}`;
    if (key !== this.lifecycle) {
      this.lifecycle = key;
      this.epoch++;
      this.action = null;
      this.edgePending = false;
      this.lastSequence = -1;
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

  sample(tick: number): ActorInput {
    if (!this.active || !this.action || tick >= this.untilTick) return idleInput();
    const edge = this.edgePending;
    this.edgePending = false;
    const a = this.action;
    return {
      moveX: a.moveX, shootHeld: a.shootHeld, jumpPressed: edge && a.jumpPressed,
      dropPressed: edge && a.dropPressed, bombPressed: edge && a.bombPressed,
      reloadPressed: edge && a.reloadPressed,
    };
  }
}

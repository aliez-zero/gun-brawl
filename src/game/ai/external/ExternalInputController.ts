import { idleInput } from '../../core/types';
import type { ActorInput, ActorState, MatchState } from '../../core/types';
import { ACTOR_WIDTH } from '../../core/constants';
import { BotController } from '../BotController';
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
  private readonly tacticalAssist: BotController;
  private lastPosition: { x: number; y: number } | null = null;
  private stalledFor = 0;

  constructor(seed = 0) {
    this.tacticalAssist = new BotController('normal', seed);
  }

  synchronize(actor: ActorState, state: Readonly<MatchState>): void {
    const key = `${state.phase}:${state.overtime}:${actor.status}:${actor.stocks}`;
    if (key !== this.lifecycle) {
      this.lifecycle = key;
      this.epoch++;
      this.action = null;
      this.edgePending = false;
      this.lastSequence = -1;
      this.lastFallbackJumpTick = -Infinity;
      this.lastPosition = null;
      this.stalledFor = 0;
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

  sample(tick: number, actor: ActorState, state: Readonly<MatchState>, dt = 1 / 60): ActorInput {
    if (!this.active) return idleInput();
    if (this.lastPosition && Math.hypot(actor.position.x - this.lastPosition.x, actor.position.y - this.lastPosition.y) < 0.5) {
      this.stalledFor += dt;
    } else {
      this.stalledFor = 0;
    }
    this.lastPosition = { ...actor.position };
    const emergency = this.emergencyInput(tick, actor, state);
    if (!this.action || tick >= this.untilTick) return emergency ?? idleInput();
    const edge = this.edgePending;
    this.edgePending = false;
    const a = this.action;
    if (emergency) return { ...emergency, shootHeld: a.shootHeld && emergency.moveX === a.moveX };
    const assist = this.tacticalAssist.sample(actor, state, dt);
    const stalled = this.stalledFor >= 0.45 && assist.moveX !== 0;
    const target = state.actors
      .filter((candidate) => candidate.config.id !== actor.config.id && candidate.status === 'alive')
      .sort((left, right) => Math.hypot(left.position.x - actor.position.x, left.position.y - actor.position.y)
        - Math.hypot(right.position.x - actor.position.x, right.position.y - actor.position.y))[0];
    const targetDx = target ? target.position.x - actor.position.x : 0;
    const targetDy = target ? target.position.y - actor.position.y : 0;
    const aligned = Boolean(target)
      && Math.abs(targetDy) < 55
      && Math.abs(targetDx) <= actor.weapon.definition.range
      && actor.facing === (targetDx < 0 ? -1 : 1);
    const aimCorrection: -1 | 0 | 1 = a.shootHeld && target && Math.abs(targetDy) < 55
      && Math.abs(targetDx) <= actor.weapon.definition.range && a.moveX === 0
      ? (targetDx < 0 ? -1 : 1) : 0;
    const useTacticalSkill = stalled || a.intent === 'recover' || a.intent === 'collect'
      || (a.intent === 'reposition' && a.moveX === 0);
    const moveX = useTacticalSkill ? assist.moveX : aimCorrection || a.moveX;
    return {
      moveX, shootHeld: a.shootHeld || (a.intent === 'attack' && assist.shootHeld && aligned),
      jumpPressed: (edge && a.jumpPressed) || (assist.jumpPressed && actor.groundedOn !== null),
      dropPressed: (edge && a.dropPressed) || (assist.dropPressed && actor.groundedOn !== null),
      bombPressed: edge && a.bombPressed,
      reloadPressed: (edge && a.reloadPressed) || assist.reloadPressed,
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
    const projectileThreat = state.projectiles
      .filter((projectile) => projectile.owner !== actor.config.id
        && Math.hypot(projectile.position.x - actor.position.x, projectile.position.y - actor.position.y) < 180
        && Math.sign(projectile.velocity.x) === Math.sign(actor.position.x - projectile.position.x))
      .sort((left, right) => Math.hypot(left.position.x - actor.position.x, left.position.y - actor.position.y)
        - Math.hypot(right.position.x - actor.position.x, right.position.y - actor.position.y))[0];
    const bombThreat = state.bombs
      .filter((bomb) => bomb.owner !== actor.config.id && bomb.fuseRemaining < 1
        && Math.hypot(bomb.position.x - actor.position.x, bomb.position.y - actor.position.y) < bomb.radius * 0.9)
      .sort((left, right) => left.fuseRemaining - right.fuseRemaining)[0];
    if (!nearLeft && !nearRight && (projectileThreat || bombThreat)) {
      const threatX = projectileThreat?.position.x ?? bombThreat!.position.x;
      const moveX: -1 | 1 = actor.position.x >= threatX ? 1 : -1;
      const shouldJump = actor.jumpsRemaining > 0 && tick - this.lastFallbackJumpTick >= 18;
      if (shouldJump) this.lastFallbackJumpTick = tick;
      return { ...idleInput(), moveX, jumpPressed: shouldJump };
    }
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

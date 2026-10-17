import { Random } from '../core/Random';
import { idleInput } from '../core/types';
import type { ActorInput, ActorState, Difficulty, MatchState } from '../core/types';

export class BotController {
  private remaining = 0;
  private held: ActorInput = idleInput();
  private climbTarget: string | null = null;
  private readonly random: Random;

  constructor(private readonly difficulty: Difficulty, seed: number) { this.random = new Random(seed); }

  sample(actor: ActorState, state: MatchState, dt: number): ActorInput {
    if (actor.status !== 'alive' || state.phase !== 'playing') { this.climbTarget = null; return idleInput(); }
    this.remaining -= dt;
    if (this.remaining > 0) return { ...this.held, jumpPressed: false, dropPressed: false };
    const delays = { easy: 0.5, normal: 0.3, hard: 0.18 };
    this.remaining = delays[this.difficulty] * (0.85 + this.random.next() * 0.3);
    const target = state.actors.filter((other) => other !== actor && other.status === 'alive')
      .sort((a, b) => Math.hypot(a.position.x - actor.position.x, a.position.y - actor.position.y)
        - Math.hypot(b.position.x - actor.position.x, b.position.y - actor.position.y))[0];
    if (!target) return idleInput();
    const dx = target.position.x - actor.position.x;
    const dy = target.position.y - actor.position.y;
    let moveX: -1 | 0 | 1 = Math.abs(dx) > 320 ? (dx > 0 ? 1 : -1) : 0;
    if (Math.abs(dx) > 20 && actor.facing !== Math.sign(dx)) moveX = dx > 0 ? 1 : -1;

    // Recovery always outranks pursuing a target beyond an arena edge.
    const lowestLevel = Math.max(...state.config.map.platforms.map((platform) => platform.y));
    const recoveryPlatforms = state.config.map.platforms.filter((platform) => platform.y >= lowestLevel - 80);
    const horizontalDistance = (platform: typeof recoveryPlatforms[number]): number =>
      Math.max(platform.x + 30 - actor.position.x, actor.position.x - (platform.x + platform.width - 30), 0);
    const safe = recoveryPlatforms.some((platform) => horizontalDistance(platform) === 0 && actor.position.y <= platform.y + 35);
    const recovery = [...recoveryPlatforms].sort((a, b) =>
      horizontalDistance(a) + Math.abs(a.y - actor.position.y) * 0.2 - horizontalDistance(b) - Math.abs(b.y - actor.position.y) * 0.2)[0];
    const endangered = !safe;
    if (endangered && recovery) moveX = actor.position.x < recovery.x + recovery.width / 2 ? 1 : -1;
    // Keep a landing point while jumping; stopping at firing distance can strand a bot below a split deck.
    if (actor.groundedOn === this.climbTarget) this.climbTarget = null;
    if (!this.climbTarget && dy < -55 && actor.groundedOn) {
      const upper = state.config.map.platforms.filter((platform) => platform.y < actor.position.y - 30 && platform.y >= actor.position.y - 170)
        .sort((a, b) => horizontalDistance(a) + Math.abs(a.x + a.width / 2 - target.position.x) * 0.1
          - horizontalDistance(b) - Math.abs(b.x + b.width / 2 - target.position.x) * 0.1)[0];
      this.climbTarget = upper?.id ?? null;
    }
    const landing = state.config.map.platforms.find((platform) => platform.id === this.climbTarget);
    if (landing && !endangered) {
      const landingX = Math.max(landing.x + 35, Math.min(landing.x + landing.width - 35, actor.position.x));
      if (Math.abs(landingX - actor.position.x) > 8) moveX = landingX > actor.position.x ? 1 : -1;
    }
    const wantsHeight = dy < -55 && actor.groundedOn !== null;
    const recoveryJump = endangered && actor.jumpsRemaining > 0 && actor.verticalVelocity > 80;
    this.held = {
      moveX,
      jumpPressed: recoveryJump || wantsHeight,
      dropPressed: dy > 100 && Boolean(actor.groundedOn) && actor.position.y < lowestLevel - 10,
      shootHeld: Math.abs(dy) < 45 && Math.abs(dx) < 720 && actor.facing === Math.sign(dx),
    };
    return { ...this.held };
  }
}

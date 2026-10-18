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
    if (this.remaining > 0) return { ...this.held, jumpPressed: false, dropPressed: false, bombPressed: false, reloadPressed: false };
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
    if (endangered) this.climbTarget = null;

    // T05.4: a live bomb outranks the target. Jumping is a valid escape when
    // the blast is already close; the controller never writes core state.
    const threat = state.bombs
      .filter((bomb) => bomb.fuseRemaining < 1 && Math.hypot(bomb.position.x - actor.position.x, bomb.position.y - actor.position.y) < bomb.radius * 0.9)
      .sort((a, b) => a.fuseRemaining - b.fuseRemaining)[0];
    if (threat) {
      const away = actor.position.x === threat.position.x ? -actor.facing : (actor.position.x < threat.position.x ? -1 : 1);
      this.held = {
        moveX: away as -1 | 1,
        jumpPressed: actor.groundedOn !== null && actor.jumpsRemaining > 0,
        dropPressed: false, shootHeld: false, bombPressed: false, reloadPressed: false,
      };
      return { ...this.held };
    }

    // T05.4: take a nearby crate before resuming the duel. This also gives the
    // bot a reason to cross a gap that a pure target chase would ignore.
    const crate = state.drops
      .filter((drop) => drop.state === 'active')
      .sort((a, b) => Math.hypot(a.position.x - actor.position.x, a.position.y - actor.position.y)
        - Math.hypot(b.position.x - actor.position.x, b.position.y - actor.position.y))[0];
    if (crate && !endangered && Math.hypot(crate.position.x - actor.position.x, crate.position.y - actor.position.y) < 340) {
      const crateX = crate.position.x - actor.position.x;
      this.held = {
        moveX: Math.abs(crateX) < 10 ? 0 : (crateX > 0 ? 1 : -1),
        jumpPressed: crate.position.y < actor.position.y - 70 && actor.groundedOn !== null && actor.jumpsRemaining > 0,
        dropPressed: false, shootHeld: false, bombPressed: false, reloadPressed: false,
      };
      return { ...this.held };
    }
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
    const ownBombs = state.bombs.filter((bomb) => bomb.owner === actor.config.id).length;
    const canBomb = !endangered && actor.bombsRemaining > 0 && actor.bombCooldown <= 0 && ownBombs < 2
      && Math.abs(dx) >= 90 && Math.abs(dx) <= 260 && Math.abs(dy) < 80;
    const bombChance = this.difficulty === 'hard' ? 0.75 : this.difficulty === 'normal' ? 0.45 : 0.2;
    const bombPressed = canBomb && this.random.next() < bombChance;
    const magazine = actor.weapon.ammoRemaining;
    const capacity = actor.weapon.definition.maxAmmo;
    const lowMagazine = magazine !== null && capacity !== null
      && magazine <= Math.max(1, Math.floor(capacity * 0.25))
      && actor.weapon.reserveRemaining > 0 && actor.reloadRemaining <= 1e-8;
    this.held = {
      moveX,
      jumpPressed: recoveryJump || wantsHeight,
      dropPressed: dy > 100 && Boolean(actor.groundedOn) && actor.position.y < lowestLevel - 10,
      shootHeld: !bombPressed && Math.abs(dy) < 45 && Math.abs(dx) < Math.min(720, actor.weapon.definition.range)
        && actor.facing === Math.sign(dx),
      bombPressed,
      reloadPressed: lowMagazine && !endangered && !bombPressed,
    };
    return { ...this.held };
  }
}

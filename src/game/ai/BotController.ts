import { Random } from '../core/Random';
import { idleInput } from '../core/types';
import type { ActorInput, ActorState, Difficulty, MatchState } from '../core/types';
import { nearestPlatform, planRoute, platformForActor } from './Navigation';

interface BotProfile {
  reaction: number;
  approach: number;
  preferred: number;
  fireRange: number;
  bombChance: number;
}

const PROFILES: Record<Difficulty, BotProfile> = {
  easy: { reaction: 0.5, approach: 380, preferred: 0, fireRange: 420, bombChance: 0.2 },
  normal: { reaction: 0.3, approach: 280, preferred: 0, fireRange: 620, bombChance: 0.45 },
  hard: { reaction: 0.18, approach: 180, preferred: 220, fireRange: 760, bombChance: 0.75 },
};

export class BotController {
  private remaining = 0;
  private held: ActorInput = idleInput();
  private climbTarget: string | null = null;
  private lastPosition: { x: number; y: number } | null = null;
  private stuckTime = 0;
  private readonly profile: BotProfile;
  private readonly random: Random;

  constructor(private readonly difficulty: Difficulty, seed: number) {
    this.profile = PROFILES[difficulty];
    this.random = new Random(seed);
  }

  sample(actor: ActorState, state: MatchState, dt: number): ActorInput {
    if (actor.status !== 'alive' || state.phase !== 'playing') { this.climbTarget = null; return idleInput(); }
    if (this.lastPosition && Math.hypot(actor.position.x - this.lastPosition.x, actor.position.y - this.lastPosition.y) < 0.5) {
      this.stuckTime += dt;
    } else {
      this.stuckTime = 0;
    }
    this.lastPosition = { ...actor.position };
    if (this.stuckTime > 1) { this.climbTarget = null; this.stuckTime = 0; }
    this.remaining -= dt;
    if (this.remaining > 0) return { ...this.held, jumpPressed: false, dropPressed: false, bombPressed: false, reloadPressed: false };
    this.remaining = this.profile.reaction * (0.85 + this.random.next() * 0.3);
    const target = state.actors.filter((other) => other !== actor && other.status === 'alive')
      .sort((a, b) => Math.hypot(a.position.x - actor.position.x, a.position.y - actor.position.y)
        - Math.hypot(b.position.x - actor.position.x, b.position.y - actor.position.y))[0];
    if (!target) return idleInput();
    const dx = target.position.x - actor.position.x;
    const dy = target.position.y - actor.position.y;
    const distance = Math.abs(dx);
    let moveX: -1 | 0 | 1 = 0;
    if (this.difficulty === 'hard' && distance < this.profile.preferred) moveX = dx > 0 ? -1 : 1;
    else if (distance > this.profile.approach) moveX = dx > 0 ? 1 : -1;
    if (distance > 20 && actor.facing !== Math.sign(dx)) moveX = dx > 0 ? 1 : -1;

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
    // Platform graph route: jump gaps or drop decks before resuming the duel.
    const actorPlatform = platformForActor(state.config.map, actor);
    const targetPlatform = platformForActor(state.config.map, target)
      ?? nearestPlatform(state.config.map, target.position.x, target.position.y);
    // Upward chases still use the local climb planner; the graph is for gaps and drops.
    if (!endangered && target.position.y >= actor.position.y - 10 && actorPlatform && targetPlatform && actorPlatform.id !== targetPlatform.id) {
      const route = planRoute(state.config.map, actorPlatform.id, targetPlatform.id);
      const step = route[0];
      if (step) {
        const center = step.platform.x + step.platform.width / 2;
        const routeDx = center - actor.position.x;
        this.held = {
          moveX: Math.abs(routeDx) < 10 ? 0 : routeDx > 0 ? 1 : -1,
          jumpPressed: step.action === 'jump' && actor.groundedOn !== null && actor.jumpsRemaining > 0,
          dropPressed: step.action === 'drop' && actor.groundedOn !== null,
          shootHeld: false, bombPressed: false, reloadPressed: false,
        };
        return { ...this.held };
      }
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
    const bombPressed = canBomb && this.random.next() < this.profile.bombChance;
    const magazine = actor.weapon.ammoRemaining;
    const capacity = actor.weapon.definition.maxAmmo;
    const lowMagazine = magazine !== null && capacity !== null
      && magazine <= Math.max(1, Math.floor(capacity * 0.25))
      && actor.weapon.reserveRemaining > 0 && actor.reloadRemaining <= 1e-8;
    this.held = {
      moveX,
      jumpPressed: recoveryJump || wantsHeight,
      dropPressed: dy > 100 && Boolean(actor.groundedOn) && actor.position.y < lowestLevel - 10,
      shootHeld: !bombPressed && Math.abs(dy) < 45
        && Math.abs(dx) < Math.min(this.profile.fireRange, actor.weapon.definition.range)
        && actor.facing === Math.sign(dx),
      bombPressed,
      reloadPressed: lowMagazine && !endangered && !bombPressed,
    };
    return { ...this.held };
  }
}

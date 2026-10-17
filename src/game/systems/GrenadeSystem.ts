import { BOMB } from '../core/constants';
import type { ActorInput, ActorState, BattleEvent, Bomb, MatchState, Platform } from '../core/types';
import { applyExplosionHits, ExplosionSystem } from './ExplosionSystem';

/**
 * Bomb runtime. Inputs are edge-triggered by contract; the keyboard binding is
 * T06's responsibility, so normal builds still send bombPressed: false.
 */
export class GrenadeSystem {
  private nextBomb = 0;

  constructor(private readonly explosions: ExplosionSystem = new ExplosionSystem()) {}

  update(
    state: MatchState,
    inputs: ReadonlyMap<string, ActorInput>,
    dt: number,
    events: BattleEvent[],
  ): void {
    for (const actor of state.actors) actor.bombCooldown = Math.max(0, actor.bombCooldown - dt);
    for (const actor of state.actors) {
      if (actor.status !== 'alive') continue;
      if (inputs.get(actor.config.id)?.bombPressed) this.throwBomb(state, actor, events);
    }

    const survivors: Bomb[] = [];
    for (const bomb of state.bombs) {
      this.stepBomb(bomb, state, dt);
      if (bomb.fuseRemaining <= 0) this.explode(state, bomb, events);
      else survivors.push(bomb);
    }
    state.bombs = survivors;
  }

  private throwBomb(state: MatchState, actor: ActorState, events: BattleEvent[]): void {
    if (actor.bombCooldown > 0) return;
    const active = state.bombs.filter((bomb) => bomb.owner === actor.config.id).length;
    if (actor.bombsRemaining <= 0 || active >= BOMB.maxActive) {
      events.push({ type: 'bomb-empty', actorId: actor.config.id, position: { ...actor.position } });
      return;
    }

    const position = {
      x: actor.position.x + actor.facing * BOMB.throwOffsetX,
      y: actor.position.y - BOMB.throwOffsetY,
    };
    actor.bombsRemaining--;
    actor.bombCooldown = BOMB.cooldown;
    // Throwing is an active combat action; it removes spawn protection immediately.
    actor.protectionRemaining = 0;
    state.bombs.push({
      id: this.nextBomb++,
      owner: actor.config.id,
      position,
      previous: { ...position },
      velocity: {
        x: actor.facing * BOMB.throwVelocityX,
        y: BOMB.throwVelocityY,
      },
      fuseRemaining: BOMB.fuse,
      radius: BOMB.bodyRadius,
    });
    events.push({ type: 'bomb', actorId: actor.config.id, position: { ...position }, bombId: this.nextBomb - 1 });
  }

  private stepBomb(bomb: Bomb, state: MatchState, dt: number): void {
    bomb.previous = { ...bomb.position };
    const radius = bomb.radius;
    const oldX = bomb.position.x;
    bomb.position.x += bomb.velocity.x * dt;
    for (const platform of state.config.map.platforms) {
      if (platform.kind !== 'solid') continue;
      if (!verticalOverlap(bomb.position.y, radius, platform)) continue;
      if (bomb.velocity.x > 0 && oldX + radius <= platform.x + 0.01 && bomb.position.x + radius >= platform.x) {
        bomb.position.x = platform.x - radius;
        bomb.velocity.x = bounce(bomb.velocity.x);
        break;
      }
      if (bomb.velocity.x < 0 && oldX - radius >= platform.x + platform.width - 0.01
        && bomb.position.x - radius <= platform.x + platform.width) {
        bomb.position.x = platform.x + platform.width + radius;
        bomb.velocity.x = bounce(bomb.velocity.x);
        break;
      }
    }

    const oldY = bomb.position.y;
    bomb.velocity.y += BOMB.gravity * dt;
    bomb.position.y += bomb.velocity.y * dt;
    for (const platform of state.config.map.platforms) {
      if (!horizontalOverlap(bomb.position.x, radius, platform)) continue;
      const oldBottom = oldY + radius;
      const newBottom = bomb.position.y + radius;
      if (bomb.velocity.y >= 0 && oldBottom <= platform.y + 0.01 && newBottom >= platform.y) {
        bomb.position.y = platform.y - radius;
        bomb.velocity.y = bounce(bomb.velocity.y);
        break;
      }
      if (platform.kind === 'solid' && bomb.velocity.y < 0
        && oldY - radius >= platform.y + platform.height - 0.01
        && bomb.position.y - radius < platform.y + platform.height) {
        bomb.position.y = platform.y + platform.height + radius;
        bomb.velocity.y = bounce(bomb.velocity.y);
        break;
      }
    }
    bomb.fuseRemaining -= dt;
  }

  private explode(state: MatchState, bomb: Bomb, events: BattleEvent[]): void {
    const request = {
      ownerId: bomb.owner,
      source: 'bomb' as const,
      center: { ...bomb.position },
      radius: BOMB.radius,
      centerImpulse: BOMB.centerImpulse,
      edgeImpulse: BOMB.edgeImpulse,
    };
    const hits = this.explosions.resolve(state, request);
    applyExplosionHits(state, request, hits, events);
    events.push({
      type: 'explosion', source: 'bomb', ownerId: bomb.owner,
      position: { ...bomb.position }, radius: BOMB.radius,
    });
  }
}

const horizontalOverlap = (x: number, radius: number, platform: Platform): boolean =>
  x + radius > platform.x && x - radius < platform.x + platform.width;

const verticalOverlap = (y: number, radius: number, platform: Platform): boolean =>
  y + radius > platform.y && y - radius < platform.y + platform.height;

const bounce = (speed: number): number => {
  const next = -speed * BOMB.bounce;
  return Math.abs(next) < BOMB.minBounceSpeed ? 0 : next;
};

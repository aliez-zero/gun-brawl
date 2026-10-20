import { ACTOR_HEIGHT, ACTOR_WIDTH, MOVEMENT } from '../core/constants';
import { approach } from '../core/math';
import type { ActorInput, ActorState, MapDefinition } from '../core/types';

export function moveActor(actor: ActorState, input: ActorInput, map: MapDefinition, dt: number): void {
  if (actor.status !== 'alive') return;
  actor.previous = { ...actor.position };
  actor.jumpBuffer = input.jumpPressed ? MOVEMENT.inputBuffer : Math.max(0, actor.jumpBuffer - dt);
  actor.dropRemaining = Math.max(0, actor.dropRemaining - dt);
  if (actor.dropRemaining === 0) actor.dropPlatform = null;
  actor.coyoteRemaining = actor.groundedOn ? MOVEMENT.coyoteTime : Math.max(0, actor.coyoteRemaining - dt);
  if (!actor.groundedOn && actor.coyoteRemaining === 0 && actor.jumpsRemaining === 2) actor.jumpsRemaining = 1;

  const groundedPlatform = map.platforms.find((platform) => platform.id === actor.groundedOn);
  if (input.dropPressed && groundedPlatform?.kind === 'one-way') {
    actor.dropPlatform = groundedPlatform.id;
    actor.dropRemaining = MOVEMENT.dropTime;
    actor.groundedOn = null;
    actor.coyoteRemaining = 0;
    actor.jumpBuffer = 0;
    actor.jumpsRemaining = 1;
    actor.position.y += 2;
  } else if (actor.jumpBuffer > 0 && (actor.groundedOn || actor.coyoteRemaining > 0 || actor.jumpsRemaining > 0)) {
    const groundJump = Boolean(actor.groundedOn) || actor.coyoteRemaining > 0;
    actor.verticalVelocity = -(groundJump ? MOVEMENT.jump : MOVEMENT.airJump);
    actor.impulse.y = 0;
    actor.jumpsRemaining = groundJump ? 1 : actor.jumpsRemaining - 1;
    actor.groundedOn = null;
    actor.coyoteRemaining = 0;
    actor.jumpBuffer = 0;
  }

  if (input.moveX) actor.facing = input.moveX;
  actor.moveVelocity = approach(
    actor.moveVelocity, input.moveX * MOVEMENT.speed,
    (input.moveX ? MOVEMENT.acceleration : MOVEMENT.braking) * dt,
  );
  const decay = Math.pow(0.5, dt / MOVEMENT.impulseHalfLife);
  actor.impulse.x *= decay;
  actor.impulse.y *= decay;
  actor.verticalVelocity += MOVEMENT.gravity * dt;
  const old = { ...actor.position };
  actor.position.x += (actor.moveVelocity + actor.impulse.x) * dt;

  for (const platform of map.platforms) {
    if (platform.kind !== 'solid') continue;
    if (old.y <= platform.y || old.y - ACTOR_HEIGHT >= platform.y + platform.height) continue;
    if (old.x + ACTOR_WIDTH / 2 <= platform.x && actor.position.x + ACTOR_WIDTH / 2 > platform.x) {
      actor.position.x = platform.x - ACTOR_WIDTH / 2;
      actor.moveVelocity = 0;
      actor.impulse.x = 0;
    } else if (old.x - ACTOR_WIDTH / 2 >= platform.x + platform.width && actor.position.x - ACTOR_WIDTH / 2 < platform.x + platform.width) {
      actor.position.x = platform.x + platform.width + ACTOR_WIDTH / 2;
      actor.moveVelocity = 0;
      actor.impulse.x = 0;
    }
  }

  actor.position.y += (actor.verticalVelocity + actor.impulse.y) * dt;
  actor.groundedOn = null;
  for (const platform of map.platforms) {
    if (platform.id === actor.dropPlatform) continue;
    const overlaps = actor.position.x + ACTOR_WIDTH / 2 > platform.x && actor.position.x - ACTOR_WIDTH / 2 < platform.x + platform.width;
    if (!overlaps) continue;
    if (old.y <= platform.y + 0.01 && actor.position.y >= platform.y && actor.verticalVelocity + actor.impulse.y >= 0) {
      actor.position.y = platform.y;
      actor.verticalVelocity = 0;
      actor.impulse.y = 0;
      actor.groundedOn = platform.id;
      actor.jumpsRemaining = 2;
    } else if (platform.kind === 'solid' && old.y - ACTOR_HEIGHT >= platform.y + platform.height && actor.position.y - ACTOR_HEIGHT < platform.y + platform.height) {
      actor.position.y = platform.y + platform.height + ACTOR_HEIGHT;
      actor.verticalVelocity = Math.max(0, actor.verticalVelocity);
      actor.impulse.y = Math.max(0, actor.impulse.y);
    }
  }
}

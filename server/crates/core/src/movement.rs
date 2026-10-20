//! Movement, jumping and platform collision.
//!
//! Direct port of `web/src/game/systems/MovementSystem.ts`; every comparison and
//! epsilon is kept so the golden replay stays inside a pixel.

use crate::constants::{ACTOR_HEIGHT, ACTOR_WIDTH, MOVEMENT};
use crate::math::{approach, pow};
use crate::types::{ActorInput, ActorState, ActorStatus, MapDef, PlatformKind};

pub fn move_actor(actor: &mut ActorState, input: ActorInput, map: &MapDef, dt: f64) {
    if actor.status != ActorStatus::Alive {
        return;
    }
    actor.previous = actor.position;
    actor.jump_buffer = if input.jump_pressed {
        MOVEMENT.input_buffer
    } else {
        (actor.jump_buffer - dt).max(0.0)
    };
    actor.drop_remaining = (actor.drop_remaining - dt).max(0.0);
    if actor.drop_remaining == 0.0 {
        actor.drop_platform = None;
    }
    actor.coyote_remaining = if actor.grounded_on.is_some() {
        MOVEMENT.coyote_time
    } else {
        (actor.coyote_remaining - dt).max(0.0)
    };
    if actor.grounded_on.is_none() && actor.coyote_remaining == 0.0 && actor.jumps_remaining == 2 {
        actor.jumps_remaining = 1;
    }

    let grounded_kind = actor
        .grounded_on
        .and_then(|id| map.platforms.get(id as usize))
        .map(|platform| platform.kind);

    if input.drop_pressed && grounded_kind == Some(PlatformKind::OneWay) {
        actor.drop_platform = actor.grounded_on;
        actor.drop_remaining = MOVEMENT.drop_time;
        actor.grounded_on = None;
        actor.coyote_remaining = 0.0;
        actor.jump_buffer = 0.0;
        actor.jumps_remaining = 1;
        actor.position.y += 2.0;
    } else if actor.jump_buffer > 0.0
        && (actor.grounded_on.is_some()
            || actor.coyote_remaining > 0.0
            || actor.jumps_remaining > 0)
    {
        let ground_jump = actor.grounded_on.is_some() || actor.coyote_remaining > 0.0;
        actor.vertical_velocity = -(if ground_jump {
            MOVEMENT.jump
        } else {
            MOVEMENT.air_jump
        });
        actor.impulse.y = 0.0;
        actor.jumps_remaining = if ground_jump {
            1
        } else {
            actor.jumps_remaining.saturating_sub(1)
        };
        actor.grounded_on = None;
        actor.coyote_remaining = 0.0;
        actor.jump_buffer = 0.0;
    }

    if input.move_x != 0 {
        actor.facing = input.move_x;
    }
    actor.move_velocity = approach(
        actor.move_velocity,
        input.move_x as f64 * MOVEMENT.speed,
        (if input.move_x != 0 {
            MOVEMENT.acceleration
        } else {
            MOVEMENT.braking
        }) * dt,
    );
    let decay = pow(0.5, dt / MOVEMENT.impulse_half_life);
    actor.impulse.x *= decay;
    actor.impulse.y *= decay;
    actor.vertical_velocity += MOVEMENT.gravity * dt;

    let old = actor.position;
    actor.position.x += (actor.move_velocity + actor.impulse.x) * dt;

    for platform in &map.platforms {
        if platform.kind != PlatformKind::Solid {
            continue;
        }
        if old.y <= platform.y || old.y - ACTOR_HEIGHT >= platform.y + platform.height {
            continue;
        }
        if old.x + ACTOR_WIDTH / 2.0 <= platform.x
            && actor.position.x + ACTOR_WIDTH / 2.0 > platform.x
        {
            actor.position.x = platform.x - ACTOR_WIDTH / 2.0;
            actor.move_velocity = 0.0;
            actor.impulse.x = 0.0;
        } else if old.x - ACTOR_WIDTH / 2.0 >= platform.x + platform.width
            && actor.position.x - ACTOR_WIDTH / 2.0 < platform.x + platform.width
        {
            actor.position.x = platform.x + platform.width + ACTOR_WIDTH / 2.0;
            actor.move_velocity = 0.0;
            actor.impulse.x = 0.0;
        }
    }

    actor.position.y += (actor.vertical_velocity + actor.impulse.y) * dt;
    actor.grounded_on = None;
    for platform in &map.platforms {
        if Some(platform.id) == actor.drop_platform {
            continue;
        }
        let overlaps = actor.position.x + ACTOR_WIDTH / 2.0 > platform.x
            && actor.position.x - ACTOR_WIDTH / 2.0 < platform.x + platform.width;
        if !overlaps {
            continue;
        }
        if old.y <= platform.y + 0.01
            && actor.position.y >= platform.y
            && actor.vertical_velocity + actor.impulse.y >= 0.0
        {
            actor.position.y = platform.y;
            actor.vertical_velocity = 0.0;
            actor.impulse.y = 0.0;
            actor.grounded_on = Some(platform.id);
            actor.jumps_remaining = 2;
        } else if platform.kind == PlatformKind::Solid
            && old.y - ACTOR_HEIGHT >= platform.y + platform.height
            && actor.position.y - ACTOR_HEIGHT < platform.y + platform.height
        {
            actor.position.y = platform.y + platform.height + ACTOR_HEIGHT;
            actor.vertical_velocity = actor.vertical_velocity.max(0.0);
            actor.impulse.y = actor.impulse.y.max(0.0);
        }
    }
}

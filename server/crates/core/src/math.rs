//! One math implementation for every target.
//!
//! Native and `wasm32` must produce identical bits, otherwise client prediction
//! drifts from the server and the correction threshold fires constantly. Rust's
//! `f64::sin` resolves to the platform libm (glibc on Linux, Rust's port on
//! wasm), so the core never calls it directly: everything goes through the
//! `libm` crate, which is compiled the same way for both targets.
//!
//! The simulation works in `f64` to mirror JavaScript numbers; the wire format
//! quantizes separately in `gunbrawl-proto`.

use crate::constants::{ACTOR_HEIGHT, ACTOR_WIDTH, MOVEMENT};
use crate::types::{ActorState, Rect, Vec2};

pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

pub fn hypot(x: f64, y: f64) -> f64 {
    libm::hypot(x, y)
}

pub fn abs(x: f64) -> f64 {
    libm::fabs(x)
}

pub fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

pub fn approach(value: f64, target: f64, amount: f64) -> f64 {
    if value < target {
        (value + amount).min(target)
    } else {
        (value - amount).max(target)
    }
}

pub fn actor_rect(actor: &ActorState) -> Rect {
    Rect {
        x: actor.position.x - ACTOR_WIDTH / 2.0,
        y: actor.position.y - ACTOR_HEIGHT,
        width: ACTOR_WIDTH,
        height: ACTOR_HEIGHT,
    }
}

pub fn add_impulse(actor: &mut ActorState, x: f64, y: f64, cap: f64) {
    actor.impulse.x += x;
    actor.impulse.y += y;
    let length = hypot(actor.impulse.x, actor.impulse.y);
    if length > cap {
        actor.impulse.x *= cap / length;
        actor.impulse.y *= cap / length;
    }
}

/// Swept intersection prevents fast projectiles from tunneling through a target.
/// Returns the entry fraction in `[0, 1]`, or `None` when the segment misses.
pub fn segment_rect(from: Vec2, to: Vec2, rect: Rect) -> Option<f64> {
    let mut entry = 0.0_f64;
    let mut exit = 1.0_f64;
    for axis in 0..2 {
        let (from_value, to_value, minimum, size) = if axis == 0 {
            (from.x, to.x, rect.x, rect.width)
        } else {
            (from.y, to.y, rect.y, rect.height)
        };
        let maximum = minimum + size;
        let delta = to_value - from_value;
        if abs(delta) < 1e-9 {
            if from_value < minimum || from_value > maximum {
                return None;
            }
            continue;
        }
        let a = (minimum - from_value) / delta;
        let b = (maximum - from_value) / delta;
        entry = entry.max(a.min(b));
        exit = exit.min(a.max(b));
        if entry > exit {
            return None;
        }
    }
    Some(entry)
}

/// Add an impulse with the default movement cap.
pub fn add_default_impulse(actor: &mut ActorState, x: f64, y: f64) {
    add_impulse(actor, x, y, MOVEMENT.max_impulse);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_matches_known_values() {
        assert!((hypot(3.0, 4.0) - 5.0).abs() < 1e-12);
    }

    #[test]
    fn clamp_bounds() {
        assert_eq!(clamp(-1.0, 0.0, 2.0), 0.0);
        assert_eq!(clamp(3.0, 0.0, 2.0), 2.0);
        assert_eq!(clamp(1.0, 0.0, 2.0), 1.0);
    }

    #[test]
    fn segment_rect_hits_and_misses() {
        let rect = Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        };
        assert!(segment_rect(Vec2::new(-5.0, 5.0), Vec2::new(15.0, 5.0), rect).is_some());
        assert!(segment_rect(Vec2::new(-5.0, 20.0), Vec2::new(15.0, 20.0), rect).is_none());
        assert!(segment_rect(Vec2::new(-5.0, 5.0), Vec2::new(-1.0, 5.0), rect).is_none());
    }
}

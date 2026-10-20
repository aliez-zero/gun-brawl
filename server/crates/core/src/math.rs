//! One math implementation for every target.
//!
//! Native and `wasm32` must produce identical bits, otherwise client prediction
//! drifts from the server and the correction threshold fires constantly. Rust's
//! `f32::sin` resolves to the platform libm (glibc on Linux, Rust's port on
//! wasm), so the core never calls it directly: everything goes through the
//! `libm` crate, which is compiled the same way for both targets.

pub fn sin(x: f32) -> f32 {
    libm::sinf(x)
}

pub fn cos(x: f32) -> f32 {
    libm::cosf(x)
}

pub fn pow(x: f32, y: f32) -> f32 {
    libm::powf(x, y)
}

pub fn hypot(x: f32, y: f32) -> f32 {
    libm::hypotf(x, y)
}

/// Clamp `value` into `[min, max]`.
pub fn clamp(value: f32, min: f32, max: f32) -> f32 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hypot_matches_known_values() {
        assert!((hypot(3.0, 4.0) - 5.0).abs() < 1e-6);
    }

    #[test]
    fn clamp_bounds() {
        assert_eq!(clamp(-1.0, 0.0, 2.0), 0.0);
        assert_eq!(clamp(3.0, 0.0, 2.0), 2.0);
        assert_eq!(clamp(1.0, 0.0, 2.0), 1.0);
    }
}

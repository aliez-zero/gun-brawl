//! Authoritative rules core.
//!
//! P0 only carries the pieces every later port depends on: the fixed step, a
//! single math implementation shared by native and wasm, and the exact
//! mulberry32 random stream. The movement/combat/drop systems land in P1.

pub mod math;
pub mod random;

/// Simulation rate. Mirrors `web/src/game/core/constants.ts`.
pub const TICK_RATE: u32 = 60;
pub const SNAPSHOT_RATE: u32 = 30;
pub const FIXED_STEP: f32 = 1.0 / TICK_RATE as f32;

#[cfg(test)]
mod tests {
    #[test]
    fn fixed_step_matches_typescript() {
        assert_eq!(super::FIXED_STEP, 1.0f32 / 60.0f32);
    }
}

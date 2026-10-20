//! Authoritative rules core.
//!
//! Pure logic: no tokio, no network, no wall clock. Native and `wasm32` compile
//! the same code, and every transcendental call goes through [`crate::math`] so
//! client prediction and server authority cannot drift apart.

pub mod actor;
pub mod combat;
pub mod constants;
pub mod drops;
pub mod grenade;
pub mod life;
pub mod match_rule;
pub mod math;
pub mod movement;
pub mod random;
pub mod simulation;
pub mod types;

pub use constants::{FIXED_STEP, SNAPSHOT_RATE, TICK_RATE};
pub use drops::DropPoolEntry;
pub use simulation::Simulation;

#[cfg(test)]
mod tests {
    #[test]
    fn fixed_step_matches_typescript() {
        assert_eq!(super::FIXED_STEP, 1.0f64 / 60.0f64);
        assert_eq!(super::TICK_RATE, 60);
    }
}

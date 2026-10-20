//! Deterministic random streams.
//!
//! `Random` is mulberry32, bit-compatible with `web/src/game/core/Random.ts`.
//! `Lcg` is the 32-bit linear congruential stream used by the drop scheduler.
//! Both were checked against values produced by the TypeScript implementation.

pub struct Random {
    seed: u32,
}

impl Random {
    pub fn new(seed: u32) -> Self {
        Self { seed }
    }

    /// Next value in `[0, 1)`.
    pub fn next_f64(&mut self) -> f64 {
        self.seed = self.seed.wrapping_add(0x6d2b_79f5);
        let mut value = self.seed;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        ((value ^ (value >> 14)) as f64) / 4_294_967_296.0
    }

    pub fn next_f32(&mut self) -> f32 {
        self.next_f64() as f32
    }

    /// Uniform integer in `[0, bound)`.
    pub fn below(&mut self, bound: u32) -> u32 {
        if bound == 0 {
            return 0;
        }
        (self.next_f64() * bound as f64) as u32
    }
}

/// 32-bit LCG used by `DropSystem.SeededRandom`.
pub struct Lcg {
    state: u32,
}

impl Lcg {
    pub fn new(seed: u32) -> Self {
        let state = if seed == 0 { 1 } else { seed };
        Self { state }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.state = 1_664_525u32
            .wrapping_mul(self.state)
            .wrapping_add(1_013_904_223);
        self.state as f64 / 4_294_967_296.0
    }
}

#[cfg(test)]
mod tests {
    use super::{Lcg, Random};

    /// Produced by the TypeScript `Random` with the same seeds.
    const SEED_1234: [f64; 5] = [
        0.073_294_978_1,
        0.703_411_989_8,
        0.902_856_019_1,
        0.970_549_366_2,
        0.040_963_976_2,
    ];
    const SEED_MAX: [f64; 3] = [0.896_422_614_1, 0.189_478_256_7, 0.715_652_678_2];

    #[test]
    fn matches_typescript_stream() {
        let mut random = Random::new(1234);
        for expected in SEED_1234 {
            let actual = random.next_f64();
            assert!(
                (actual - expected).abs() < 1e-10,
                "expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn matches_typescript_stream_at_u32_max() {
        let mut random = Random::new(u32::MAX);
        for expected in SEED_MAX {
            let actual = random.next_f64();
            assert!(
                (actual - expected).abs() < 1e-10,
                "expected {expected}, got {actual}"
            );
        }
    }

    #[test]
    fn below_stays_in_range() {
        let mut random = Random::new(7);
        for _ in 0..1000 {
            assert!(random.below(17) < 17);
        }
    }

    #[test]
    fn lcg_is_deterministic_and_stays_unit() {
        let mut first = Lcg::new(1234);
        let mut second = Lcg::new(1234);
        for _ in 0..100 {
            let a = first.next_f64();
            let b = second.next_f64();
            assert_eq!(a, b);
            assert!((0.0..1.0).contains(&a));
        }
        assert!(Lcg::new(0).next_f64() >= 0.0);
    }
}

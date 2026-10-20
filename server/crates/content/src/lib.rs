//! Maps, weapons and drop pools, compiled into the binary.
//!
//! `data/*.json` is generated from `web/src/content` by
//! `EXPORT_CONTENT=1 pnpm vitest run tests/tools/export-content.test.ts`, so the
//! TypeScript client and the Rust simulation read the same numbers.

use gunbrawl_core::types::{MapDef, WeaponDef, WeaponId};
use gunbrawl_core::DropPoolEntry;
use serde::Deserialize;

const MAPS_JSON: &str = include_str!("../data/maps.json");
const WEAPONS_JSON: &str = include_str!("../data/weapons.json");
const DROPS_JSON: &str = include_str!("../data/drops.json");

#[derive(Deserialize)]
struct RawDrops {
    default: Vec<RawDrop>,
    standard: Vec<RawDrop>,
}

#[derive(Deserialize)]
struct RawDrop {
    #[serde(rename = "weaponId")]
    weapon: String,
    weight: f64,
}

pub struct Content {
    pub maps: Vec<MapDef>,
    pub weapons: Vec<WeaponDef>,
    pub default_drops: Vec<DropPoolEntry>,
    pub standard_drops: Vec<DropPoolEntry>,
    /// FNV-1a over the three JSON files; sent in `Hello` to reject mixed builds.
    pub hash: u64,
}

impl Content {
    pub fn parse() -> Result<Self, String> {
        let mut maps: Vec<MapDef> =
            serde_json::from_str(MAPS_JSON).map_err(|error| error.to_string())?;
        for map in &mut maps {
            for (index, platform) in map.platforms.iter_mut().enumerate() {
                platform.id = index as u8;
            }
        }
        let weapons: Vec<WeaponDef> =
            serde_json::from_str(WEAPONS_JSON).map_err(|error| error.to_string())?;
        let raw: RawDrops = serde_json::from_str(DROPS_JSON).map_err(|error| error.to_string())?;
        let default_drops = resolve_drops(&weapons, &raw.default)?;
        let standard_drops = resolve_drops(&weapons, &raw.standard)?;
        let hash = fnv1a(&[MAPS_JSON, WEAPONS_JSON, DROPS_JSON]);
        Ok(Self {
            maps,
            weapons,
            default_drops,
            standard_drops,
            hash,
        })
    }

    pub fn map(&self, id: &str) -> Option<&MapDef> {
        self.maps.iter().find(|map| map.id == id)
    }

    pub fn weapon(&self, id: &str) -> Option<&WeaponDef> {
        self.weapons.iter().find(|weapon| weapon.id == id)
    }

    pub fn weapon_id(&self, id: &str) -> Option<WeaponId> {
        self.weapons
            .iter()
            .position(|weapon| weapon.id == id)
            .map(|index| index as WeaponId)
    }

    pub fn pistol(&self) -> WeaponId {
        self.weapon_id("pistol")
            .expect("content must define the baseline pistol")
    }

    /// Pool for a match: `None`/empty means no drops.
    pub fn drop_pool(&self, mode: gunbrawl_core::types::DropMode) -> Vec<DropPoolEntry> {
        match mode {
            gunbrawl_core::types::DropMode::None => Vec::new(),
            gunbrawl_core::types::DropMode::Standard => self.standard_drops.clone(),
            gunbrawl_core::types::DropMode::All => self.default_drops.clone(),
        }
    }
}

fn resolve_drops(weapons: &[WeaponDef], raw: &[RawDrop]) -> Result<Vec<DropPoolEntry>, String> {
    raw.iter()
        .map(|entry| {
            let weapon = weapons
                .iter()
                .position(|weapon| weapon.id == entry.weapon)
                .ok_or_else(|| format!("drop pool references unknown weapon {}", entry.weapon))?;
            Ok(DropPoolEntry {
                weapon: weapon as WeaponId,
                weight: entry.weight,
            })
        })
        .collect()
}

fn fnv1a(parts: &[&str]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_exported_content() {
        let content = Content::parse().expect("content parses");
        assert_eq!(content.maps.len(), 4);
        assert!(content.weapons.len() >= 24);
        assert_eq!(content.default_drops.len(), 18);
        assert_eq!(content.standard_drops.len(), 16);
        assert!(content.map("sky-citadel").is_some());
        assert!(content.map("training-deck").is_some());
    }

    #[test]
    fn platform_ids_are_assigned_by_index() {
        let content = Content::parse().expect("content parses");
        let map = content.map("sky-citadel").expect("map");
        for (index, platform) in map.platforms.iter().enumerate() {
            assert_eq!(platform.id as usize, index);
        }
    }

    #[test]
    fn pistol_and_ultimate_ids_resolve() {
        let content = Content::parse().expect("content parses");
        assert!(content.weapon("pistol").is_some());
        assert!(content.weapon("gatling").is_some());
        assert!(content.weapon_id("not-a-weapon").is_none());
    }
}

//! Runtime game settings edited from the admin console.
//!
//! Values are stored as one JSON row in the `settings` table and mirrored in memory, so
//! the hot path (room creation) never touches the database. A zero/empty value means
//! "leave what the player asked for alone".

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::room::RoomConfig;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct GameSettings {
    /// 1..=9 overrides the lobby choice; 0 keeps it.
    pub stocks_override: u8,
    /// 30..=900 seconds overrides the lobby choice; 0 keeps it.
    pub duration_override: u16,
    /// Non-empty forces this map on every new room.
    pub map_override: String,
    /// -1 keeps the lobby choice, 0..=2 forces all/standard/none.
    pub drop_mode_override: i16,
    /// Fill empty slots with bots when the host starts.
    pub bot_fill: bool,
    /// Difficulty for auto-filled bots: 0 easy, 1 normal, 2 hard.
    pub bot_difficulty: u8,
    /// Multiplier applied to every weapon's knockback when a match starts.
    pub knockback_scale: f32,
}

impl Default for GameSettings {
    fn default() -> Self {
        Self {
            stocks_override: 0,
            duration_override: 0,
            map_override: String::new(),
            drop_mode_override: -1,
            bot_fill: false,
            bot_difficulty: 1,
            knockback_scale: 1.0,
        }
    }
}

impl GameSettings {
    /// Clamp whatever the admin form posted into a range the simulation can survive.
    pub fn sanitize(mut self) -> Self {
        self.stocks_override = self.stocks_override.min(9);
        if self.duration_override != 0 {
            self.duration_override = self.duration_override.clamp(30, 900);
        }
        if !(-1..=2).contains(&self.drop_mode_override) {
            self.drop_mode_override = -1;
        }
        self.bot_difficulty = self.bot_difficulty.min(2);
        if !(0.3..=3.0).contains(&self.knockback_scale) || !self.knockback_scale.is_finite() {
            self.knockback_scale = 1.0;
        }
        self.map_override = self.map_override.trim().to_string();
        if self.map_override.len() > 40 {
            self.map_override.truncate(40);
        }
        self
    }

    pub fn apply(&self, config: &mut RoomConfig) {
        if self.stocks_override > 0 {
            config.stocks = self.stocks_override;
        }
        if self.duration_override > 0 {
            config.duration = self.duration_override;
        }
        if !self.map_override.is_empty() {
            config.map = self.map_override.clone();
        }
        if self.drop_mode_override >= 0 {
            config.drop_mode = self.drop_mode_override as u8;
        }
    }
}

pub const SETTINGS_KEY: &str = "game";

pub async fn load(pool: Option<&SqlitePool>) -> GameSettings {
    let Some(pool) = pool else {
        return GameSettings::default();
    };
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(SETTINGS_KEY)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    match row.and_then(|(value,)| serde_json::from_str::<GameSettings>(&value).ok()) {
        Some(settings) => settings.sanitize(),
        None => GameSettings::default(),
    }
}

pub async fn save(pool: Option<&SqlitePool>, settings: &GameSettings) -> Result<(), String> {
    let Some(pool) = pool else {
        return Err("没有数据库，配置只存在于内存中".to_string());
    };
    let value = serde_json::to_string(settings).map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(SETTINGS_KEY)
        .bind(value)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overrides_are_applied_only_when_set() {
        let config = RoomConfig {
            map: "sky-citadel".into(),
            stocks: 3,
            duration: 120,
            drop_mode: 0,
        };
        let mut untouched = config.clone();
        GameSettings::default().apply(&mut untouched);
        assert_eq!(untouched.map, "sky-citadel");
        assert_eq!(untouched.stocks, 3);

        let mut forced = config;
        GameSettings {
            stocks_override: 5,
            duration_override: 300,
            map_override: "sky-citadel".into(),
            drop_mode_override: 2,
            ..GameSettings::default()
        }
        .apply(&mut forced);
        assert_eq!(forced.stocks, 5);
        assert_eq!(forced.duration, 300);
        assert_eq!(forced.drop_mode, 2);
    }

    #[test]
    fn sanitize_clamps_hostile_input() {
        let settings = GameSettings {
            stocks_override: 250,
            duration_override: 5,
            drop_mode_override: 9,
            bot_difficulty: 7,
            knockback_scale: f32::NAN,
            map_override: "x".repeat(80),
            ..GameSettings::default()
        }
        .sanitize();
        assert_eq!(settings.stocks_override, 9);
        assert_eq!(settings.duration_override, 30);
        assert_eq!(settings.drop_mode_override, -1);
        assert_eq!(settings.bot_difficulty, 2);
        assert_eq!(settings.knockback_scale, 1.0);
        assert_eq!(settings.map_override.len(), 40);
    }
}

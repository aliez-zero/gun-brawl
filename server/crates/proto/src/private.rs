//! Configuration and controls for a match owned by a single browser connection.

use super::InputFrame;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateMatch {
    pub mode: String,
    pub map: String,
    pub stocks: u8,
    pub duration: u16,
    pub drop_mode: u8,
    pub seed: u32,
    pub actors: Vec<PrivateActor>,
    pub training_completed: u8,
    pub campaign_level: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateActor {
    pub name: String,
    /// First keyboard, second keyboard, bot, training dummy, or external AI (1..=5).
    pub kind: u8,
    pub difficulty: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PrivateAction {
    Pause,
    Resume,
    ResetTraining,
    SetDummy {
        moving: bool,
    },
    SelectWeapon {
        weapon: String,
    },
    External {
        actor: u8,
        epoch: u32,
        sequence: u32,
        observation_tick: u32,
        hold: u8,
        input: InputFrame,
        intent: u8,
    },
}

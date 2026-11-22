//! Connection-owned matches configure the same simulation and snapshot clock as public rooms.

use bytes::Bytes;
use gunbrawl_content::Content;
use gunbrawl_core::training::TASK_MASK;
use gunbrawl_core::types::{Control, GameMode, MapDef};
use gunbrawl_proto::{
    PrivateAction, PrivateMatch, PHASE_COUNTDOWN, PHASE_PAUSED, PHASE_PLAYING, SLOT_BOT,
    SLOT_DUMMY, SLOT_EXTERNAL, SLOT_HUMAN,
};
use tokio::sync::mpsc;

use super::{difficulty, Command, Player, Room, RoomConfig, Slot, MAX_SLOTS};

fn validate(content: &Content, setup: &PrivateMatch) -> Result<(GameMode, MapDef), &'static str> {
    let Some(map) = content.map(&setup.map) else {
        return Err("地图无效");
    };
    if !(1..=9).contains(&setup.stocks)
        || !(30..=600).contains(&setup.duration)
        || setup.drop_mode > 2
    {
        return Err("对局规则无效");
    }
    if !(2..=MAX_SLOTS).contains(&setup.actors.len()) || map.spawns.len() < setup.actors.len() {
        return Err("参战人数无效");
    }
    if setup.actors.iter().any(|actor| {
        actor.name.trim().is_empty() || actor.name.chars().count() > 16 || actor.difficulty > 2
    }) {
        return Err("角色名称或难度无效");
    }
    let kinds: Vec<_> = setup.actors.iter().map(|actor| actor.kind).collect();
    let mode = match (setup.mode.as_str(), kinds.as_slice()) {
        ("duel-ai", [1, 3 | 5]) => GameMode::DuelAi,
        ("local-duel", [1, 2]) => GameMode::LocalDuel,
        ("training", [1, 4]) if setup.map == "training-deck" => GameMode::Training,
        ("custom", [1, rest @ ..])
            if rest.iter().all(|kind| matches!(kind, 2 | 3))
                && rest.iter().filter(|kind| **kind == 2).count() <= 1 =>
        {
            GameMode::Custom
        }
        ("campaign", [1, 3]) => GameMode::Campaign,
        _ => return Err("模式与参战槽位不匹配"),
    };
    if setup.training_completed & !TASK_MASK != 0
        || (mode != GameMode::Training && setup.training_completed != 0)
    {
        return Err("训练进度无效");
    }
    if mode == GameMode::Campaign {
        if !setup.campaign_level.as_deref().is_some_and(|id| {
            content.campaign_level_matches(
                id,
                &setup.map,
                setup.stocks,
                setup.duration,
                setup.drop_mode,
                setup.actors[1].difficulty,
            )
        }) {
            return Err("战役关卡与配置不匹配");
        }
    } else if setup.campaign_level.is_some() {
        return Err("关卡仅适用于战役");
    }
    Ok((mode, map.clone()))
}

impl Room {
    pub fn start_private(
        &mut self,
        player: Player,
        sender: mpsc::UnboundedSender<Bytes>,
        setup: PrivateMatch,
    ) -> Result<(), &'static str> {
        let (mode, map) = validate(&self.content, &setup)?;
        let mut controls = Vec::with_capacity(setup.actors.len());
        for (index, actor) in setup.actors.into_iter().enumerate() {
            let (kind, control) = match actor.kind {
                1 | 2 => (SLOT_HUMAN, Control::Human(actor.kind)),
                3 => (SLOT_BOT, Control::Bot(difficulty(actor.difficulty))),
                4 => (SLOT_DUMMY, Control::Dummy),
                5 => (SLOT_EXTERNAL, Control::External),
                _ => unreachable!("validated roster"),
            };
            self.slots[index] = Slot {
                kind,
                player: if kind == SLOT_HUMAN { player.id } else { 0 },
                name: actor.name,
                ready: true,
                difficulty: actor.difficulty,
            };
            controls.push((index, control));
        }
        self.private = true;
        self.seed = setup.seed;
        self.host = player.id;
        self.players.insert(player.id, sender);
        self.config = RoomConfig {
            map: setup.map,
            stocks: setup.stocks,
            duration: setup.duration,
            drop_mode: setup.drop_mode,
        };
        self.begin_match(mode, map, controls, setup.training_completed);
        Ok(())
    }

    pub(super) fn handle_private(&mut self, command: Command) {
        match command {
            Command::PrivateInput {
                player,
                actor,
                frames,
            } if player == self.host && matches!(self.phase, PHASE_COUNTDOWN | PHASE_PLAYING) => {
                let index = usize::from(actor);
                if self
                    .slots
                    .get(index)
                    .is_some_and(|slot| slot.kind == SLOT_HUMAN)
                {
                    self.inputs[index].push_batch(frames);
                }
            }
            Command::PrivateControl { player, action } if player == self.host => {
                self.apply_control(action)
            }
            Command::Leave { player } | Command::Disconnect { player } if player == self.host => {
                self.shutdown = true
            }
            Command::Close => self.shutdown = true,
            _ => {}
        }
    }

    fn apply_control(&mut self, action: PrivateAction) {
        let Some(mut simulation) = self.simulation.take() else {
            return;
        };
        let changed = match action {
            PrivateAction::Pause if matches!(self.phase, PHASE_COUNTDOWN | PHASE_PLAYING) => {
                simulation.pause();
                self.inputs.iter_mut().for_each(|input| input.clear_held());
                true
            }
            PrivateAction::Resume if self.phase == PHASE_PAUSED => {
                simulation.resume();
                true
            }
            PrivateAction::ResetTraining if simulation.reset_training() => {
                self.pending_events.clear();
                self.inputs.iter_mut().for_each(|input| input.clear_held());
                true
            }
            PrivateAction::SelectWeapon { weapon } => self
                .content
                .weapon_id(&weapon)
                .is_some_and(|weapon| simulation.select_training_weapon(weapon)),
            PrivateAction::SetDummy { moving } => {
                if let Some(training) = &mut simulation.training {
                    let changed = training.dummy_moving != moving;
                    training.dummy_moving = moving;
                    changed
                } else {
                    false
                }
            }
            PrivateAction::External { .. } => {
                if let Some(external) = &mut self.external {
                    external.sync(&simulation.state);
                    external.accept(&action, self.playing_tick);
                }
                false
            }
            _ => false,
        };
        if changed {
            self.collect_events(&mut simulation);
            // Paused rooms have no periodic snapshots. Assign control snapshots a new tick
            // as well, so the client can order even two controls processed before one step.
            self.send_snapshot(&simulation);
            self.tick = self.tick.wrapping_add(1);
        }
        self.simulation = Some(simulation);
    }
}

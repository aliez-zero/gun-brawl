use bytes::Bytes;
use gunbrawl_core::types::{ActorStatus, Control, Difficulty, GameMode};
use gunbrawl_proto::{
    decode, InputFrame, PrivateAction, PrivateActor, PrivateMatch, Snapshot, EDGE_BOMB, EDGE_DROP,
    EDGE_JUMP, EVENT_PHASE, EVENT_RINGOUT, HELD_FIRE, PHASE_COUNTDOWN, PHASE_PAUSED, PHASE_RESULT,
    S2C,
};
use tokio::sync::mpsc;

use super::tests::test_room;
use super::{Command, Player, Room};

const OWNER: u32 = 21;

fn setup(mode: &str, kinds: &[u8]) -> PrivateMatch {
    PrivateMatch {
        mode: mode.into(),
        map: "training-deck".into(),
        stocks: 3,
        duration: 180,
        drop_mode: 0,
        seed: 42,
        actors: kinds
            .iter()
            .enumerate()
            .map(|(index, kind)| PrivateActor {
                name: format!("Seat {index}"),
                kind: *kind,
                difficulty: 1,
            })
            .collect(),
        training_completed: 0,
        campaign_level: None,
    }
}

fn start(setup: PrivateMatch) -> Result<(Room, mpsc::UnboundedReceiver<Bytes>), &'static str> {
    let mut room = test_room();
    let (sender, receiver) = mpsc::unbounded_channel();
    room.start_private(
        Player {
            id: OWNER,
            name: "owner".into(),
        },
        sender,
        setup,
    )?;
    Ok((room, receiver))
}

fn advance(room: &mut Room, steps: usize) {
    for _ in 0..steps {
        room.step();
    }
}

fn input(room: &mut Room, actor: u8, seq: u32, move_x: i8, held: u8, edges: u8) {
    room.handle(Command::PrivateInput {
        player: OWNER,
        actor,
        frames: vec![InputFrame {
            seq,
            tick_hint: 0,
            move_x,
            held,
            edges,
        }],
    });
}

fn control(room: &mut Room, action: PrivateAction) {
    room.handle(Command::PrivateControl {
        player: OWNER,
        action,
    });
}

fn snapshot(room: &Room) -> Box<Snapshot> {
    match decode(room.last_snapshot.as_ref().unwrap()).unwrap() {
        S2C::Snapshot(snapshot) => snapshot,
        _ => panic!("expected snapshot"),
    }
}

fn campaign() -> PrivateMatch {
    let mut match_setup = setup("campaign", &[1, 3]);
    match_setup.map = "sky-citadel".into();
    match_setup.campaign_level = Some("level-1".into());
    match_setup.duration = 120;
    match_setup.actors[1].difficulty = 0;
    match_setup
}

#[test]
fn validates_rosters_rules_and_canonical_campaign_before_starting() {
    for (mode, kinds) in [
        ("duel-ai", &[1, 2][..]),
        ("training", &[1, 3]),
        ("local-duel", &[2, 1]),
        ("custom", &[1, 1]),
        ("custom", &[1, 2, 2]),
        ("custom", &[1, 5]),
        ("campaign", &[1, 3, 3]),
        ("unknown", &[1, 3]),
    ] {
        assert!(start(setup(mode, kinds)).is_err(), "{mode} {kinds:?}");
    }
    let custom = setup("custom", &[1, 3, 2, 3]);
    for bad in [
        PrivateMatch {
            map: "unknown".into(),
            ..custom.clone()
        },
        PrivateMatch {
            stocks: 0,
            ..custom.clone()
        },
        PrivateMatch {
            duration: 601,
            ..custom.clone()
        },
        PrivateMatch {
            drop_mode: 3,
            ..custom.clone()
        },
        PrivateMatch {
            training_completed: 1,
            ..custom.clone()
        },
        PrivateMatch {
            campaign_level: Some("level-1".into()),
            ..custom.clone()
        },
        PrivateMatch {
            training_completed: 64,
            ..setup("training", &[1, 4])
        },
        PrivateMatch {
            map: "neon-city".into(),
            ..setup("training", &[1, 4])
        },
        PrivateMatch {
            duration: 119,
            ..campaign()
        },
        PrivateMatch {
            campaign_level: None,
            ..campaign()
        },
    ] {
        assert!(start(bad).is_err());
    }
    let mut altered_difficulty = campaign();
    altered_difficulty.actors[1].difficulty = 2;
    assert!(start(altered_difficulty).is_err());
    let (room, _rx) = start(campaign()).unwrap();
    let config = &room.simulation.as_ref().unwrap().state.config;
    assert_eq!(config.mode, GameMode::Campaign);
    assert_eq!(config.actors[1].control, Control::Bot(Difficulty::Easy));
    assert_eq!(config.seed, 42);
    assert!(room.directory.list().is_empty());
}

#[test]
fn only_owner_keyboards_accept_private_frames_in_a_custom_roster() {
    let (mut room, _rx) = start(setup("custom", &[1, 3, 2, 3])).unwrap();
    input(&mut room, 2, 17, -1, 0, 0);
    input(&mut room, 1, 18, 1, 0, 0);
    input(&mut room, 255, 19, 1, 0, 0);
    let frames = vec![InputFrame {
        seq: 25,
        tick_hint: 0,
        move_x: 1,
        held: 0,
        edges: 0,
    }];
    room.handle(Command::PrivateInput {
        player: OWNER + 1,
        actor: 0,
        frames: frames.clone(),
    });
    room.handle(Command::Input {
        player: OWNER,
        frames,
    });
    room.handle(Command::PrivateControl {
        player: OWNER + 1,
        action: PrivateAction::Pause,
    });
    room.step();
    assert_eq!(snapshot(&room).acks, [0, 0, 17, 0]);
    assert_eq!(snapshot(&room).phase, PHASE_COUNTDOWN);
    assert!(room.directory.list().is_empty());
}

#[test]
fn training_credits_all_six_tasks_from_inputs_and_events_and_keeps_progress_on_reset() {
    let (mut room, _rx) = start(setup("training", &[1, 4])).unwrap();
    advance(&mut room, 183);
    let original_dummy_x = room.simulation.as_ref().unwrap().state.actors[1].position.x;
    input(&mut room, 0, 1, 1, 0, 0);
    advance(&mut room, 37);
    assert_eq!(snapshot(&room).training_completed, 1);
    assert!(snapshot(&room).dummy_moving);
    assert!(room.simulation.as_ref().unwrap().state.actors[1].position.x < original_dummy_x);
    control(&mut room, PrivateAction::SetDummy { moving: false });
    input(&mut room, 0, 2, 0, 0, EDGE_JUMP);
    room.step();
    input(&mut room, 0, 3, 0, 0, EDGE_JUMP);
    advance(&mut room, 2);
    assert_eq!(snapshot(&room).training_completed, 0b11);

    control(&mut room, PrivateAction::ResetTraining);
    advance(&mut room, 182);
    input(&mut room, 0, 4, 0, 0, EDGE_DROP);
    advance(&mut room, 2);
    assert_eq!(snapshot(&room).training_completed, 0b111);

    control(&mut room, PrivateAction::ResetTraining);
    control(
        &mut room,
        PrivateAction::SelectWeapon {
            weapon: "awm".into(),
        },
    );
    let awm = room.content.weapon_id("awm").unwrap();
    advance(&mut room, 181);
    input(&mut room, 0, 5, 0, HELD_FIRE, 0);
    advance(&mut room, 32);
    assert_eq!(snapshot(&room).training_completed, 0b1111);
    assert_eq!(
        room.simulation.as_ref().unwrap().state.actors[1]
            .last_hit
            .unwrap()
            .by,
        0
    );
    let state = &mut room.simulation.as_mut().unwrap().state;
    state.actors[1].position.y = state.config.map.bounds.bottom + 100.0;
    input(&mut room, 0, 6, 0, 0, EDGE_BOMB);
    room.step();
    assert_eq!(
        room.simulation.as_ref().unwrap().state.actors[1].status,
        ActorStatus::Respawning
    );
    control(&mut room, PrivateAction::Pause);
    let paused = snapshot(&room);
    assert_eq!(paused.phase, PHASE_PAUSED);
    assert_eq!(paused.training_completed, 0b11_1111);
    assert_eq!(paused.bombs.len(), 1);
    let pause_events = paused
        .events
        .iter()
        .any(|event| event.kind == EVENT_PHASE && event.other == PHASE_PAUSED);
    assert!(pause_events);
    advance(&mut room, 120);
    assert_eq!(snapshot(&room), paused);
    control(&mut room, PrivateAction::ResetTraining);
    let reset = snapshot(&room);
    assert_eq!(
        (reset.training_completed, reset.dummy_moving),
        (0b11_1111, false)
    );
    assert_eq!(
        (reset.phase, reset.countdown_ms, reset.server_ms),
        (PHASE_COUNTDOWN, 3000, 0)
    );
    assert_eq!(reset.actors[0].weapon, awm);
    assert_eq!(reset.actors[1].stocks, 3);
    assert_eq!(reset.actors[0].bombs, 2);
    assert!(reset.bombs.is_empty() && reset.projectiles.is_empty() && reset.drops.is_empty());
    assert!(reset.tick > paused.tick);
}

#[test]
fn a_private_campaign_sends_its_authoritative_result_once() {
    let (mut room, mut receiver) = start(campaign()).unwrap();
    advance(&mut room, 182);
    let state = &mut room.simulation.as_mut().unwrap().state;
    state.actors[1].stocks = 1;
    state.actors[1].position.y = state.config.map.bounds.bottom + 100.0;
    room.step();
    assert_eq!(room.phase, PHASE_RESULT);
    let final_frame = snapshot(&room);
    assert!(final_frame
        .events
        .iter()
        .any(|event| event.kind == EVENT_RINGOUT && event.actor == 1 && event.other == 255));
    advance(&mut room, 120);
    let mut results = Vec::new();
    while let Ok(bytes) = receiver.try_recv() {
        if let S2C::MatchEnd(result) = decode(&bytes).unwrap() {
            results.push(result);
        }
    }
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].winner, Some(0));
    assert_eq!(results[0].actors[1].falls, 1);
    assert!(room.directory.list().is_empty());
}

#[test]
fn external_decisions_follow_the_playing_clock_and_invalidate_on_lifecycle_changes() {
    let (mut room, _rx) = start(setup("duel-ai", &[1, 5])).unwrap();
    advance(&mut room, 179);
    let countdown = snapshot(&room);
    assert_eq!(countdown.playing_tick, 0);
    advance(&mut room, 4);
    let playing = snapshot(&room);
    assert_eq!(playing.playing_tick, 3);
    assert!(playing.external_epoch > countdown.external_epoch);
    let decision = |epoch, sequence, observation_tick, hold| PrivateAction::External {
        actor: 1,
        epoch,
        sequence,
        observation_tick,
        hold,
        input: InputFrame {
            seq: 0,
            tick_hint: 0,
            move_x: 1,
            held: 0,
            edges: EDGE_BOMB,
        },
        intent: 0,
    };
    let clock = playing.playing_tick;
    let epoch = playing.external_epoch;
    for invalid in [
        decision(countdown.external_epoch, 1, clock, 2),
        decision(epoch, 1, clock + 1, 2),
        decision(epoch, 1, clock, 0),
        decision(epoch, 1, clock, 46),
    ] {
        assert!(!room.external.as_mut().unwrap().accept(&invalid, clock));
    }
    control(&mut room, decision(epoch, 1, clock, 3));
    assert!(!room
        .external
        .as_mut()
        .unwrap()
        .accept(&decision(epoch, 1, clock, 3), clock));
    advance(&mut room, 10);
    let actor = &room.simulation.as_ref().unwrap().state.actors[1];
    assert_eq!(actor.bombs_remaining, 1);
    assert_eq!(actor.move_velocity, 0.0);
    assert!(!room
        .external
        .as_mut()
        .unwrap()
        .accept(&decision(epoch, 2, clock, 3), clock + 180));

    control(&mut room, PrivateAction::Pause);
    let paused = snapshot(&room);
    assert!(paused.external_epoch > epoch);
    advance(&mut room, 60);
    control(&mut room, PrivateAction::Resume);
    assert_eq!(snapshot(&room).playing_tick, paused.playing_tick);
    advance(&mut room, 180);
    let resumed_epoch = room.external.as_ref().unwrap().epoch();
    assert!(resumed_epoch > paused.external_epoch);
    assert_eq!(room.playing_tick, paused.playing_tick);
    let state = &mut room.simulation.as_mut().unwrap().state;
    state.actors[1].position.y = state.config.map.bounds.bottom + 100.0;
    room.step();
    let after_ringout = room.external.as_ref().unwrap().epoch();
    assert!(after_ringout > resumed_epoch);
    advance(&mut room, 62);
    assert!(room.external.as_ref().unwrap().epoch() > after_ringout);
    let tick = room.playing_tick;
    assert!(!room
        .external
        .as_mut()
        .unwrap()
        .accept(&decision(resumed_epoch, 2, tick, 2), tick));
}

#[test]
fn external_attack_intent_turns_and_fires_without_model_fire_and_rust_bot_fills_the_gap() {
    let (mut room, _rx) = start(setup("duel-ai", &[1, 5])).unwrap();
    advance(&mut room, 180);
    let state = &mut room.simulation.as_mut().unwrap().state;
    let before = state.actors[1].position.x;
    state.actors[1].facing = 1;
    let action = PrivateAction::External {
        actor: 1,
        epoch: room.external.as_ref().unwrap().epoch(),
        sequence: 1,
        observation_tick: 0,
        hold: 1,
        input: InputFrame {
            seq: 0,
            tick_hint: 0,
            move_x: 0,
            held: 0,
            edges: 0,
        },
        intent: 1,
    };
    control(&mut room, action);
    room.step();
    let frame = snapshot(&room);
    assert!(frame
        .events
        .iter()
        .any(|event| event.kind == gunbrawl_proto::EVENT_SHOT && event.actor == 1));
    assert_eq!(frame.actors[1].facing, -1);
    advance(&mut room, 18);
    assert!(room.simulation.as_ref().unwrap().state.actors[1].position.x < before - 20.0);
}

#[test]
fn snapshots_keep_distinct_entity_ids_beyond_one_byte_and_current_timers() {
    use gunbrawl_core::types::{DropState, Vec2, WeaponDrop};
    use gunbrawl_proto::{quantize_vel, EVENT_BOMB};
    let (mut room, _rx) = start(setup("training", &[1, 4])).unwrap();
    advance(&mut room, 181);
    input(&mut room, 0, 1, 0, HELD_FIRE, EDGE_BOMB);
    room.step();
    let state = &mut room.simulation.as_mut().unwrap().state;
    state.projectiles[0].id = 257;
    let bomb = &mut state.bombs[0];
    bomb.id = 513;
    let fuse = (bomb.fuse_remaining * 1000.0).round() as u16;
    let velocity = quantize_vel(bomb.velocity.y as f32);
    state.drops.push(WeaponDrop {
        id: 769,
        weapon: 1,
        position: Vec2::new(120.0, 620.0),
        state: DropState::Active,
        timer: 12.5,
        warning: false,
    });
    control(&mut room, PrivateAction::Pause);
    let frame = snapshot(&room);
    assert_eq!(
        (
            frame.projectiles[0].id,
            frame.bombs[0].id,
            frame.drops[0].id
        ),
        (257, 513, 769)
    );
    assert_eq!(
        (
            frame.bombs[0].fuse_ms,
            frame.bombs[0].vy,
            frame.drops[0].timer_ms
        ),
        (fuse, velocity, 12_500)
    );
    assert!(frame
        .events
        .iter()
        .any(|event| event.kind == EVENT_BOMB && event.actor == 0 && event.other == 255));
}

#[test]
fn snapshots_report_full_reload_and_bomb_cooldowns_from_room_inputs() {
    use gunbrawl_content::Content;
    use gunbrawl_core::FIXED_STEP;
    use gunbrawl_proto::EDGE_RELOAD;

    for weapon in Content::parse().unwrap().weapons {
        let Some(reload_time) = weapon.reload_time else {
            continue;
        };
        let (mut room, _rx) = start(setup("training", &[1, 4])).unwrap();
        control(
            &mut room,
            PrivateAction::SelectWeapon {
                weapon: weapon.id.clone(),
            },
        );
        advance(&mut room, 180);

        // A partial magazine allows manual reload. A single-round magazine
        // starts reloading automatically when fired on the next tick.
        if weapon.max_ammo != Some(1) {
            input(&mut room, 0, 1, 0, HELD_FIRE, 0);
        }
        room.step();
        input(&mut room, 0, 2, 0, HELD_FIRE, EDGE_RELOAD | EDGE_BOMB);
        room.step();
        let started = snapshot(&room);
        assert_eq!(started.acks[0], 2, "{}", weapon.id);
        let actor = started.actors[0];
        let full_ms = (reload_time * 1000.0).round() as u16;
        assert_eq!(
            (actor.reload_ms, actor.bomb_cooldown_ms),
            (full_ms, 600),
            "{}",
            weapon.id
        );

        advance(&mut room, 2);
        let actor = snapshot(&room).actors[0];
        let remaining_ms = ((reload_time - 2.0 * FIXED_STEP) * 1000.0).round() as u16;
        assert_eq!(
            (actor.reload_ms, actor.bomb_cooldown_ms),
            (remaining_ms, 567),
            "{}",
            weapon.id
        );

        advance(&mut room, 34);
        let ready = snapshot(&room);
        assert_eq!(ready.actors[0].bomb_cooldown_ms, 0, "{}", weapon.id);
        assert_eq!(ready.bombs.len(), 1, "{}", weapon.id);
    }
}

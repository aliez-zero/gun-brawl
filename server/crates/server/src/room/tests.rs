use super::*;
use gunbrawl_core::types::ActorStatus;
use gunbrawl_proto::{Snapshot, EVENT_SHOT};
use std::sync::atomic::Ordering;

pub(super) fn test_room() -> Room {
    let content = Arc::new(Content::parse().expect("content data"));
    let metrics = Arc::new(Metrics::default());
    let config = RoomConfig {
        map: "sky-citadel".to_string(),
        stocks: 3,
        duration: 180,
        drop_mode: 0,
    };
    Room::new(
        "TEST01".to_string(),
        config,
        content,
        metrics,
        None,
        Arc::new(RoomDirectory::default()),
        RoomRules::default(),
    )
}

#[test]
fn a_fresh_room_stays_open() {
    assert!(!test_room().should_close());
}

fn frame(seq: u32, move_x: i8, edges: u8) -> InputFrame {
    InputFrame {
        seq,
        tick_hint: 0,
        move_x,
        held: 0,
        edges,
    }
}

#[test]
fn an_input_backlog_collapses_to_the_newest_frame() {
    let mut queue = InputQueue::new();
    queue.push(frame(1, 1, gunbrawl_proto::EDGE_JUMP));
    queue.push(frame(2, 1, 0));
    queue.push(frame(3, -1, gunbrawl_proto::EDGE_BOMB));

    let applied = queue.consume();

    // Newest state wins, but presses from the skipped frames are not dropped.
    assert_eq!(applied.seq, 3);
    assert_eq!(applied.move_x, -1);
    assert_eq!(
        applied.edges,
        gunbrawl_proto::EDGE_JUMP | gunbrawl_proto::EDGE_BOMB
    );
    assert_eq!(queue.consume().seq, 3, "the backlog should be gone");
}

#[test]
fn a_short_queue_is_applied_in_order() {
    let mut queue = InputQueue::new();
    queue.push(frame(1, 1, 0));
    queue.push(frame(2, -1, gunbrawl_proto::EDGE_JUMP));

    assert_eq!(queue.consume().seq, 1);
    assert_eq!(queue.consume().seq, 2);
    // Nothing queued: repeat the last frame so held buttons keep applying.
    let repeated = queue.consume();
    assert_eq!(repeated.seq, 2);
    assert_eq!(repeated.edges, 0, "edges must not fire twice");
}

#[test]
fn an_abandoned_room_is_reclaimed() {
    let mut room = test_room();
    room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
    assert!(room.should_close());
}

#[test]
fn a_room_with_a_connected_human_is_never_reclaimed() {
    let mut room = test_room();
    let (tx, _rx) = mpsc::unbounded_channel();
    room.handle(Command::Join {
        player: Player {
            id: 7,
            name: "p".to_string(),
        },
        sender: tx,
    });
    room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
    room.step();
    assert!(!room.should_close());
}

#[test]
fn expired_reconnect_grace_frees_the_slot_and_lets_the_room_go() {
    let mut room = test_room();
    let (tx, _rx) = mpsc::unbounded_channel();
    room.handle(Command::Join {
        player: Player {
            id: 7,
            name: "p".to_string(),
        },
        sender: tx,
    });
    room.handle(Command::Disconnect { player: 7 });
    assert!(room.slots.iter().any(|slot| slot.player == 7));
    assert!(
        !room.should_close(),
        "the grace period must outlive the disconnect"
    );

    room.missing
        .insert(7, Instant::now() - RECONNECT_GRACE - Duration::from_secs(1));
    room.last_human_at = Instant::now() - IDLE_ROOM_TIMEOUT - Duration::from_secs(1);
    room.step();

    assert!(
        !room.slots.iter().any(|slot| slot.player == 7),
        "slot should be freed"
    );
    assert!(room.should_close());
}

#[test]
fn a_room_on_the_result_screen_stops_ticking() {
    let mut room = test_room();
    room.phase = PHASE_RESULT;
    let ticks_before = room.metrics.ticks.load(Ordering::Relaxed);
    let matches_before = room.metrics.matches.load(Ordering::Relaxed);

    for _ in 0..120 {
        room.step();
    }

    assert_eq!(room.metrics.ticks.load(Ordering::Relaxed), ticks_before);
    assert_eq!(room.metrics.matches.load(Ordering::Relaxed), matches_before);
}

#[test]
fn a_match_that_runs_out_of_time_is_settled_exactly_once() {
    let mut room = test_room();
    room.config.duration = 1;
    let (tx, _rx) = mpsc::unbounded_channel();
    room.handle(Command::Join {
        player: Player {
            id: 1,
            name: "a".to_string(),
        },
        sender: tx,
    });
    room.handle(Command::PickSlot {
        player: 1,
        slot: 1,
        kind: SLOT_BOT,
        difficulty: 1,
    });
    room.handle(Command::Start { player: 1 });
    assert_eq!(room.phase, PHASE_COUNTDOWN, "the match should have started");

    // 3 s countdown + 1 s match + overtime; 50 s of ticks is far past any of them.
    for _ in 0..3000 {
        room.step();
    }
    let settled = room.metrics.matches.load(Ordering::Relaxed);
    assert_eq!(settled, 1, "the finished match must be settled once");
    assert_eq!(room.phase, PHASE_RESULT);

    for _ in 0..300 {
        room.step();
    }
    assert_eq!(room.metrics.matches.load(Ordering::Relaxed), settled);
}

fn playing_room() -> Room {
    let mut room = test_room();
    let (tx, rx) = mpsc::unbounded_channel();
    std::mem::forget(rx); // keep the seat connected for the whole test
    room.handle(Command::Join {
        player: Player {
            id: 1,
            name: "human".to_string(),
        },
        sender: tx,
    });
    room.handle(Command::PickSlot {
        player: 1,
        slot: 1,
        kind: SLOT_BOT,
        difficulty: 1,
    });
    room.handle(Command::Start { player: 1 });
    for _ in 0..200 {
        room.step(); // past the three second countdown
    }
    room
}

#[test]
fn events_between_snapshots_are_sent_once() {
    let mut room = playing_room();
    room.step(); // send the snapshot immediately before the shot
    let shot_tick = room.tick;
    assert!(!shot_tick.is_multiple_of(TICK_RATE / SNAPSHOT_RATE));
    room.handle(Command::Input {
        player: 1,
        frames: vec![InputFrame {
            held: gunbrawl_proto::HELD_FIRE,
            ..frame(1, 0, 0)
        }],
    });
    room.step();
    room.handle(Command::Input {
        player: 1,
        frames: vec![frame(2, 0, 0)],
    });
    room.step();

    let read_snapshot = |room: &Room| {
        let payload = room.last_snapshot.as_ref().expect("snapshot sent");
        let S2C::Snapshot(snapshot) = gunbrawl_proto::decode(payload).expect("valid snapshot")
        else {
            panic!("expected a snapshot")
        };
        snapshot
    };
    let count_shots = |snapshot: &Snapshot| {
        snapshot
            .events
            .iter()
            .filter(|event| event.kind == EVENT_SHOT && event.actor == 0)
            .count()
    };
    let snapshot = read_snapshot(&room);
    assert_eq!(snapshot.tick, shot_tick + 1);
    assert_eq!(count_shots(&snapshot), 1);

    room.step();
    room.step();
    assert_eq!(count_shots(&read_snapshot(&room)), 0);
}

fn actor(room: &Room, index: usize) -> (ActorStatus, gunbrawl_core::types::Vec2) {
    let actor = &room
        .simulation
        .as_ref()
        .expect("match running")
        .state
        .actors[index];
    (actor.status, actor.position)
}

#[test]
fn a_disconnected_player_keeps_playing_under_a_bot() {
    let mut room = playing_room();
    let (status, start) = actor(&room, 0);
    assert_eq!(status, ActorStatus::Alive);

    room.handle(Command::Disconnect { player: 1 });
    assert!(room.bots[0].is_some(), "a bot should take the seat");

    for _ in 0..120 {
        room.step();
    }
    let (status, moved) = actor(&room, 0);
    assert_eq!(status, ActorStatus::Alive);
    assert!(
        (moved.x - start.x).abs() > 1.0 || (moved.y - start.y).abs() > 1.0,
        "the seat should still be moving: {start:?} -> {moved:?}",
    );
}

#[test]
fn a_match_that_ends_after_everyone_left_is_not_recorded() {
    let mut room = test_room();
    room.config.duration = 1;
    let (tx, rx) = mpsc::unbounded_channel();
    std::mem::forget(rx);
    room.handle(Command::Join {
        player: Player {
            id: 1,
            name: "gone".to_string(),
        },
        sender: tx,
    });
    room.handle(Command::PickSlot {
        player: 1,
        slot: 1,
        kind: SLOT_BOT,
        difficulty: 1,
    });
    room.handle(Command::Start { player: 1 });

    // The human drops right after kickoff; the takeover bot plays the match out.
    // A draw sends the match into 30 s overtime, so allow 50 s of ticks — still short
    // of the 60 s reconnect grace.
    room.handle(Command::Disconnect { player: 1 });
    for _ in 0..3000 {
        room.step();
    }

    assert_eq!(
        room.phase, PHASE_RESULT,
        "the match should still have finished"
    );
    assert_eq!(
        room.metrics.matches.load(Ordering::Relaxed),
        0,
        "an abandoned match must not enter the public history",
    );
}

#[test]
fn reconnecting_takes_control_back_from_the_bot() {
    let mut room = playing_room();
    room.handle(Command::Disconnect { player: 1 });
    assert!(room.bots[0].is_some());

    let (tx, rx) = mpsc::unbounded_channel();
    std::mem::forget(rx);
    room.handle(Command::Resume {
        player: Player {
            id: 1,
            name: "human".to_string(),
        },
        sender: tx,
    });
    assert!(room.bots[0].is_none(), "the human owns the seat again");
}

#[test]
fn a_player_who_never_returns_is_eliminated_mid_match() {
    // Two humans, so the room keeps running after the first one gives up.
    let mut room = test_room();
    for (id, name) in [(1u32, "one"), (2, "two")] {
        let (tx, rx) = mpsc::unbounded_channel();
        std::mem::forget(rx);
        room.handle(Command::Join {
            player: Player {
                id,
                name: name.to_string(),
            },
            sender: tx,
        });
    }
    room.handle(Command::Start { player: 1 });
    for _ in 0..200 {
        room.step();
    }

    room.handle(Command::Disconnect { player: 2 });
    room.missing
        .insert(2, Instant::now() - RECONNECT_GRACE - Duration::from_secs(1));
    room.step();

    let (status, _) = actor(&room, 1);
    assert_eq!(
        status,
        ActorStatus::Eliminated,
        "no ghost actors in the arena"
    );
    assert!(
        room.slots.iter().all(|slot| slot.player != 2),
        "the seat is released"
    );
}

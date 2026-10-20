//! End-to-end room test over a real WebSocket.
//!
//! Two clients connect, create/join a room, start it and exchange inputs; the
//! assertions cover the acknowledgement path and snapshot shape, not rendering.

use futures_util::{SinkExt, StreamExt};
use gunbrawl_proto::{decode, encode, InputFrame, C2S, PROTO_VERSION, S2C};
use gunbrawl_server::{router, AppState};
use tokio::time::{timeout, Duration};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn start_server() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let app = router(AppState::new("web/dist"));
    tokio::spawn(async move {
        let _ = axum::serve(listener, app).await;
    });
    format!("ws://{addr}/ws")
}

async fn connect(url: &str) -> Socket {
    let (socket, _) = connect_async(url).await.expect("connect");
    socket
}

async fn send(socket: &mut Socket, message: &C2S) {
    let bytes = encode(message).expect("encode");
    socket
        .send(Message::Binary(bytes.into()))
        .await
        .expect("send");
}

async fn recv(socket: &mut Socket) -> S2C {
    let message = timeout(Duration::from_secs(5), socket.next())
        .await
        .expect("timeout")
        .expect("stream")
        .expect("message");
    match message {
        Message::Binary(bytes) => decode::<S2C>(&bytes).expect("decode"),
        other => panic!("unexpected frame: {other:?}"),
    }
}

/// Receive until `wanted` returns true, returning that message.
async fn recv_until<T>(socket: &mut Socket, mut wanted: impl FnMut(&S2C) -> Option<T>) -> T {
    for _ in 0..200 {
        let message = recv(socket).await;
        if let Some(value) = wanted(&message) {
            return value;
        }
    }
    panic!("message not received");
}

async fn handshake(socket: &mut Socket) -> (u32, String) {
    send(
        socket,
        &C2S::Hello {
            proto: PROTO_VERSION,
            content: 0,
            token: String::new(),
            build: "test".into(),
        },
    )
    .await;
    let welcome = recv_until(socket, |message| match message {
        S2C::Welcome {
            player_id, name, ..
        } => Some((*player_id, name.clone())),
        _ => None,
    })
    .await;
    welcome
}

#[tokio::test]
async fn two_clients_join_start_and_ack_inputs() {
    let url = start_server().await;
    let mut host = connect(&url).await;
    let mut guest = connect(&url).await;
    let (host_id, _) = handshake(&mut host).await;
    let (guest_id, _) = handshake(&mut guest).await;
    assert_ne!(host_id, guest_id);

    send(
        &mut host,
        &C2S::CreateRoom {
            name: "Host".into(),
            map: "sky-citadel".into(),
            stocks: 3,
            duration: 60,
            drop_mode: 0,
        },
    )
    .await;

    let code = recv_until(&mut host, |message| match message {
        S2C::Room(room) => Some(room.code.clone()),
        _ => None,
    })
    .await;
    assert_eq!(code.len(), 6);

    send(
        &mut guest,
        &C2S::JoinRoom {
            code: code.clone(),
            name: "Guest".into(),
        },
    )
    .await;
    let room = recv_until(&mut guest, |message| match message {
        S2C::Room(room) => Some(room.clone()),
        _ => None,
    })
    .await;
    let humans = room
        .slots
        .iter()
        .filter(|slot| slot.kind == gunbrawl_proto::SLOT_HUMAN)
        .count();
    assert_eq!(humans, 2);
    assert_eq!(room.host, host_id);
    assert!(room
        .weapons
        .iter()
        .any(|weapon| weapon.as_str() == "pistol"));

    send(&mut host, &C2S::Start).await;

    // Both clients receive the countdown room state and periodic snapshots.
    let snapshot = recv_until(&mut host, |message| match message {
        S2C::Snapshot(snapshot) => Some((**snapshot).clone()),
        _ => None,
    })
    .await;
    assert_eq!(snapshot.actors.len(), 2);
    assert!(matches!(
        snapshot.phase,
        gunbrawl_proto::PHASE_COUNTDOWN | gunbrawl_proto::PHASE_PLAYING
    ));

    // Input reaches the room; the next snapshot acknowledges seq 7 for slot 0.
    send(
        &mut host,
        &C2S::Input {
            frames: vec![InputFrame {
                seq: 7,
                tick_hint: 7,
                move_x: 1,
                held: 0,
                edges: 0,
            }],
        },
    )
    .await;
    let acked = recv_until(&mut host, |message| match message {
        S2C::Snapshot(snapshot) if snapshot.acks[0] == 7 => Some(snapshot.acks),
        _ => None,
    })
    .await;
    assert_eq!(acked[0], 7);

    // Guest also receives snapshots for the same room.
    let guest_snapshot = recv_until(&mut guest, |message| match message {
        S2C::Snapshot(snapshot) => Some((**snapshot).clone()),
        _ => None,
    })
    .await;
    assert_eq!(guest_snapshot.actors.len(), 2);
}

#[tokio::test]
async fn token_resumes_the_room_after_reconnect() {
    let url = start_server().await;
    let mut first = connect(&url).await;
    send(
        &mut first,
        &C2S::Hello {
            proto: PROTO_VERSION,
            content: 0,
            token: "reconnect-token".into(),
            build: "test".into(),
        },
    )
    .await;
    let (first_id, _) = recv_until(&mut first, |message| match message {
        S2C::Welcome {
            player_id, name, ..
        } => Some((*player_id, name.clone())),
        _ => None,
    })
    .await;

    send(
        &mut first,
        &C2S::CreateRoom {
            name: "Host".into(),
            map: "sky-citadel".into(),
            stocks: 3,
            duration: 60,
            drop_mode: 0,
        },
    )
    .await;
    let code = recv_until(&mut first, |message| match message {
        S2C::Room(room) => Some(room.code.clone()),
        _ => None,
    })
    .await;

    // Drop the socket without Leave; the room keeps the slot for 60 s.
    let _ = first.close(None).await;
    drop(first);

    let mut second = connect(&url).await;
    send(
        &mut second,
        &C2S::Hello {
            proto: PROTO_VERSION,
            content: 0,
            token: "reconnect-token".into(),
            build: "test".into(),
        },
    )
    .await;
    let (second_id, _) = recv_until(&mut second, |message| match message {
        S2C::Welcome {
            player_id, name, ..
        } => Some((*player_id, name.clone())),
        _ => None,
    })
    .await;
    assert_eq!(first_id, second_id, "same token must keep the player id");

    let resumed = recv_until(&mut second, |message| match message {
        S2C::Room(room) => Some(room.code.clone()),
        _ => None,
    })
    .await;
    assert_eq!(resumed, code, "server should rejoin the previous room");
}

#[tokio::test]
async fn bot_slot_moves_after_countdown() {
    let url = start_server().await;
    let mut host = connect(&url).await;
    handshake(&mut host).await;

    send(
        &mut host,
        &C2S::CreateRoom {
            name: "Host".into(),
            map: "sky-citadel".into(),
            stocks: 3,
            duration: 60,
            drop_mode: 0,
        },
    )
    .await;
    recv_until(&mut host, |message| match message {
        S2C::Room(room) => Some(room.code.clone()),
        _ => None,
    })
    .await;

    send(
        &mut host,
        &C2S::PickSlot {
            slot: 1,
            kind: gunbrawl_proto::SLOT_BOT,
            difficulty: 1,
        },
    )
    .await;
    send(&mut host, &C2S::Start).await;

    let mut start_x = None;
    for _ in 0..900 {
        if let S2C::Snapshot(snapshot) = recv(&mut host).await {
            if snapshot.phase == gunbrawl_proto::PHASE_PLAYING {
                start_x = snapshot.actors.get(1).map(|actor| actor.x);
                break;
            }
        }
    }
    let start_x = start_x.expect("bot actor present");

    let mut moved = false;
    for _ in 0..240 {
        if let S2C::Snapshot(snapshot) = recv(&mut host).await {
            if let Some(bot) = snapshot.actors.get(1) {
                if (bot.x - start_x).abs() > 16 {
                    moved = true;
                    break;
                }
            }
        }
    }
    assert!(moved, "the bot should move after the countdown");
}

//! Owns each WebSocket connection and routes its inputs to its active room.

use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use bytes::Bytes;
use gunbrawl_proto::{decode, encode, C2S, PROTO_VERSION, S2C};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::metrics::Metrics;
use crate::room::{Command as RoomCommand, Player, RoomConfig, RoomRules};
use crate::{AppState, Identity};

pub(super) async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.max_message_size(16 * 1024)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

enum JoinedRoom {
    Shared(String),
    /// The socket is the only sender. Dropping it releases the private room task.
    Private(mpsc::Sender<RoomCommand>),
}

struct Session {
    player_id: u32,
    name: String,
    room: Option<JoinedRoom>,
    token: String,
}

impl Session {
    fn player(&self) -> Player {
        Player {
            id: self.player_id,
            name: self.name.clone(),
        }
    }
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Bytes>();
    let mut session = Session {
        player_id: 0,
        name: String::new(),
        room: None,
        token: String::new(),
    };
    let mut greeted = false;
    let mut counted_player = false;

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let message = match incoming {
                    Some(Ok(Message::Binary(bytes))) => bytes,
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => continue,
                };
                let Ok(message) = decode::<C2S>(&message) else {
                    warn!(player_id = session.player_id, "undecodable client message");
                    continue;
                };
                if !greeted {
                    match message {
                        C2S::Hello { proto, token, .. } if proto == PROTO_VERSION => {
                            greeted = true;
                            let (player_id, name, room) = identity_for(&state, &token);
                            session.player_id = player_id;
                            session.name = name;
                            session.token = token;
                            Metrics::incr(&state.metrics.players);
                            counted_player = true;
                            send(&out_tx, &S2C::Welcome {
                                player_id,
                                name: session.name.clone(),
                                token_expires: 0,
                                tick_rate: gunbrawl_core::TICK_RATE as u16,
                                snapshot_rate: gunbrawl_core::SNAPSHOT_RATE as u16,
                            });
                            // Reconnect: the room keeps the slot for 60 s and replays state.
                            if let Some(code) = room {
                                if state.lobby.resume(&code, session.player(), out_tx.clone()) {
                                    session.room = Some(JoinedRoom::Shared(code));
                                }
                            }
                            info!(player_id, "client connected");
                        }
                        C2S::Hello { proto, .. } => {
                            reject_handshake(&mut socket, 426, format!("游戏版本不一致，请刷新页面（{proto}/{PROTO_VERSION}）")).await;
                            break;
                        }
                        _ => {
                            reject_handshake(&mut socket, 401, "send Hello first".into()).await;
                            break;
                        }
                    }
                    continue;
                }
                handle_message(&state, &mut session, message, &out_tx).await;
            }
            outgoing = out_rx.recv() => {
                if let Some(bytes) = outgoing {
                    if socket.send(Message::Binary(bytes)).await.is_err() {
                        break;
                    }
                }
            }
        }
    }

    if let Some(JoinedRoom::Shared(code)) = session.room.take() {
        let _ = state.lobby.send(
            &code,
            RoomCommand::Disconnect {
                player: session.player_id,
            },
        );
    }
    if counted_player {
        Metrics::decr(&state.metrics.players);
    }
    info!(player_id = session.player_id, "client disconnected");
}

/// Resolve a device token to a stable identity; new tokens get a fresh id.
fn identity_for(state: &AppState, token: &str) -> (u32, String, Option<String>) {
    if token.is_empty() {
        let id = state.lobby.next_player_id();
        return (id, format!("玩家{id}"), None);
    }
    let mut sessions = state
        .sessions
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    sessions.retain(|_, identity| identity.seen.elapsed() < Duration::from_secs(60));
    if let Some(identity) = sessions.get_mut(token) {
        identity.seen = Instant::now();
        return (
            identity.player_id,
            identity.name.clone(),
            identity.room.clone(),
        );
    }
    let id = state.lobby.next_player_id();
    let name = format!("玩家{id}");
    sessions.insert(
        token.to_owned(),
        Identity {
            player_id: id,
            name: name.clone(),
            room: None,
            seen: Instant::now(),
        },
    );
    (id, name, None)
}

fn remember_room(state: &AppState, token: &str, name: &str, code: &str) {
    if token.is_empty() {
        return;
    }
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(identity) = sessions.get_mut(token) {
            identity.room = Some(code.to_owned());
            identity.name = name.to_owned();
            identity.seen = Instant::now();
        }
    }
}

fn forget_room(state: &AppState, token: &str) {
    if token.is_empty() {
        return;
    }
    if let Ok(mut sessions) = state.sessions.lock() {
        if let Some(identity) = sessions.get_mut(token) {
            identity.room = None;
        }
    }
}

async fn handle_message(
    state: &AppState,
    session: &mut Session,
    message: C2S,
    out_tx: &mpsc::UnboundedSender<Bytes>,
) {
    match message {
        C2S::StartPrivate { .. } | C2S::CreateRoom { .. } | C2S::JoinRoom { .. }
            if session.room.is_some() =>
        {
            send(
                out_tx,
                &S2C::Kick {
                    code: 409,
                    message: "请先离开当前对局".into(),
                },
            );
        }
        C2S::StartPrivate { setup } => {
            match state
                .lobby
                .start_private(session.player(), out_tx.clone(), setup)
            {
                Ok(tx) => session.room = Some(JoinedRoom::Private(tx)),
                Err(message) => send(
                    out_tx,
                    &S2C::Kick {
                        code: 400,
                        message: message.into(),
                    },
                ),
            }
        }
        C2S::PrivateInput { actor, frames } => {
            if let Some(JoinedRoom::Private(tx)) = &session.room {
                let _ = tx.try_send(RoomCommand::PrivateInput {
                    player: session.player_id,
                    actor,
                    frames,
                });
            }
        }
        C2S::PrivateControl { action } => {
            if let Some(JoinedRoom::Private(tx)) = &session.room {
                // Controls are infrequent, and silently dropping a pause or reset would
                // leave the screen and the authoritative match in different states.
                if tx
                    .send(RoomCommand::PrivateControl {
                        player: session.player_id,
                        action,
                    })
                    .await
                    .is_err()
                {
                    send(
                        out_tx,
                        &S2C::Kick {
                            code: 410,
                            message: "本场对局已结束".into(),
                        },
                    );
                }
            }
        }
        C2S::CreateRoom {
            name,
            map,
            stocks,
            duration,
            drop_mode,
        } => {
            if !name.is_empty() && name.chars().count() <= 16 {
                session.name = name;
            }
            let mut config = RoomConfig {
                map,
                stocks: stocks.clamp(2, 9),
                duration: duration.clamp(30, 600),
                drop_mode: drop_mode.min(2),
            };
            // Admin rules win over the lobby form: that is what "后台配置" means here.
            let settings = state.settings();
            settings.apply(&mut config);
            let rules = RoomRules {
                weapon_scale: settings.knockback_scale,
                bot_fill: settings.bot_fill,
                bot_difficulty: settings.bot_difficulty,
            };
            let Some(code) = state.lobby.create(config, rules) else {
                send(
                    out_tx,
                    &S2C::Kick {
                        code: 503,
                        message: "房间已满".into(),
                    },
                );
                return;
            };
            if state.lobby.join(&code, session.player(), out_tx.clone()) {
                remember_room(state, &session.token, &session.name, &code);
                session.room = Some(JoinedRoom::Shared(code));
            } else {
                send(
                    out_tx,
                    &S2C::Kick {
                        code: 500,
                        message: "建房失败".into(),
                    },
                );
            }
        }
        C2S::JoinRoom { code, name } => {
            if !name.is_empty() && name.chars().count() <= 16 {
                session.name = name;
            }
            if !state.lobby.exists(&code) {
                send(
                    out_tx,
                    &S2C::Kick {
                        code: 404,
                        message: "房间不存在".into(),
                    },
                );
                return;
            }
            if state.lobby.join(&code, session.player(), out_tx.clone()) {
                remember_room(state, &session.token, &session.name, &code);
                session.room = Some(JoinedRoom::Shared(code));
            } else {
                send(
                    out_tx,
                    &S2C::Kick {
                        code: 409,
                        message: "加入失败".into(),
                    },
                );
            }
        }
        C2S::Ready { ready } => {
            if let Some(JoinedRoom::Shared(code)) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Ready {
                        player: session.player_id,
                        ready,
                    },
                );
            }
        }
        C2S::PickSlot {
            slot,
            kind,
            difficulty,
        } => {
            if let Some(JoinedRoom::Shared(code)) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::PickSlot {
                        player: session.player_id,
                        slot,
                        kind,
                        difficulty,
                    },
                );
            }
        }
        C2S::Start => {
            if let Some(JoinedRoom::Shared(code)) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Start {
                        player: session.player_id,
                    },
                );
            }
        }
        C2S::Rematch => {
            if let Some(JoinedRoom::Shared(code)) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Rematch {
                        player: session.player_id,
                    },
                );
            }
        }
        C2S::Input { frames } => {
            if let Some(JoinedRoom::Shared(code)) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Input {
                        player: session.player_id,
                        frames,
                    },
                );
            }
        }
        C2S::Ping { t } => {
            send(out_tx, &S2C::Pong { t, server_tick: 0 });
        }
        C2S::Leave => {
            forget_room(state, &session.token);
            if let Some(JoinedRoom::Shared(code)) = session.room.take() {
                let _ = state.lobby.send(
                    &code,
                    RoomCommand::Leave {
                        player: session.player_id,
                    },
                );
            }
        }
        C2S::Hello { .. } => {}
    }
}

fn send(out_tx: &mpsc::UnboundedSender<Bytes>, message: &S2C) {
    if let Ok(payload) = encode(message) {
        let _ = out_tx.send(Bytes::from(payload));
    }
}

async fn reject_handshake(socket: &mut WebSocket, code: u16, message: String) {
    if let Ok(bytes) = encode(&S2C::Kick { code, message }) {
        let _ = socket.send(Message::Binary(bytes.into())).await;
    }
}

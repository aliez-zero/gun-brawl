//! HTTP + WebSocket entry point.
//!
//! P0 shipped the handshake; P2 adds rooms: create/join, ready/start, 60 Hz
//! simulation per room and 30 Hz snapshots.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use gunbrawl_content::Content;
use gunbrawl_proto::{decode, encode, C2S, PROTO_VERSION, S2C};
use tokio::sync::mpsc;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

use crate::lobby::Lobby;
use crate::room::{Command as RoomCommand, Player, RoomConfig};

pub mod lobby;
pub mod room;

#[derive(Clone)]
pub struct AppState {
    web_dir: String,
    lobby: Arc<Lobby>,
    content: Arc<Content>,
}

impl AppState {
    pub fn new(web_dir: impl Into<String>) -> Self {
        let content = Arc::new(Content::parse().expect("content data must be valid"));
        Self {
            web_dir: web_dir.into(),
            lobby: Arc::new(Lobby::new(content.clone())),
            content,
        }
    }

    pub fn content_hash(&self) -> u64 {
        self.content.hash
    }
}

pub fn router(state: AppState) -> Router {
    let index = format!("{}/index.html", state.web_dir.trim_end_matches('/'));
    let files = ServeDir::new(state.web_dir.clone()).not_found_service(ServeFile::new(index));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/ws", get(ws_handler))
        .fallback_service(files)
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

struct Session {
    player_id: u32,
    name: String,
    room: Option<String>,
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
    let player_id = state.lobby.next_player_id();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Bytes>();
    let mut session = Session {
        player_id,
        name: format!("玩家{player_id}"),
        room: None,
    };
    let mut greeted = false;
    info!(player_id, "client connected");

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
                    warn!(player_id, "undecodable client message");
                    continue;
                };
                if !greeted {
                    match message {
                        C2S::Hello { proto, .. } if proto == PROTO_VERSION => {
                            greeted = true;
                            send(&out_tx, &S2C::Welcome {
                                player_id,
                                name: session.name.clone(),
                                token_expires: 0,
                                tick_rate: gunbrawl_core::TICK_RATE as u16,
                                snapshot_rate: gunbrawl_core::SNAPSHOT_RATE as u16,
                            });
                        }
                        C2S::Hello { proto, .. } => {
                            send(&out_tx, &S2C::Kick { code: 426, message: format!("protocol {proto} != {PROTO_VERSION}") });
                            break;
                        }
                        _ => {
                            send(&out_tx, &S2C::Kick { code: 401, message: "send Hello first".into() });
                            break;
                        }
                    }
                    continue;
                }
                handle_message(&state, &mut session, message, &out_tx);
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

    if let Some(code) = session.room.take() {
        let _ = state.lobby.send(
            &code,
            RoomCommand::Leave {
                player: session.player_id,
            },
        );
    }
    info!(player_id, "client disconnected");
}

fn handle_message(
    state: &AppState,
    session: &mut Session,
    message: C2S,
    out_tx: &mpsc::UnboundedSender<Bytes>,
) {
    match message {
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
            let config = RoomConfig {
                map,
                stocks: stocks.clamp(2, 9),
                duration: duration.clamp(30, 600),
                drop_mode: drop_mode.min(2),
            };
            let Some(code) = state.lobby.create(config) else {
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
                session.room = Some(code);
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
                session.room = Some(code);
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
            if let Some(code) = &session.room {
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
            if let Some(code) = &session.room {
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
            if let Some(code) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Start {
                        player: session.player_id,
                    },
                );
            }
        }
        C2S::Rematch => {
            if let Some(code) = &session.room {
                let _ = state.lobby.send(
                    code,
                    RoomCommand::Rematch {
                        player: session.player_id,
                    },
                );
            }
        }
        C2S::Input { frames } => {
            if let Some(code) = &session.room {
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
            if let Some(code) = session.room.take() {
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

pub async fn serve(state: AppState, addr: SocketAddr) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "gunbrawl server listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}

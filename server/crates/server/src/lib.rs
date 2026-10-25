//! HTTP + WebSocket entry point.
//!
//! P0 shipped the handshake; P2 adds rooms: create/join, ready/start, 60 Hz
//! simulation per room and 30 Hz snapshots.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::{Json, Router};
use bytes::Bytes;
use gunbrawl_content::Content;
use gunbrawl_proto::{decode, encode, C2S, PROTO_VERSION, S2C};
use tokio::sync::mpsc;
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

use crate::lobby::Lobby;
use crate::metrics::Metrics;
use crate::persist::Persist;
use crate::room::{Command as RoomCommand, Player, RoomConfig};

pub mod lobby;
pub mod metrics;
pub mod persist;
pub mod room;

#[derive(Clone)]
pub struct AppState {
    web_dir: String,
    lobby: Arc<Lobby>,
    content: Arc<Content>,
    metrics: Arc<Metrics>,
    persist: Arc<Persist>,
    /// Anonymous device token -> identity, kept for 60 s so a drop can reconnect.
    sessions: Arc<Mutex<HashMap<String, Identity>>>,
}

struct Identity {
    player_id: u32,
    name: String,
    room: Option<String>,
    seen: Instant,
}

impl AppState {
    pub fn new(web_dir: impl Into<String>) -> Self {
        let content = Arc::new(Content::parse().expect("content data must be valid"));
        let metrics = Arc::new(Metrics::default());
        let persist = Arc::new(Persist::default());
        Self {
            web_dir: web_dir.into(),
            lobby: Arc::new(Lobby::new(
                content.clone(),
                metrics.clone(),
                persist.clone(),
            )),
            content,
            metrics,
            persist,
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn content_hash(&self) -> u64 {
        self.content.hash
    }

    /// Shared handle used by the HTTP API and by tests that seed the database.
    pub fn persist(&self) -> Arc<Persist> {
        self.persist.clone()
    }
}

/// Open the match database (or keep running without it) and start the writer.
pub async fn init_persistence(state: &AppState) -> bool {
    let path = std::env::var("GUNBRAWL_DB").unwrap_or_else(|_| "gunbrawl.db".to_owned());
    crate::persist::init(state.persist.clone(), &path).await
}

pub fn router(state: AppState) -> Router {
    let index = format!("{}/index.html", state.web_dir.trim_end_matches('/'));
    let files = ServeDir::new(state.web_dir.clone()).not_found_service(ServeFile::new(index));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics_handler))
        .route("/api/matches", get(matches_handler))
        .route("/api/stats", get(stats_handler))
        .route("/ws", get(ws_handler))
        .fallback_service(files)
        .with_state(state)
}

async fn healthz() -> &'static str {
    "ok"
}

async fn metrics_handler(State(state): State<AppState>) -> String {
    state.metrics.render(state.lobby.count())
}

/// Recent matches with their score table. 503 when the server runs without a database.
async fn matches_handler(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<persist::MatchSummary>>, (StatusCode, String)> {
    let pool = state
        .persist
        .pool()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "persistence disabled".to_string()))?;
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(20)
        .clamp(1, 100);
    persist::recent_matches(&pool, limit)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn stats_handler(
    State(state): State<AppState>,
) -> Result<Json<persist::PersistStats>, (StatusCode, String)> {
    let pool = state
        .persist
        .pool()
        .ok_or((StatusCode::SERVICE_UNAVAILABLE, "persistence disabled".to_string()))?;
    persist::stats(&pool)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

struct Session {
    player_id: u32,
    name: String,
    room: Option<String>,
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
                                    session.room = Some(code);
                                }
                            }
                            info!(player_id, "client connected");
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
                remember_room(state, &session.token, &session.name, &code);
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
                remember_room(state, &session.token, &session.name, &code);
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
            forget_room(state, &session.token);
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

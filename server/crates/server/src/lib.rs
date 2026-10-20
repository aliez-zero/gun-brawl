//! P0 skeleton: handshake, health endpoint and static hosting.
//!
//! The room actor, snapshots and persistence arrive in P2/P5; this crate keeps
//! the wire format honest from the first commit so the browser can connect.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use bytes::Bytes;
use gunbrawl_proto::{decode, encode_into, C2S, PROTO_VERSION, S2C};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};

#[derive(Clone)]
pub struct AppState {
    web_dir: String,
    next_player: Arc<AtomicU32>,
}

impl AppState {
    pub fn new(web_dir: impl Into<String>) -> Self {
        Self {
            web_dir: web_dir.into(),
            next_player: Arc::new(AtomicU32::new(1)),
        }
    }

    fn next_player_id(&self) -> u32 {
        self.next_player.fetch_add(1, Ordering::Relaxed)
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

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let player_id = state.next_player_id();
    info!(player_id, "client connected");
    // Reused per connection: the room loop will encode once and hand `Bytes`
    // clones to every client instead of re-encoding per recipient.
    let mut out = Vec::with_capacity(512);

    while let Some(Ok(message)) = socket.recv().await {
        match message {
            Message::Binary(bytes) => {
                let message = match decode::<C2S>(&bytes) {
                    Ok(message) => message,
                    Err(error) => {
                        warn!(player_id, %error, "undecodable client message");
                        continue;
                    }
                };
                let leaving = matches!(&message, C2S::Leave);
                if let Some(reply) = handle_client_message(player_id, message) {
                    let kick = matches!(&reply, S2C::Kick { .. });
                    if encode_into(&reply, &mut out).is_err() {
                        break;
                    }
                    if socket
                        .send(Message::Binary(Bytes::copy_from_slice(&out)))
                        .await
                        .is_err()
                    {
                        break;
                    }
                    if kick {
                        break;
                    }
                }
                if leaving {
                    break;
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) | Message::Text(_) => {}
        }
    }

    info!(player_id, "client disconnected");
}

/// Pure message handling, kept separate so it can be unit-tested without a socket.
pub fn handle_client_message(player_id: u32, message: C2S) -> Option<S2C> {
    match message {
        C2S::Hello { proto, .. } => {
            if proto == PROTO_VERSION {
                Some(S2C::Welcome {
                    player_id,
                    name: format!("玩家{player_id}"),
                    token_expires: 0,
                    tick_rate: gunbrawl_core::TICK_RATE as u16,
                    snapshot_rate: gunbrawl_core::SNAPSHOT_RATE as u16,
                })
            } else {
                Some(S2C::Kick {
                    code: 426,
                    message: format!("protocol {proto} != {PROTO_VERSION}"),
                })
            }
        }
        C2S::Ping { t } => Some(S2C::Pong { t, server_tick: 0 }),
        C2S::Ready { .. } | C2S::Input { .. } | C2S::Leave => None,
    }
}

pub async fn serve(state: AppState, addr: std::net::SocketAddr) -> std::io::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!(%addr, "gunbrawl server listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_gets_welcome() {
        let reply = handle_client_message(
            7,
            C2S::Hello {
                proto: PROTO_VERSION,
                content: 0,
                token: String::new(),
                build: "test".into(),
            },
        );
        match reply {
            Some(S2C::Welcome {
                player_id,
                tick_rate,
                snapshot_rate,
                ..
            }) => {
                assert_eq!(player_id, 7);
                assert_eq!(tick_rate, 60);
                assert_eq!(snapshot_rate, 30);
            }
            other => panic!("expected welcome, got {other:?}"),
        }
    }

    #[test]
    fn mismatched_protocol_is_kicked() {
        let reply = handle_client_message(
            1,
            C2S::Hello {
                proto: PROTO_VERSION + 1,
                content: 0,
                token: String::new(),
                build: "old".into(),
            },
        );
        match reply {
            Some(S2C::Kick { code, .. }) => assert_eq!(code, 426),
            other => panic!("expected kick, got {other:?}"),
        }
    }

    #[test]
    fn ping_gets_pong() {
        match handle_client_message(1, C2S::Ping { t: 42 }) {
            Some(S2C::Pong { t, .. }) => assert_eq!(t, 42),
            other => panic!("expected pong, got {other:?}"),
        }
    }

    #[test]
    fn input_is_not_answered() {
        let frame = gunbrawl_proto::InputFrame {
            seq: 1,
            tick_hint: 1,
            move_x: 1,
            held: 0,
            edges: 0,
        };
        assert!(handle_client_message(
            1,
            C2S::Input {
                frames: vec![frame]
            }
        )
        .is_none());
    }
}

//! HTTP + WebSocket entry point.
//!
//! P0 shipped the handshake; P2 adds rooms: create/join, ready/start, 60 Hz
//! simulation per room and 30 Hz snapshots.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use gunbrawl_content::Content;
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;

use crate::admin::AdminState;
use crate::lobby::{Lobby, RoomDirectory};
use crate::metrics::Metrics;
use crate::persist::Persist;
use crate::settings::GameSettings;

pub mod admin;
pub mod lobby;
pub mod metrics;
pub mod persist;
pub mod room;
mod session;
pub mod settings;

#[derive(Clone)]
pub struct AppState {
    web_dir: String,
    lobby: Arc<Lobby>,
    content: Arc<Content>,
    metrics: Arc<Metrics>,
    persist: Arc<Persist>,
    /// Anonymous device token -> identity, kept for 60 s so a drop can reconnect.
    sessions: Arc<Mutex<HashMap<String, Identity>>>,
    /// Admin-editable rules applied to rooms as they are created.
    settings: Arc<RwLock<GameSettings>>,
    admin: Arc<AdminState>,
    directory: Arc<RoomDirectory>,
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
        let directory = Arc::new(RoomDirectory::default());
        let credentials_path = std::env::var("GUNBRAWL_ADMIN_FILE")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| {
                // Default next to the database so it lands on the persistent volume.
                let database =
                    std::env::var("GUNBRAWL_DB").unwrap_or_else(|_| "gunbrawl.db".to_owned());
                std::path::PathBuf::from(database).with_file_name("admin-credentials.txt")
            });
        Self {
            web_dir: web_dir.into(),
            lobby: Arc::new(Lobby::new(
                content.clone(),
                metrics.clone(),
                persist.clone(),
                directory.clone(),
            )),
            content,
            metrics,
            persist,
            sessions: Arc::new(Mutex::new(HashMap::new())),
            settings: Arc::new(RwLock::new(GameSettings::default())),
            admin: Arc::new(AdminState::new(credentials_path)),
            directory,
        }
    }

    pub fn content_hash(&self) -> u64 {
        self.content.hash
    }

    /// Shared handle used by the HTTP API and by tests that seed the database.
    pub fn persist(&self) -> Arc<Persist> {
        self.persist.clone()
    }

    pub fn settings(&self) -> GameSettings {
        self.settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn admin_state(&self) -> Arc<AdminState> {
        self.admin.clone()
    }

    pub fn content(&self) -> Arc<Content> {
        self.content.clone()
    }
}

/// Open the match database (or keep running without it) and start the writer.
pub async fn init_persistence(state: &AppState) -> bool {
    let path = std::env::var("GUNBRAWL_DB").unwrap_or_else(|_| "gunbrawl.db".to_owned());
    if !crate::persist::init(state.persist.clone(), &path).await {
        return false;
    }
    // Settings live in the same database; load them once and keep them in memory so room
    // creation never waits on SQLite.
    let loaded = settings::load(state.persist.pool().as_ref()).await;
    if let Ok(mut current) = state.settings.write() {
        *current = loaded;
    }
    admin::ensure_admin(state.persist.pool().as_ref(), &state.admin).await;
    true
}

pub fn router(state: AppState) -> Router {
    let index = format!("{}/index.html", state.web_dir.trim_end_matches('/'));
    let files = ServeDir::new(state.web_dir.clone()).not_found_service(ServeFile::new(index));

    let admin = Router::new()
        .route("/", get(admin::dashboard))
        .route("/login", get(admin::login_page).post(admin::login_submit))
        .route("/logout", post(admin::logout))
        .route("/config", post(admin::save_config))
        .route("/rooms", get(admin::rooms_page))
        .route("/rooms/close", post(admin::close_room))
        .route("/weapons", get(admin::weapons_page));

    Router::new()
        .route("/healthz", get(healthz))
        .route("/metrics", get(metrics_handler))
        .route("/api/matches", get(matches_handler))
        .route("/api/stats", get(stats_handler))
        .route("/ws", get(session::ws_handler))
        .nest("/admin", admin)
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
    let pool = state.persist.pool().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "persistence disabled".to_string(),
    ))?;
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
    let pool = state.persist.pool().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        "persistence disabled".to_string(),
    ))?;
    persist::stats(&pool)
        .await
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
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

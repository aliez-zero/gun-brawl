//! Match persistence: SQLite via `sqlx`, written off the tick thread.
//!
//! Persistence is optional: if the database cannot be opened the server keeps
//! running and only logs a warning.

use std::str::FromStr;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use tokio::sync::mpsc;
use tracing::{info, warn};

#[derive(Debug, Clone)]
pub struct PlayerRecord {
    pub slot: usize,
    pub player_id: Option<u32>,
    pub name: String,
    pub bot: bool,
    pub stocks: i32,
    pub kos: u32,
    pub falls: u32,
}

#[derive(Debug, Clone)]
pub struct MatchRecord {
    pub id: String,
    pub code: String,
    pub map: String,
    pub mode: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub winner: Option<u32>,
    pub players: Vec<PlayerRecord>,
}

#[derive(Default)]
pub struct Persist {
    sender: Mutex<Option<mpsc::Sender<MatchRecord>>>,
    /// Read handle for the HTTP API; the writer task owns the write side.
    pool: Mutex<Option<SqlitePool>>,
}

impl Persist {
    pub fn sender(&self) -> Option<mpsc::Sender<MatchRecord>> {
        self.sender.lock().ok().and_then(|sender| sender.clone())
    }

    pub fn pool(&self) -> Option<SqlitePool> {
        self.pool.lock().ok().and_then(|pool| pool.clone())
    }
}

/// One row of `/api/matches`, already shaped for the client.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchSummary {
    pub id: String,
    pub code: String,
    pub map: String,
    pub mode: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub winner: Option<u32>,
    pub players: Vec<MatchPlayerSummary>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchPlayerSummary {
    pub slot: u8,
    pub name: String,
    pub bot: bool,
    pub stocks: i32,
    pub kos: u32,
    pub falls: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistStats {
    pub matches: i64,
    pub players: i64,
    pub last_ended_at: Option<i64>,
}

/// Latest matches with their score table, newest first.
pub async fn recent_matches(pool: &SqlitePool, limit: i64) -> Result<Vec<MatchSummary>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT m.id, m.code, m.map, m.mode, m.started_at, m.ended_at, m.winner,
                p.slot, p.name, p.bot, p.stocks, p.kos, p.falls
         FROM matches m
         JOIN match_players p ON p.match_id = m.id
         WHERE m.id IN (SELECT id FROM matches ORDER BY ended_at DESC LIMIT ?)
         ORDER BY m.ended_at DESC, p.slot ASC",
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let mut matches: Vec<MatchSummary> = Vec::new();
    for row in rows {
        let id: String = row.try_get("id")?;
        if matches.last().map(|last| last.id != id).unwrap_or(true) {
            matches.push(MatchSummary {
                id: id.clone(),
                code: row.try_get("code")?,
                map: row.try_get("map")?,
                mode: row.try_get("mode")?,
                started_at: row.try_get("started_at")?,
                ended_at: row.try_get("ended_at")?,
                winner: row.try_get::<Option<i64>, _>("winner")?.map(|v| v as u32),
                players: Vec::new(),
            });
        }
        if let Some(matched) = matches.last_mut() {
            let slot: i64 = row.try_get("slot")?;
            matched.players.push(MatchPlayerSummary {
                slot: slot as u8,
                name: row.try_get("name")?,
                bot: row.try_get::<i64, _>("bot")? != 0,
                stocks: row.try_get("stocks")?,
                kos: row.try_get::<i64, _>("kos")? as u32,
                falls: row.try_get::<i64, _>("falls")? as u32,
            });
        }
    }
    Ok(matches)
}

/// Totals for a small "how much has this server seen" panel.
pub async fn stats(pool: &SqlitePool) -> Result<PersistStats, sqlx::Error> {
    let matches: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM matches").fetch_one(pool).await?;
    let players: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM match_players").fetch_one(pool).await?;
    let last: (Option<i64>,) = sqlx::query_as("SELECT MAX(ended_at) FROM matches")
        .fetch_one(pool)
        .await?;
    Ok(PersistStats {
        matches: matches.0,
        players: players.0,
        last_ended_at: last.0,
    })
}

const SCHEMA: [&str; 3] = [
    "CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        map TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        winner INTEGER
    )",
    "CREATE TABLE IF NOT EXISTS match_players (
        match_id TEXT NOT NULL,
        slot INTEGER NOT NULL,
        player_id INTEGER,
        name TEXT NOT NULL,
        bot INTEGER NOT NULL,
        stocks INTEGER NOT NULL,
        kos INTEGER NOT NULL,
        falls INTEGER NOT NULL,
        PRIMARY KEY (match_id, slot)
    )",
    "CREATE INDEX IF NOT EXISTS idx_matches_code ON matches(code)",
];

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

impl MatchRecord {
    pub fn now() -> i64 {
        now_ms()
    }
}

/// Open (or create) the database and start the writer task.
pub async fn init(persist: std::sync::Arc<Persist>, path: &str) -> bool {
    let options = match SqliteConnectOptions::from_str(path) {
        Ok(options) => options.create_if_missing(true),
        Err(error) => {
            warn!(%error, path, "invalid sqlite path; persistence disabled");
            return false;
        }
    };
    let pool = match SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
    {
        Ok(pool) => pool,
        Err(error) => {
            warn!(%error, path, "sqlite unavailable; persistence disabled");
            return false;
        }
    };
    for statement in SCHEMA {
        if let Err(error) = sqlx::query(statement).execute(&pool).await {
            warn!(%error, "schema creation failed; persistence disabled");
            return false;
        }
    }
    let (sender, receiver) = mpsc::channel::<MatchRecord>(64);
    tokio::spawn(writer(receiver, pool.clone()));
    if let Ok(mut slot) = persist.sender.lock() {
        *slot = Some(sender);
    }
    if let Ok(mut slot) = persist.pool.lock() {
        *slot = Some(pool);
    }
    info!(path, "match persistence ready");
    true
}

async fn writer(mut receiver: mpsc::Receiver<MatchRecord>, pool: SqlitePool) {
    while let Some(record) = receiver.recv().await {
        if let Err(error) = insert(&pool, &record).await {
            warn!(%error, match_id = %record.id, "failed to persist match");
        }
    }
}

async fn insert(pool: &SqlitePool, record: &MatchRecord) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR REPLACE INTO matches (id, code, map, mode, started_at, ended_at, winner)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&record.id)
    .bind(&record.code)
    .bind(&record.map)
    .bind(&record.mode)
    .bind(record.started_at)
    .bind(record.ended_at)
    .bind(record.winner.map(i64::from))
    .execute(pool)
    .await?;

    for player in &record.players {
        sqlx::query(
            "INSERT OR REPLACE INTO match_players
             (match_id, slot, player_id, name, bot, stocks, kos, falls)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&record.id)
        .bind(player.slot as i64)
        .bind(player.player_id.map(i64::from))
        .bind(&player.name)
        .bind(i64::from(player.bot))
        .bind(player.stocks)
        .bind(player.kos)
        .bind(player.falls)
        .execute(pool)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn records_a_match() {
        let path = std::env::temp_dir().join(format!("gunbrawl-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));
        let uri = path.to_string_lossy().to_string();
        let persist = std::sync::Arc::new(Persist::default());
        assert!(init(persist.clone(), &uri).await);
        let sender = persist.sender().expect("sender");
        sender
            .send(MatchRecord {
                id: "m1".into(),
                code: "ABC234".into(),
                map: "sky-citadel".into(),
                mode: "custom".into(),
                started_at: 1,
                ended_at: 2,
                winner: Some(0),
                players: vec![PlayerRecord {
                    slot: 0,
                    player_id: Some(7),
                    name: "Host".into(),
                    bot: false,
                    stocks: 2,
                    kos: 3,
                    falls: 1,
                }],
            })
            .await
            .expect("send");
        drop(sender);
        // Give the writer a moment to flush.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let options = SqliteConnectOptions::from_str(&uri).expect("options");
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("open");
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM match_players")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(count.0, 1);
        pool.close().await;
        let _ = std::fs::remove_file(&path);
    }
}

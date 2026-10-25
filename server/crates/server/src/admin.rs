//! Admin console: password login, game settings, room list and a weapon reference.
//!
//! Everything is server-rendered HTML so the console works even if the game bundle is
//! broken, and so it never ships in the player bundle.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{Form, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use gunbrawl_proto::{SLOT_BOT, SLOT_EMPTY};
use rand_core::OsRng;
use serde::Deserialize;
use sqlx::SqlitePool;
use tracing::{info, warn};

use crate::settings::{self, GameSettings};
use crate::AppState;

const SESSION_COOKIE: &str = "gb_admin";
const SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const MAX_FAILURES: u32 = 8;
const FAILURE_WINDOW: Duration = Duration::from_secs(5 * 60);

struct Session {
    username: String,
    expires: Instant,
}

#[derive(Default)]
struct Attempts {
    failures: u32,
    reset_at: Option<Instant>,
}

pub struct AdminState {
    sessions: Mutex<HashMap<String, Session>>,
    attempts: Mutex<Attempts>,
    tokens_issued: AtomicU64,
    /// Where the bootstrap credentials were written (kept for the console footer).
    pub credentials_path: std::path::PathBuf,
}

impl Default for AdminState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            attempts: Mutex::new(Attempts::default()),
            tokens_issued: AtomicU64::new(0),
            credentials_path: std::path::PathBuf::from("admin-credentials.txt"),
        }
    }
}

impl AdminState {
    pub fn new(credentials_path: std::path::PathBuf) -> Self {
        Self {
            credentials_path,
            ..Self::default()
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn hash_password(password: &str) -> Option<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .ok()
        .map(|hash| hash.to_string())
}

fn verify_password(hash: &str, password: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

fn random_password(length: usize) -> String {
    // Crockford-ish alphabet: no 0/O/1/l/I so the password survives being read aloud.
    const ALPHABET: &[u8] = b"abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 32];
    for chunk in bytes.chunks_mut(8) {
        let value = rand_u64();
        for (index, slot) in chunk.iter_mut().enumerate() {
            *slot = (value >> (index * 6)) as u8;
        }
    }
    bytes
        .iter()
        .take(length.max(8))
        .map(|byte| ALPHABET[(*byte as usize) % ALPHABET.len()] as char)
        .collect()
}

fn rand_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    // RandomState is seeded from OS entropy; hashing the clock adds per-call variation.
    let state = std::collections::hash_map::RandomState::new();
    let mut hasher = state.build_hasher();
    hasher.write_i64(now_ms());
    hasher.write_u64(std::process::id() as u64);
    hasher.finish()
}

fn random_token() -> String {
    format!("{:016x}{:016x}", rand_u64(), rand_u64())
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .filter_map(|part| part.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.to_string())
}

fn session_user(state: &AdminState, headers: &HeaderMap) -> Option<String> {
    let token = cookie_value(headers, SESSION_COOKIE)?;
    let mut sessions = state.sessions.lock().ok()?;
    let session = sessions.get(&token)?;
    if session.expires < Instant::now() {
        sessions.remove(&token);
        return None;
    }
    Some(session.username.clone())
}

/// Create the bootstrap admin account the first time the server starts with a database.
pub async fn ensure_admin(pool: Option<&SqlitePool>, state: &AdminState) {
    let Some(pool) = pool else {
        warn!("no database; the admin console is disabled");
        return;
    };
    if let Err(error) = sqlx::query(
        "CREATE TABLE IF NOT EXISTS admins (
            username TEXT PRIMARY KEY,
            password_hash TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await
    {
        warn!(%error, "could not create the admins table");
        return;
    }
    let existing: Option<(String,)> = sqlx::query_as("SELECT username FROM admins LIMIT 1")
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    if existing.is_some() {
        return;
    }

    let username = std::env::var("GUNBRAWL_ADMIN_USER").unwrap_or_else(|_| "admin".to_string());
    let password = std::env::var("GUNBRAWL_ADMIN_PASSWORD")
        .ok()
        .filter(|value| value.len() >= 8)
        .unwrap_or_else(|| random_password(16));
    let Some(hash) = hash_password(&password) else {
        warn!("could not hash the admin password; console login disabled");
        return;
    };
    if let Err(error) = sqlx::query(
        "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
    )
    .bind(&username)
    .bind(&hash)
    .bind(now_ms())
    .execute(pool)
    .await
    {
        warn!(%error, "could not create the admin account");
        return;
    }

    let content = format!(
        "# gun-brawl admin credentials\n\
         # generated: {}\n\
         # change with GUNBRAWL_ADMIN_PASSWORD (only used when no admin exists yet)\n\
         username: {username}\n\
         password: {password}\n",
        now_ms()
    );
    if let Some(parent) = state.credentials_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::write(&state.credentials_path, content) {
        Ok(()) => {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(
                    &state.credentials_path,
                    std::fs::Permissions::from_mode(0o600),
                );
            }
            info!(path = %state.credentials_path.display(), "admin account created, credentials written");
        }
        Err(error) => warn!(%error, path = %state.credentials_path.display(), "could not write admin credentials"),
    }
}

// ---------------------------------------------------------------- pages

fn esc(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn shell(title: &str, user: Option<&str>, body: &str) -> String {
    let nav = match user {
        None => String::new(),
        Some(name) => format!(
            r#"<nav>
      <a href="/admin">游戏配置</a>
      <a href="/admin/rooms">房间</a>
      <a href="/admin/weapons">武器</a>
      <span class="spacer"></span>
      <span class="who">{}</span>
      <form method="post" action="/admin/logout" class="inline"><button class="ghost">退出</button></form>
    </nav>"#,
            esc(name)
        ),
    };
    format!(
        r#"<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · 混枪大乱战 后台</title>
<style>
  :root {{ color-scheme: dark; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #0b100d; color: #e6eee2;
         font: 14px/1.6 ui-sans-serif, "Microsoft YaHei", system-ui, sans-serif; }}
  header {{ display: flex; align-items: center; gap: 16px; padding: 14px 24px;
            border-bottom: 1px solid #223026; background: #0f1712; }}
  header b {{ color: #d8ff6b; letter-spacing: .18em; font-size: 13px; }}
  nav {{ display: flex; align-items: center; gap: 18px; padding: 10px 24px;
         border-bottom: 1px solid #1b2620; background: #0c120e; font-size: 13px; }}
  nav a {{ color: #9fb3a4; text-decoration: none; }}
  nav a:hover {{ color: #d8ff6b; }}
  nav .spacer {{ flex: 1; }}
  nav .who {{ color: #6f8a78; font-family: ui-monospace, Consolas, monospace; }}
  main {{ max-width: 1040px; margin: 0 auto; padding: 26px 24px 60px; }}
  h1 {{ font-size: 20px; margin: 0 0 18px; }}
  h2 {{ font-size: 15px; color: #d8ff6b; margin: 26px 0 10px; letter-spacing: .08em; }}
  .card {{ background: #111a14; border: 1px solid #223026; border-radius: 10px; padding: 18px 20px; }}
  label {{ display: block; margin: 12px 0 4px; color: #8fa694; font-size: 12px;
           letter-spacing: .08em; text-transform: uppercase; }}
  input, select {{ width: 100%; padding: 9px 11px; border-radius: 6px; font: inherit;
                   background: #0a120d; color: #eaf1e6; border: 1px solid #2b3b31; }}
  .row {{ display: flex; gap: 14px; flex-wrap: wrap; }}
  .row > div {{ flex: 1 1 180px; }}
  button {{ margin-top: 16px; padding: 9px 18px; border-radius: 6px; cursor: pointer;
            background: #d8ff6b; color: #0b100d; border: 0; font-weight: 700; letter-spacing: .06em; }}
  button.ghost {{ background: transparent; color: #9fb3a4; border: 1px solid #2b3b31; margin: 0; padding: 5px 12px; font-weight: 400; }}
  button.danger {{ background: #3a1414; color: #ff9d9d; border: 1px solid #5c2020; margin: 0; padding: 4px 10px; font-weight: 400; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }}
  th, td {{ text-align: left; padding: 8px 10px; border-bottom: 1px solid #1b2620; }}
  th {{ color: #7d947f; font-weight: 500; font-size: 12px; letter-spacing: .06em; }}
  code, .mono {{ font-family: ui-monospace, Consolas, monospace; }}
  .ok {{ color: #d8ff6b; }} .err {{ color: #ff9d9d; }}
  .hint {{ color: #6f8a78; font-size: 12px; margin-top: 6px; }}
  .inline {{ display: inline; }}
  form.inline button {{ margin: 0; }}
</style></head>
<body>
<header><b>混枪大乱战 · 后台</b></header>
{nav}
<main>
{body}
</main>
</body></html>"#,
        title = esc(title),
        nav = nav,
        body = body,
    )
}

#[derive(Deserialize)]
pub struct LoginForm {
    username: String,
    password: String,
}

pub async fn login_page() -> Html<String> {
    Html(shell(
        "登录",
        None,
        r#"<h1>管理员登录</h1>
<div class="card" style="max-width:420px">
  <form method="post" action="/admin/login">
    <label for="u">用户名</label>
    <input id="u" name="username" autocomplete="username" autofocus>
    <label for="p">密码</label>
    <input id="p" name="password" type="password" autocomplete="current-password">
    <button>登录</button>
  </form>
  <p class="hint">初始账号密码见服务器 <span class="mono">admin-credentials.txt</span></p>
</div>"#,
    ))
}

fn login_failed(message: &str, status: StatusCode) -> Response {
    let body = format!(
        r#"<h1>管理员登录</h1>
<div class="card" style="max-width:420px">
  <p class="err">{}</p>
  <form method="post" action="/admin/login">
    <label for="u">用户名</label>
    <input id="u" name="username" autocomplete="username" autofocus>
    <label for="p">密码</label>
    <input id="p" name="password" type="password" autocomplete="current-password">
    <button>登录</button>
  </form>
</div>"#,
        esc(message)
    );
    (status, Html(shell("登录", None, &body))).into_response()
}

pub async fn login_submit(
    State(state): State<AppState>,
    Form(form): Form<LoginForm>,
) -> Response {
    {
        let mut attempts = match state.admin.attempts.lock() {
            Ok(attempts) => attempts,
            Err(_) => return login_failed("内部错误", StatusCode::INTERNAL_SERVER_ERROR),
        };
        if let Some(reset_at) = attempts.reset_at {
            if reset_at < Instant::now() {
                attempts.failures = 0;
                attempts.reset_at = None;
            }
        }
        if attempts.failures >= MAX_FAILURES {
            return login_failed("尝试次数过多，请五分钟后再试", StatusCode::TOO_MANY_REQUESTS);
        }
    }

    let Some(pool) = state.persist.pool() else {
        return login_failed("服务端没有可用数据库，后台不可用", StatusCode::SERVICE_UNAVAILABLE);
    };
    let row: Option<(String,)> =
        sqlx::query_as("SELECT password_hash FROM admins WHERE username = ?")
            .bind(form.username.trim())
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
    let ok = row
        .map(|(hash,)| verify_password(&hash, &form.password))
        .unwrap_or(false);

    if !ok {
        if let Ok(mut attempts) = state.admin.attempts.lock() {
            attempts.failures += 1;
            attempts.reset_at = Some(Instant::now() + FAILURE_WINDOW);
        }
        warn!(username = %form.username, "admin login failed");
        return login_failed("用户名或密码错误", StatusCode::UNAUTHORIZED);
    }

    if let Ok(mut attempts) = state.admin.attempts.lock() {
        attempts.failures = 0;
        attempts.reset_at = None;
    }
    let token = random_token();
    state.admin.tokens_issued.fetch_add(1, Ordering::Relaxed);
    if let Ok(mut sessions) = state.admin.sessions.lock() {
        sessions.retain(|_, session| session.expires > Instant::now());
        sessions.insert(
            token.clone(),
            Session {
                username: form.username.trim().to_string(),
                expires: Instant::now() + SESSION_TTL,
            },
        );
    }
    let cookie = format!(
        "{SESSION_COOKIE}={token}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age={}",
        SESSION_TTL.as_secs()
    );
    (
        StatusCode::SEE_OTHER,
        [(header::SET_COOKIE, cookie), (header::LOCATION, "/admin".to_string())],
    )
        .into_response()
}

pub async fn logout(State(state): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(token) = cookie_value(&headers, SESSION_COOKIE) {
        if let Ok(mut sessions) = state.admin.sessions.lock() {
            sessions.remove(&token);
        }
    }
    (
        StatusCode::SEE_OTHER,
        [
            (
                header::SET_COOKIE,
                format!("{SESSION_COOKIE}=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0"),
            ),
            (header::LOCATION, "/admin/login".to_string()),
        ],
    )
        .into_response()
}

/// `Response` is a large type, but every admin handler needs to return one on rejection.
#[allow(clippy::result_large_err)]
fn require_user(state: &AppState, headers: &HeaderMap) -> Result<String, Response> {
    session_user(&state.admin, headers)
        .ok_or_else(|| (StatusCode::SEE_OTHER, [(header::LOCATION, "/admin/login")]).into_response())
}

pub async fn dashboard(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = match require_user(&state, &headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let settings = state
        .settings
        .read()
        .map(|settings| settings.clone())
        .unwrap_or_default();
    let rooms = state.directory.list();

    let maps = state
        .content
        .maps
        .iter()
        .map(|map| {
            let selected = if settings.map_override == map.id { " selected" } else { "" };
            format!(
                r#"<option value="{}"{}>{}</option>"#,
                esc(&map.id),
                selected,
                esc(&map.name)
            )
        })
        .collect::<String>();

    let drop_options = [
        (-1i16, "保持房间设置"),
        (0, "全部武器"),
        (1, "标准掉落"),
        (2, "不掉落"),
    ]
    .iter()
    .map(|(value, label)| {
        let selected = if settings.drop_mode_override == *value { " selected" } else { "" };
        format!(r#"<option value="{value}"{selected}>{label}</option>"#)
    })
    .collect::<String>();

    let difficulty_options = [("0", "简单"), ("1", "普通"), ("2", "困难")]
        .iter()
        .map(|(value, label)| {
            let selected = if settings.bot_difficulty.to_string() == *value { " selected" } else { "" };
            format!(r#"<option value="{value}"{selected}>{label}</option>"#)
        })
        .collect::<String>();

    let body = format!(
        r#"<h1>游戏配置</h1>
<p class="hint">这里的值会立即作用于<strong>新创建的房间</strong>；填 0 / 留空表示不覆盖房间里的选择。</p>

<div class="card">
<form method="post" action="/admin/config">
  <div class="row">
    <div>
      <label for="stocks">生命数覆盖（0 = 不覆盖）</label>
      <input id="stocks" name="stocks_override" type="number" min="0" max="9" value="{stocks}">
    </div>
    <div>
      <label for="duration">时长覆盖，秒（0 = 不覆盖）</label>
      <input id="duration" name="duration_override" type="number" min="0" max="900" value="{duration}">
    </div>
    <div>
      <label for="knockback">击退倍率（0.3 – 3.0）</label>
      <input id="knockback" name="knockback_scale" type="number" step="0.05" min="0.3" max="3" value="{knockback}">
    </div>
  </div>
  <div class="row">
    <div>
      <label for="map">强制地图（保持 = 不覆盖）</label>
      <select id="map" name="map_override">
        <option value=""{map_none}>保持房间设置</option>
        {maps}
      </select>
    </div>
    <div>
      <label for="drop">掉落模式</label>
      <select id="drop" name="drop_mode_override">{drop_options}</select>
    </div>
    <div>
      <label for="difficulty">补位 AI 难度</label>
      <select id="difficulty" name="bot_difficulty">{difficulty_options}</select>
    </div>
  </div>
  <label style="display:flex;gap:8px;align-items:center;margin-top:16px;text-transform:none;letter-spacing:0">
    <input type="checkbox" name="bot_fill" value="1" style="width:auto"{bot_fill}>
    开局时用 AI 填满空位
  </label>
  <button>保存配置</button>
</form>
</div>

<h2>当前状态</h2>
<div class="card">
  <table>
    <tr><th>房间数</th><td>{room_count}</td></tr>
    <tr><th>击退倍率</th><td>{knockback}×（作用于新开对局的所有武器）</td></tr>
    <tr><th>凭据文件</th><td class="mono">{credentials}</td></tr>
  </table>
  <p class="hint">首次启动时生成的管理员账号密码写在该文件里，权限 600。</p>
</div>"#,
        stocks = settings.stocks_override,
        duration = settings.duration_override,
        knockback = format!("{:.2}", settings.knockback_scale),
        maps = maps,
        map_none = if settings.map_override.is_empty() { " selected" } else { "" },
        drop_options = drop_options,
        difficulty_options = difficulty_options,
        bot_fill = if settings.bot_fill { " checked" } else { "" },
        room_count = rooms.len(),
        credentials = esc(&state.admin.credentials_path.display().to_string()),
    );

    let notice = "";
    Html(shell("游戏配置", Some(&user), &body.replace("{notice}", notice))).into_response()
}

#[derive(Deserialize)]
pub struct ConfigForm {
    stocks_override: u8,
    duration_override: u16,
    knockback_scale: f32,
    #[serde(default)]
    map_override: String,
    drop_mode_override: i16,
    bot_difficulty: u8,
    #[serde(default)]
    bot_fill: Option<String>,
}

pub async fn save_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(form): Form<ConfigForm>,
) -> Response {
    if require_user(&state, &headers).is_err() {
        return (StatusCode::SEE_OTHER, [(header::LOCATION, "/admin/login")]).into_response();
    }
    let settings = GameSettings {
        stocks_override: form.stocks_override,
        duration_override: form.duration_override,
        map_override: form.map_override,
        drop_mode_override: form.drop_mode_override,
        bot_fill: form.bot_fill.is_some(),
        bot_difficulty: form.bot_difficulty,
        knockback_scale: form.knockback_scale,
    }
    .sanitize();

    let pool = state.persist.pool();
    let persisted = settings::save(pool.as_ref(), &settings).await;
    if let Ok(mut current) = state.settings.write() {
        *current = settings.clone();
    }
    match persisted {
        Ok(()) => info!("game settings updated from the admin console"),
        Err(error) => warn!(%error, "game settings kept in memory only"),
    }
    (StatusCode::SEE_OTHER, [(header::LOCATION, "/admin")]).into_response()
}

pub async fn rooms_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = match require_user(&state, &headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let mut rooms = state.directory.list();
    rooms.sort_by(|left, right| left.code.cmp(&right.code));

    let rows = if rooms.is_empty() {
        r#"<tr><td colspan="5" class="hint">当前没有房间</td></tr>"#.to_string()
    } else {
        rooms
            .iter()
            .map(|room| {
                let slots = room
                    .slots
                    .iter()
                    .filter(|slot| slot.kind != SLOT_EMPTY)
                    .map(|slot| {
                        let kind = match slot.kind {
                            SLOT_BOT => "AI",
                            _ => "玩家",
                        };
                        format!("{}（{kind}）", esc(&slot.name))
                    })
                    .collect::<Vec<_>>()
                    .join("、");
                let phase = match room.phase {
                    0 => "等待",
                    1 => "倒计时",
                    2 => "对局中",
                    _ => "结算",
                };
                format!(
                    r#"<tr>
  <td class="mono">{code}</td>
  <td>{map}</td>
  <td>{phase}</td>
  <td>{stocks} 命 · {duration} 秒</td>
  <td>{slots}</td>
  <td>
    <form method="post" action="/admin/rooms/close" class="inline">
      <input type="hidden" name="code" value="{code}">
      <button class="danger">关闭</button>
    </form>
  </td>
</tr>"#,
                    code = esc(&room.code),
                    map = esc(&room.map),
                    phase = phase,
                    stocks = room.stocks,
                    duration = room.duration,
                    slots = if slots.is_empty() { "—".to_string() } else { slots },
                )
            })
            .collect::<String>()
    };

    let body = format!(
        r#"<h1>房间</h1>
<p class="hint">列出仍在运行中的房间；关闭会立即结束该房间并从注册表移除。</p>
<div class="card">
<table>
  <tr><th>房间码</th><th>地图</th><th>阶段</th><th>规则</th><th>槽位</th><th></th></tr>
  {rows}
</table>
</div>"#
    );
    Html(shell("房间", Some(&user), &body)).into_response()
}

#[derive(Deserialize)]
pub struct CloseRoomForm {
    code: String,
}

pub async fn close_room(
    State(state): State<AppState>,
    headers: HeaderMap,
    Form(form): Form<CloseRoomForm>,
) -> Response {
    if require_user(&state, &headers).is_err() {
        return (StatusCode::SEE_OTHER, [(header::LOCATION, "/admin/login")]).into_response();
    }
    let code = form.code.trim().to_uppercase();
    state.lobby.close(&code);
    state.directory.remove(&code);
    info!(room = %code, "room closed from the admin console");
    (StatusCode::SEE_OTHER, [(header::LOCATION, "/admin/rooms")]).into_response()
}

pub async fn weapons_page(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let user = match require_user(&state, &headers) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let scale = state
        .settings
        .read()
        .map(|settings| settings.knockback_scale)
        .unwrap_or(1.0);

    let rows = state
        .content
        .weapons
        .iter()
        .map(|weapon| {
            let magazine = weapon
                .max_ammo
                .map(|ammo| ammo.to_string())
                .unwrap_or_else(|| "∞".to_string());
            format!(
                r#"<tr>
  <td class="mono">{id}</td>
  <td>{name}</td>
  <td class="mono">{tier:?}</td>
  <td class="mono">{interval:.2} s</td>
  <td class="mono">{knockback:.0} → <span class="ok">{effective:.0}</span></td>
  <td class="mono">{range:.0}</td>
  <td class="mono">{pellets}</td>
  <td class="mono">{magazine}</td>
</tr>"#,
                id = esc(&weapon.id),
                name = esc(&weapon.name),
                tier = weapon.tier,
                interval = weapon.interval,
                knockback = weapon.knockback,
                effective = weapon.knockback * f64::from(scale),
                range = weapon.range,
                pellets = weapon.pellets,
                magazine = magazine,
            )
        })
        .collect::<String>();

    let body = format!(
        r#"<h1>武器</h1>
<p class="hint">数据来自编译进服务端的 content 包，共 {count} 把。第三列是当前击退倍率 {scale:.2}× 生效后的数值。</p>
<div class="card">
<table>
  <tr><th>ID</th><th>名称</th><th>档次</th><th>射速</th><th>击退（当前）</th><th>射程</th><th>弹丸</th><th>弹匣</th></tr>
  {rows}
</table>
</div>"#,
        count = state.content.weapons.len(),
        scale = scale,
    );
    Html(shell("武器", Some(&user), &body)).into_response()
}



//! Admin console: login gate, session cookie, settings persistence.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use gunbrawl_server::{admin, persist, router, AppState};
use http_body_util::BodyExt;
use tower::ServiceExt;

const PASSWORD: &str = "test-password-123";

async fn body_text(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    String::from_utf8(bytes.to_vec()).expect("utf8")
}

fn form(path: &str, body: &str, cookie: Option<&str>) -> Request<Body> {
    let builder = Request::builder()
        .method("POST")
        .uri(path)
        .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded");
    let builder = match cookie {
        Some(value) => builder.header(header::COOKIE, value),
        None => builder,
    };
    builder.body(Body::from(body.to_string())).expect("request")
}

fn get(path: &str, cookie: Option<&str>) -> Request<Body> {
    let builder = Request::builder().uri(path);
    let builder = match cookie {
        Some(value) => builder.header(header::COOKIE, value),
        None => builder,
    };
    builder.body(Body::empty()).expect("request")
}

async fn seeded_state() -> AppState {
    let dir = std::env::temp_dir().join(format!("gb-admin-{}-{}", std::process::id(), line!()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    let credentials = dir.join("admin-credentials.txt");
    std::env::set_var("GUNBRAWL_ADMIN_FILE", &credentials);
    std::env::set_var("GUNBRAWL_ADMIN_PASSWORD", PASSWORD);

    let state = AppState::new("web/dist");
    assert!(persist::init(state.persist(), ":memory:").await);
    admin::ensure_admin(state.persist().pool().as_ref(), &state.admin_state()).await;
    assert!(credentials.exists(), "bootstrap credentials should be written");
    state
}

#[tokio::test]
async fn the_console_is_closed_without_a_session() {
    let state = seeded_state().await;
    let app = router(state);

    for path in ["/admin", "/admin/rooms", "/admin/weapons"] {
        let response = app
            .clone()
            .oneshot(get(path, None))
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SEE_OTHER, "{path}");
        assert_eq!(
            response.headers().get(header::LOCATION).and_then(|v| v.to_str().ok()),
            Some("/admin/login"),
            "{path}",
        );
    }

    let login_page = app.oneshot(get("/admin/login", None)).await.expect("login page");
    assert_eq!(login_page.status(), StatusCode::OK);
    assert!(body_text(login_page).await.contains("管理员登录"));
}

#[tokio::test]
async fn a_wrong_password_is_rejected_and_the_right_one_returns_a_cookie() {
    let state = seeded_state().await;
    let app = router(state);

    let bad = app
        .clone()
        .oneshot(form("/admin/login", "username=admin&password=nope", None))
        .await
        .expect("bad login");
    assert_eq!(bad.status(), StatusCode::UNAUTHORIZED);

    let good = app
        .oneshot(form(
            "/admin/login",
            &format!("username=admin&password={PASSWORD}"),
            None,
        ))
        .await
        .expect("good login");
    assert_eq!(good.status(), StatusCode::SEE_OTHER);
    let cookie = good
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .expect("session cookie")
        .to_string();
    assert!(cookie.contains("HttpOnly"), "{cookie}");
    assert!(cookie.contains("SameSite=Strict"), "{cookie}");
}

#[tokio::test]
async fn settings_saved_in_the_console_are_persisted() {
    let state = seeded_state().await;
    let app = router(state.clone());

    let login = app
        .clone()
        .oneshot(form(
            "/admin/login",
            &format!("username=admin&password={PASSWORD}"),
            None,
        ))
        .await
        .expect("login");
    let cookie = login
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .expect("cookie pair")
        .to_string();

    let save = app
        .clone()
        .oneshot(form(
            "/admin/config",
            "stocks_override=5&duration_override=300&knockback_scale=1.5\
             &map_override=&drop_mode_override=-1&bot_difficulty=2&bot_fill=1",
            Some(&cookie),
        ))
        .await
        .expect("save");
    assert_eq!(save.status(), StatusCode::SEE_OTHER);
    assert_eq!(state.settings().stocks_override, 5, "memory updated");
    assert!((state.settings().knockback_scale - 1.5).abs() < f32::EPSILON);
    assert!(state.settings().bot_fill);
    assert_eq!(state.settings().bot_difficulty, 2);

    let reloaded = gunbrawl_server::settings::load(state.persist().pool().as_ref()).await;
    assert_eq!(reloaded.stocks_override, 5, "database updated");
    assert_eq!(reloaded.duration_override, 300);

    let page = app
        .oneshot(get("/admin", Some(&cookie)))
        .await
        .expect("dashboard");
    assert_eq!(page.status(), StatusCode::OK);
    let body = body_text(page).await;
    assert!(body.contains("游戏配置"), "dashboard should render");
    let stocks_input = body
        .split("name=\"stocks_override\"")
        .nth(1)
        .map(|tail| tail.chars().take(120).collect::<String>())
        .unwrap_or_default();
    assert!(
        body.contains(r#"value="5""#),
        "saved stocks value should show; input was: {stocks_input}",
    );
}

#[tokio::test]
async fn the_weapon_reference_lists_the_content_pack() {
    let state = seeded_state().await;
    let app = router(state.clone());
    let login = app
        .clone()
        .oneshot(form(
            "/admin/login",
            &format!("username=admin&password={PASSWORD}"),
            None,
        ))
        .await
        .expect("login");
    let cookie = login
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .expect("cookie pair")
        .to_string();

    let page = app
        .oneshot(get("/admin/weapons", Some(&cookie)))
        .await
        .expect("weapons page");
    assert_eq!(page.status(), StatusCode::OK);
    let body = body_text(page).await;
    assert!(body.contains(&format!("共 {} 把", state.content().weapons.len())), "count line");
    let first = &state.content().weapons[0];
    assert!(body.contains(&first.name), "should list {}", first.name);
}

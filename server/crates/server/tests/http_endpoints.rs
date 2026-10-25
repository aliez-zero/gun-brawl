//! HTTP endpoints that do not need a room.

use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use gunbrawl_server::persist::{MatchRecord, PlayerRecord};
use gunbrawl_server::{router, AppState};
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn body_text(response: axum::response::Response) -> String {
    let bytes = response.into_body().collect().await.expect("body").to_bytes();
    String::from_utf8(bytes.to_vec()).expect("utf8")
}

#[tokio::test]
async fn health_and_metrics_are_exposed() {
    let app = router(AppState::new("web/dist"));

    let health = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("health response");
    assert_eq!(health.status(), StatusCode::OK);

    let metrics = app
        .oneshot(
            Request::builder()
                .uri("/metrics")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("metrics response");
    assert_eq!(metrics.status(), StatusCode::OK);
    let body = metrics
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let text = String::from_utf8(body.to_vec()).expect("utf8");
    assert!(text.contains("gunbrawl_rooms_active 0"), "{text}");
    assert!(text.contains("gunbrawl_players_connected 0"), "{text}");
    assert!(text.contains("gunbrawl_simulation_ticks_total"), "{text}");
}

#[tokio::test]
async fn match_apis_are_unavailable_without_a_database() {
    let app = router(AppState::new("web/dist"));
    for uri in ["/api/matches", "/api/stats"] {
        let response = app
            .clone()
            .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE, "{uri}");
    }
}

#[tokio::test]
async fn matches_api_lists_persisted_games() {
    let state = AppState::new("web/dist");
    assert!(gunbrawl_server::persist::init(state.persist(), ":memory:").await);
    let sender = state.persist().sender().expect("sender");
    sender
        .send(MatchRecord {
            id: "m-abc".into(),
            code: "ABC234".into(),
            map: "sky-citadel".into(),
            mode: "custom".into(),
            started_at: 1_700_000_000_000,
            ended_at: 1_700_000_090_000,
            winner: Some(0),
            players: vec![
                PlayerRecord {
                    slot: 0,
                    player_id: Some(7),
                    name: "Host".into(),
                    bot: false,
                    stocks: 2,
                    kos: 3,
                    falls: 1,
                },
                PlayerRecord {
                    slot: 1,
                    player_id: None,
                    name: "AI 2".into(),
                    bot: true,
                    stocks: 0,
                    kos: 1,
                    falls: 3,
                },
            ],
        })
        .await
        .expect("send");

    let app = router(state);
    // The writer task commits asynchronously; poll instead of sleeping a fixed amount.
    for _ in 0..100 {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/matches?limit=5")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .expect("response");
        assert_eq!(response.status(), StatusCode::OK);
        let text = body_text(response).await;
        if text.contains("ABC234") {
            assert!(text.contains("\"players\""), "{text}");
            assert!(text.contains("\"kos\":3"), "{text}");
            assert!(text.contains("\"bot\":true"), "{text}");

            let stats = app
                .oneshot(
                    Request::builder()
                        .uri("/api/stats")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .expect("stats");
            let stats_text = body_text(stats).await;
            assert!(stats_text.contains("\"matches\":1"), "{stats_text}");
            assert!(stats_text.contains("\"players\":2"), "{stats_text}");
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("the persisted match never showed up in /api/matches");
}

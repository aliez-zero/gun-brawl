//! HTTP endpoints that do not need a room.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use gunbrawl_server::{router, AppState};
use http_body_util::BodyExt;
use tower::ServiceExt;

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

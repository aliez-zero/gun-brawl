use std::env;
use std::net::SocketAddr;
use std::time::Duration;

use gunbrawl_server::{serve, AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if env::args().any(|argument| argument == "--health") {
        return health_check();
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let web_dir = env::var("GUNBRAWL_WEB_DIR").unwrap_or_else(|_| "web/dist".to_owned());
    let addr: SocketAddr = env::var("GUNBRAWL_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_owned())
        .parse()?;

    serve(AppState::new(web_dir), addr).await?;
    Ok(())
}

/// Container health probe: connects to the listening socket, never binds it.
fn health_check() -> Result<(), Box<dyn std::error::Error>> {
    let addr: SocketAddr = env::var("GUNBRAWL_HEALTH_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_owned())
        .parse()?;
    std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(2))?;
    Ok(())
}

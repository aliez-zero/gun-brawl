//! Load generator: N rooms x M clients speaking the real protocol over WebSocket.
//!
//! It creates rooms the same way the browser does (hello → create → join → start), then
//! each client sends input at 60 Hz and reads snapshots for the requested duration. The
//! point is to answer "how many rooms does this box hold while still ticking at 60 Hz",
//! so the report includes the server-side tick rate before and after the run.
//!
//! ```text
//! cargo run --release -p gunbrawl-loadtest -- --rooms 50 --players 2 --seconds 20
//! ```

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use gunbrawl_content::Content;
use gunbrawl_proto::{decode, encode, C2S, S2C, PROTO_VERSION};
use tokio::time::interval;
use tokio_tungstenite::tungstenite::Message;

#[derive(Default)]
struct Stats {
    connections: AtomicU64,
    failures: AtomicU64,
    snapshots: AtomicU64,
    frames_sent: AtomicU64,
    gap_samples: AtomicU64,
    gap_sum_us: AtomicU64,
    gap_max_us: AtomicU64,
}

impl Stats {
    fn record_gap(&self, gap: Duration) {
        let us = gap.as_micros() as u64;
        self.gap_samples.fetch_add(1, Ordering::Relaxed);
        self.gap_sum_us.fetch_add(us, Ordering::Relaxed);
        self.gap_max_us.fetch_max(us, Ordering::Relaxed);
    }

    fn report(&self, rooms: usize, players: usize, elapsed: Duration, ticks_per_second: Option<f64>) {
        let seconds = elapsed.as_secs_f64();
        let connections = self.connections.load(Ordering::Relaxed);
        let failures = self.failures.load(Ordering::Relaxed);
        let snapshots = self.snapshots.load(Ordering::Relaxed);
        let frames = self.frames_sent.load(Ordering::Relaxed);
        let samples = self.gap_samples.load(Ordering::Relaxed).max(1);
        println!("\n=== load test ===");
        println!("rooms={rooms} players/room={players} wall={seconds:.1}s");
        println!("connections ok={connections} failed={failures}");
        if connections > 0 {
            println!(
                "snapshots/client/s   {:.1} (expected 30)",
                snapshots as f64 / connections as f64 / seconds
            );
            println!(
                "input frames/client/s {:.1} (expected 60)",
                frames as f64 / connections as f64 / seconds
            );
        }
        println!(
            "snapshot gap mean    {:.1} ms, max {} ms (n={samples})",
            self.gap_sum_us.load(Ordering::Relaxed) as f64 / samples as f64 / 1000.0,
            self.gap_max_us.load(Ordering::Relaxed) / 1000
        );
        if let Some(tps) = ticks_per_second {
            let verdict = if tps >= 57.0 { "healthy" } else { "DEGRADED" };
            println!("server tick rate     {tps:.1}/s (60 nominal) -> {verdict}");
        }
    }
}

struct Client {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
}

impl Client {
    async fn connect(url: &str, content_hash: u64, name: &str) -> Result<Self, String> {
        let (mut socket, _) = tokio_tungstenite::connect_async(url)
            .await
            .map_err(|error| format!("connect: {error}"))?;
        let hello = C2S::Hello {
            proto: PROTO_VERSION,
            content: content_hash,
            token: String::new(),
            build: "loadtest".to_string(),
        };
        Self::send_raw(&mut socket, &hello).await?;

        // First reply is always Welcome (or a kick).
        loop {
            let message = socket
                .next()
                .await
                .ok_or_else(|| "socket closed during hello".to_string())?
                .map_err(|error| format!("hello: {error}"))?;
            if let Message::Binary(payload) = message {
                match decode::<S2C>(&payload).map_err(|error| format!("hello decode: {error}"))? {
                    S2C::Welcome { .. } => break,
                    S2C::Kick { code, message } => return Err(format!("kicked {code}: {message}")),
                    _ => continue,
                }
            }
        }
        let _ = name;
        Ok(Self { socket })
    }

    async fn send_raw<W>(socket: &mut W, message: &C2S) -> Result<(), String>
    where
        W: SinkExt<Message> + Unpin,
        <W as futures_util::Sink<Message>>::Error: std::fmt::Display,
    {
        let payload = encode(message).map_err(|error| format!("encode: {error}"))?;
        socket
            .send(Message::Binary(payload.into()))
            .await
            .map_err(|error| format!("send: {error}"))
    }

    async fn send(&mut self, message: &C2S) -> Result<(), String> {
        let payload = encode(message).map_err(|error| format!("encode: {error}"))?;
        self.socket
            .send(Message::Binary(payload.into()))
            .await
            .map_err(|error| format!("send: {error}"))
    }

    /// Wait for the next room state and return its code.
    async fn await_room_code(&mut self, timeout: Duration) -> Result<String, String> {
        let deadline = Instant::now() + timeout;
        loop {
            let message = tokio::time::timeout_at(deadline.into(), self.socket.next())
                .await
                .map_err(|_| "timeout waiting for room".to_string())?
                .ok_or_else(|| "socket closed waiting for room".to_string())?
                .map_err(|error| format!("room: {error}"))?;
            if let Message::Binary(payload) = message {
                if let Ok(S2C::Room(view)) = decode::<S2C>(&payload) {
                    return Ok(view.code);
                }
            }
        }
    }

    /// Play for the given duration: 60 Hz inputs, count snapshots as they arrive.
    async fn play(mut self, stats: Arc<Stats>, duration: Duration) -> Result<(), String> {
        let mut ticker = interval(Duration::from_micros(16_667));
        let deadline = Instant::now() + duration;
        let mut seq: u32 = 0;
        let mut last_snapshot: Option<Instant> = None;

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    seq += 1;
                    // Alternate direction so the actor keeps moving across platforms.
                    let move_x: i8 = if (seq / 45).is_multiple_of(2) { 1 } else { -1 };
                    let frames = vec![gunbrawl_proto::InputFrame {
                        seq,
                        tick_hint: 0,
                        move_x,
                        held: 0,
                        edges: if seq.is_multiple_of(90) { 1 } else { 0 }, // occasional jump
                    }];
                    self.send(&C2S::Input { frames }).await?;
                    stats.frames_sent.fetch_add(1, Ordering::Relaxed);
                    if Instant::now() >= deadline {
                        break;
                    }
                }
                message = self.socket.next() => {
                    let Some(message) = message else { break };
                    let message = message.map_err(|error| format!("read: {error}"))?;
                    if let Message::Binary(payload) = message {
                        if matches!(decode::<S2C>(&payload), Ok(S2C::Snapshot(_))) {
                            stats.snapshots.fetch_add(1, Ordering::Relaxed);
                            let now = Instant::now();
                            if let Some(previous) = last_snapshot {
                                stats.record_gap(now - previous);
                            }
                            last_snapshot = Some(now);
                        }
                    }
                }
            }
        }
        Ok(())
    }
}

async fn spawn_room(
    url: String,
    content_hash: u64,
    index: usize,
    players: usize,
    duration: Duration,
    stats: Arc<Stats>,
) {
    let host_name = format!("L{index}-0");
    let mut host = match Client::connect(&url, content_hash, &host_name).await {
        Ok(client) => client,
        Err(error) => {
            stats.failures.fetch_add(1, Ordering::Relaxed);
            eprintln!("room {index}: host failed: {error}");
            return;
        }
    };
    stats.connections.fetch_add(1, Ordering::Relaxed);

    if let Err(error) = host
        .send(&C2S::CreateRoom {
            name: host_name,
            map: "sky-citadel".to_string(),
            stocks: 3,
            duration: 120,
            drop_mode: 0,
        })
        .await
    {
        stats.failures.fetch_add(1, Ordering::Relaxed);
        eprintln!("room {index}: create failed: {error}");
        return;
    }
    let code = match host.await_room_code(Duration::from_secs(10)).await {
        Ok(code) => code,
        Err(error) => {
            stats.failures.fetch_add(1, Ordering::Relaxed);
            eprintln!("room {index}: no room code: {error}");
            return;
        }
    };

    let mut guests = Vec::new();
    for slot in 1..players {
        let name = format!("L{index}-{slot}");
        match Client::connect(&url, content_hash, &name).await {
            Ok(mut guest) => {
                stats.connections.fetch_add(1, Ordering::Relaxed);
                if guest
                    .send(&C2S::JoinRoom { code: code.clone(), name })
                    .await
                    .is_ok()
                {
                    guests.push(guest);
                } else {
                    stats.failures.fetch_add(1, Ordering::Relaxed);
                }
            }
            Err(error) => {
                stats.failures.fetch_add(1, Ordering::Relaxed);
                eprintln!("room {index}: guest failed: {error}");
            }
        }
    }

    // Let the server register every join before kicking off.
    tokio::time::sleep(Duration::from_millis(120)).await;
    if let Err(error) = host.send(&C2S::Start).await {
        stats.failures.fetch_add(1, Ordering::Relaxed);
        eprintln!("room {index}: start failed: {error}");
        return;
    }

    let mut tasks = Vec::new();
    tasks.push(tokio::spawn(host.play(stats.clone(), duration)));
    for guest in guests {
        tasks.push(tokio::spawn(guest.play(stats.clone(), duration)));
    }
    for task in tasks {
        let _ = task.await;
    }
}

fn arg(args: &[String], name: &str, default: &str) -> String {
    args.iter()
        .position(|value| value == name)
        .and_then(|index| args.get(index + 1))
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

async fn fetch_ticks(metrics_url: &str) -> Option<u64> {
    let body = reqwest_get(metrics_url).await?;
    body.lines()
        .find_map(|line| line.strip_prefix("gunbrawl_simulation_ticks_total "))
        .and_then(|value| value.trim().parse().ok())
}

/// Tiny HTTP/1.1 GET so the load test does not need an HTTP client dependency.
async fn reqwest_get(url: &str) -> Option<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let rest = url.strip_prefix("http://")?;
    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };
    let mut stream = tokio::net::TcpStream::connect(authority).await.ok()?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.ok()?;
    let mut buffer = Vec::new();
    stream.read_to_end(&mut buffer).await.ok()?;
    let text = String::from_utf8_lossy(&buffer).to_string();
    let body = text.split("\r\n\r\n").nth(1)?.to_string();
    Some(body)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let url = arg(&args, "--url", "ws://127.0.0.1:8080/ws");
    let metrics_url = arg(&args, "--metrics", "http://127.0.0.1:8080/metrics");
    let rooms: usize = arg(&args, "--rooms", "10").parse().unwrap_or(10);
    let players: usize = arg(&args, "--players", "2").parse().unwrap_or(2);
    let seconds: f64 = arg(&args, "--seconds", "15").parse().unwrap_or(15.0);
    let duration = Duration::from_secs_f64(seconds);

    let content_hash = Content::parse().expect("content data").hash;
    let stats = Arc::new(Stats::default());

    let ticks_before = fetch_ticks(&metrics_url).await.unwrap_or(0);
    let started = Instant::now();
    println!(
        "starting: {rooms} rooms x {players} players for {seconds:.0}s against {url}",
    );

    let mut handles = Vec::new();
    for index in 0..rooms {
        handles.push(tokio::spawn(spawn_room(
            url.clone(),
            content_hash,
            index,
            players,
            duration,
            stats.clone(),
        )));
    }
    for handle in handles {
        let _ = handle.await;
    }
    let elapsed = started.elapsed();
    let ticks_after = fetch_ticks(&metrics_url).await.unwrap_or(ticks_before);
    let ticks_per_second = if elapsed.as_secs_f64() > 0.5 {
        Some((ticks_after.saturating_sub(ticks_before)) as f64 / elapsed.as_secs_f64())
    } else {
        None
    };

    stats.report(rooms, players, elapsed, ticks_per_second);
}

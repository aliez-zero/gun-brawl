//! Minimal Prometheus exposition without a metrics dependency.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Default)]
pub struct Metrics {
    pub players: AtomicU64,
    pub matches: AtomicU64,
    pub snapshots: AtomicU64,
    pub ticks: AtomicU64,
    pub rooms_created: AtomicU64,
}

impl Metrics {
    pub fn incr(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }

    pub fn decr(counter: &AtomicU64) {
        counter.fetch_sub(1, Ordering::Relaxed);
    }

    pub fn render(&self, rooms: usize) -> String {
        let players = self.players.load(Ordering::Relaxed);
        let matches = self.matches.load(Ordering::Relaxed);
        let snapshots = self.snapshots.load(Ordering::Relaxed);
        let ticks = self.ticks.load(Ordering::Relaxed);
        let created = self.rooms_created.load(Ordering::Relaxed);
        format!(
            "# HELP gunbrawl_rooms_active Rooms currently registered.\n\
             # TYPE gunbrawl_rooms_active gauge\n\
             gunbrawl_rooms_active {rooms}\n\
             # HELP gunbrawl_rooms_created_total Rooms created since start.\n\
             # TYPE gunbrawl_rooms_created_total counter\n\
             gunbrawl_rooms_created_total {created}\n\
             # HELP gunbrawl_players_connected WebSocket sessions that sent Hello.\n\
             # TYPE gunbrawl_players_connected gauge\n\
             gunbrawl_players_connected {players}\n\
             # HELP gunbrawl_matches_finished_total Finished matches.\n\
             # TYPE gunbrawl_matches_finished_total counter\n\
             gunbrawl_matches_finished_total {matches}\n\
             # HELP gunbrawl_snapshots_sent_total Snapshots encoded and broadcast.\n\
             # TYPE gunbrawl_snapshots_sent_total counter\n\
             gunbrawl_snapshots_sent_total {snapshots}\n\
             # HELP gunbrawl_simulation_ticks_total Authoritative ticks simulated.\n\
             # TYPE gunbrawl_simulation_ticks_total counter\n\
             gunbrawl_simulation_ticks_total {ticks}\n"
        )
    }
}

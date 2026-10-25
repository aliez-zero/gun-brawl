//! Room registry and codes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use gunbrawl_content::Content;
use gunbrawl_proto::RoomView;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::metrics::Metrics;
use crate::persist::Persist;
use crate::room::{run_room, Command, Player, Room, RoomConfig, RoomRules, ROOM_CODE_ALPHABET};

#[derive(Clone)]
pub struct RoomHandle {
    pub tx: mpsc::Sender<Command>,
}

/// Live room views for the admin console. Rooms publish on every state change, so the
/// console never has to reach into a running simulation.
#[derive(Default)]
pub struct RoomDirectory {
    rooms: Mutex<HashMap<String, RoomView>>,
}

impl RoomDirectory {
    pub fn upsert(&self, view: RoomView) {
        if let Ok(mut rooms) = self.rooms.lock() {
            rooms.insert(view.code.clone(), view);
        }
    }

    pub fn remove(&self, code: &str) {
        if let Ok(mut rooms) = self.rooms.lock() {
            rooms.remove(code);
        }
    }

    pub fn list(&self) -> Vec<RoomView> {
        self.rooms
            .lock()
            .map(|rooms| rooms.values().cloned().collect())
            .unwrap_or_default()
    }
}

pub struct Lobby {
    /// Shared with each room task so a self-reclaiming room can deregister itself.
    rooms: Arc<Mutex<HashMap<String, RoomHandle>>>,
    directory: Arc<RoomDirectory>,
    next_player: AtomicU32,
    code_counter: AtomicU32,
    content: Arc<Content>,
    metrics: Arc<Metrics>,
    persist: Arc<Persist>,
}

impl Lobby {
    pub fn new(
        content: Arc<Content>,
        metrics: Arc<Metrics>,
        persist: Arc<Persist>,
        directory: Arc<RoomDirectory>,
    ) -> Self {
        Self {
            rooms: Arc::new(Mutex::new(HashMap::new())),
            directory,
            next_player: AtomicU32::new(1),
            code_counter: AtomicU32::new(0),
            content,
            metrics,
            persist,
        }
    }

    pub fn count(&self) -> usize {
        self.rooms.lock().map(|rooms| rooms.len()).unwrap_or(0)
    }

    pub fn next_player_id(&self) -> u32 {
        self.next_player.fetch_add(1, Ordering::Relaxed)
    }

    pub fn create(&self, config: RoomConfig, rules: RoomRules) -> Option<String> {
        let mut rooms = self.rooms.lock().ok()?;
        for _ in 0..16 {
            let code = self.generate_code();
            if rooms.contains_key(&code) {
                continue;
            }
            let (tx, rx) = mpsc::channel(64);
            let room = Room::new(
                code.clone(),
                config.clone(),
                self.content.clone(),
                self.metrics.clone(),
                self.persist.sender(),
                self.directory.clone(),
                rules,
            );
            Metrics::incr(&self.metrics.rooms_created);
            rooms.insert(code.clone(), RoomHandle { tx });
            let registry = Arc::clone(&self.rooms);
            let directory = Arc::clone(&self.directory);
            let closing = code.clone();
            // The task owns its registration: however run_room ends (idle reclaim, admin
            // close, or every sender dropped) the code comes out of both maps.
            tokio::spawn(async move {
                run_room(room, rx).await;
                directory.remove(&closing);
                if let Ok(mut rooms) = registry.lock() {
                    rooms.remove(&closing);
                }
            });
            info!(room = %code, map = %config.map, "room created");
            return Some(code);
        }
        warn!("could not allocate a room code");
        None
    }

    /// Ask a room to shut down (admin action); its task deregisters itself.
    pub fn close(&self, code: &str) {
        let _ = self.send(code, Command::Close);
    }

    pub fn join(&self, code: &str, player: Player, sender: mpsc::UnboundedSender<Bytes>) -> bool {
        let sender_handle = {
            let rooms = match self.rooms.lock() {
                Ok(rooms) => rooms,
                Err(_) => return false,
            };
            rooms.get(code).cloned()
        };
        let Some(handle) = sender_handle else {
            return false;
        };
        handle.tx.try_send(Command::Join { player, sender }).is_ok()
    }

    pub fn send(&self, code: &str, command: Command) -> bool {
        let handle = {
            let rooms = match self.rooms.lock() {
                Ok(rooms) => rooms,
                Err(_) => return false,
            };
            rooms.get(code).cloned()
        };
        match handle {
            Some(handle) => handle.tx.try_send(command).is_ok(),
            None => false,
        }
    }

    pub fn exists(&self, code: &str) -> bool {
        self.rooms
            .lock()
            .map(|rooms| rooms.contains_key(code))
            .unwrap_or(false)
    }

    pub fn remove(&self, code: &str) {
        if let Ok(mut rooms) = self.rooms.lock() {
            rooms.remove(code);
        }
    }

    /// Re-attach a reconnecting player; the room decides whether a slot exists.
    pub fn resume(&self, code: &str, player: Player, sender: mpsc::UnboundedSender<Bytes>) -> bool {
        self.send(code, Command::Resume { player, sender })
    }

    pub fn disconnect(&self, code: &str, player: u32) {
        let _ = self.send(code, Command::Disconnect { player });
    }

    fn generate_code(&self) -> String {
        let counter = self.code_counter.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(1);
        let mut state = nanos ^ counter.wrapping_mul(0x9e37_79b9);
        let mut code = String::with_capacity(6);
        for _ in 0..6 {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let index = (state >> 16) as usize % ROOM_CODE_ALPHABET.len();
            code.push(ROOM_CODE_ALPHABET[index] as char);
        }
        code
    }
}

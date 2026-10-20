//! Room registry and codes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use bytes::Bytes;
use gunbrawl_content::Content;
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::room::{run_room, Command, Player, Room, RoomConfig, ROOM_CODE_ALPHABET};

#[derive(Clone)]
pub struct RoomHandle {
    pub tx: mpsc::Sender<Command>,
}

pub struct Lobby {
    rooms: Mutex<HashMap<String, RoomHandle>>,
    next_player: AtomicU32,
    code_counter: AtomicU32,
    content: Arc<Content>,
}

impl Lobby {
    pub fn new(content: Arc<Content>) -> Self {
        Self {
            rooms: Mutex::new(HashMap::new()),
            next_player: AtomicU32::new(1),
            code_counter: AtomicU32::new(0),
            content,
        }
    }

    pub fn next_player_id(&self) -> u32 {
        self.next_player.fetch_add(1, Ordering::Relaxed)
    }

    pub fn create(&self, config: RoomConfig) -> Option<String> {
        let mut rooms = self.rooms.lock().ok()?;
        for _ in 0..16 {
            let code = self.generate_code();
            if rooms.contains_key(&code) {
                continue;
            }
            let (tx, rx) = mpsc::channel(64);
            let room = Room::new(code.clone(), config.clone(), self.content.clone());
            tokio::spawn(run_room(room, rx));
            rooms.insert(code.clone(), RoomHandle { tx });
            info!(room = %code, map = %config.map, "room created");
            return Some(code);
        }
        warn!("could not allocate a room code");
        None
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

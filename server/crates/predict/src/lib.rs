//! Browser-side movement prediction, compiled to `wasm32`.
//!
//! The server stays authoritative; this module only advances the local actor
//! with the same movement code so input feels immediate. Each snapshot either
//! confirms the prediction or snaps it back when the error is large.
//!
//! The ABI is raw (no wasm-bindgen): handles are `u32` pointers and poses are
//! f64 arrays written into memory the caller allocates.

use std::sync::OnceLock;

use gunbrawl_content::Content;
use gunbrawl_core::actor::create_actor;
use gunbrawl_core::constants::FIXED_STEP;
use gunbrawl_core::movement::move_actor;
use gunbrawl_core::types::{ActorConfig, ActorInput, ActorState, Control, MapDef, Vec2, WeaponDef};

fn content() -> &'static Content {
    static CONTENT: OnceLock<Content> = OnceLock::new();
    CONTENT.get_or_init(|| Content::parse().expect("content data must be valid"))
}

pub struct Solo {
    map: MapDef,
    actor: ActorState,
}

impl Solo {
    fn new(map: MapDef, spawn: Vec2) -> Self {
        let content = content();
        let pistol = content.pistol();
        let definition: &WeaponDef = &content.weapons[pistol as usize];
        let config = ActorConfig {
            id: 0,
            name: "local".into(),
            color: 0xffffff,
            control: Control::Human(1),
        };
        let actor = create_actor(config, spawn, 3, map.width / 2.0, pistol, definition);
        Self { map, actor }
    }

    fn step(&mut self, input: ActorInput) {
        move_actor(&mut self.actor, input, &self.map, FIXED_STEP);
    }
}

#[no_mangle]
pub extern "C" fn gb_map_count() -> u32 {
    content().maps.len() as u32
}

#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_map_name_len(index: u32) -> u32 {
    content()
        .maps
        .get(index as usize)
        .map(|map| map.id.len() as u32)
        .unwrap_or(0)
}

/// Copy a map id into `out`; returns the number of bytes written.
#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_map_name(index: u32, out: *mut u8, len: u32) -> u32 {
    let Some(map) = content().maps.get(index as usize) else {
        return 0;
    };
    let bytes = map.id.as_bytes();
    let count = bytes.len().min(len as usize);
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), out, count);
    }
    count as u32
}

#[no_mangle]
pub extern "C" fn gb_alloc(len: u32) -> *mut u8 {
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8
}

#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_free(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr,
            len as usize,
        )));
    }
}

/// Create a predictor for `map_index` at the given spawn; returns null on error.
#[no_mangle]
pub extern "C" fn gb_new(map_index: u32, spawn_x: f64, spawn_y: f64) -> *mut Solo {
    let Some(map) = content().maps.get(map_index as usize).cloned() else {
        return std::ptr::null_mut();
    };
    Box::into_raw(Box::new(Solo::new(map, Vec2::new(spawn_x, spawn_y))))
}

#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_step(solo: *mut Solo, move_x: i32, held: u32, edges: u32) {
    if solo.is_null() {
        return;
    }
    let input = ActorInput {
        move_x: move_x.clamp(-1, 1) as i8,
        jump_pressed: edges & 1 != 0,
        drop_pressed: edges & 2 != 0,
        shoot_held: held & 1 != 0,
        bomb_pressed: edges & 4 != 0,
        reload_pressed: edges & 8 != 0,
    };
    unsafe { (*solo).step(input) };
}

/// Write `[x, y, vx, vy, facing, grounded, jumps, drop_remaining]` into `out`.
#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_pose(solo: *const Solo, out: *mut f64) {
    if solo.is_null() || out.is_null() {
        return;
    }
    let actor = unsafe { &(*solo).actor };
    let pose = [
        actor.position.x,
        actor.position.y,
        actor.move_velocity,
        actor.vertical_velocity,
        actor.facing as f64,
        if actor.grounded_on.is_some() {
            1.0
        } else {
            0.0
        },
        actor.jumps_remaining as f64,
        actor.drop_remaining,
    ];
    unsafe {
        std::ptr::copy_nonoverlapping(pose.as_ptr(), out, pose.len());
    }
}

/// Reconcile the predicted actor with the authoritative snapshot.
#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_set_pose(
    solo: *mut Solo,
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    facing: i32,
    grounded: u32,
    jumps: u32,
) {
    if solo.is_null() {
        return;
    }
    let actor = unsafe { &mut (*solo).actor };
    actor.position = Vec2::new(x, y);
    actor.previous = actor.position;
    actor.move_velocity = vx;
    actor.vertical_velocity = vy;
    actor.facing = if facing < 0 { -1 } else { 1 };
    actor.grounded_on = if grounded != 0 { Some(0) } else { None };
    actor.jumps_remaining = jumps.min(2) as u8;
}

#[no_mangle]
#[allow(clippy::not_unsafe_ptr_arg_deref)]
pub extern "C" fn gb_free_solo(solo: *mut Solo) {
    if solo.is_null() {
        return;
    }
    unsafe {
        drop(Box::from_raw(solo));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sky_citadel() -> u32 {
        (0..gb_map_count())
            .find(|index| {
                let map = &content().maps[*index as usize];
                map.id == "sky-citadel"
            })
            .expect("sky-citadel")
    }

    #[test]
    fn walks_right_and_jumps() {
        let index = sky_citadel();
        let solo = gb_new(index, 230.0, 555.0);
        assert!(!solo.is_null());
        let start = unsafe { (*solo).actor.position.x };
        for _ in 0..30 {
            gb_step(solo, 1, 0, 0);
        }
        let moved = unsafe { (*solo).actor.position.x };
        assert!(
            moved > start + 20.0,
            "expected movement, got {start} -> {moved}"
        );

        // Ground jump: the actor leaves the platform (y decreases).
        let before = unsafe { (*solo).actor.position.y };
        gb_step(solo, 0, 0, 1);
        for _ in 0..10 {
            gb_step(solo, 0, 0, 0);
        }
        let after = unsafe { (*solo).actor.position.y };
        assert!(
            after < before - 10.0,
            "expected a jump, got {before} -> {after}"
        );
        gb_free_solo(solo);
    }

    #[test]
    fn reconciles_to_snapshot_pose() {
        let index = sky_citadel();
        let solo = gb_new(index, 230.0, 555.0);
        gb_set_pose(solo, 640.0, 500.0, 0.0, 0.0, -1, 1, 1);
        let actor = unsafe { &(*solo).actor };
        assert_eq!(actor.position.x, 640.0);
        assert_eq!(actor.facing, -1);
        assert_eq!(actor.jumps_remaining, 1);
        gb_free_solo(solo);
    }
}

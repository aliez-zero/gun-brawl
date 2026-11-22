//! Projection from the authoritative match to the binary snapshot consumed by all modes.
use gunbrawl_core::constants::MOVEMENT;
use gunbrawl_core::types::{
    ActorStatus, BattleEvent, DropState, ExplosionSource, MatchPhase, MatchState, Vec2,
};
use gunbrawl_core::TICK_RATE;
use gunbrawl_proto::*;

pub(super) struct ModeState {
    pub training_completed: u8,
    pub dummy_moving: bool,
    pub external_epoch: u32,
    pub playing_tick: u32,
}

pub(super) fn phase_id(phase: MatchPhase) -> u8 {
    match phase {
        MatchPhase::Countdown => PHASE_COUNTDOWN,
        MatchPhase::Playing => PHASE_PLAYING,
        MatchPhase::Paused => PHASE_PAUSED,
        MatchPhase::Finished => PHASE_RESULT,
    }
}

pub(super) fn build(
    state: &MatchState,
    tick: u32,
    phase: u8,
    acks: [u32; 4],
    events: &[EventSnap],
    mode: ModeState,
) -> Snapshot {
    let actors = state
        .actors
        .iter()
        .map(|actor| {
            let flags =
                u8::from(actor.grounded_on.is_some()) | ((actor.jumps_remaining.min(3)) << 1);
            ActorSnap {
                id: actor.config.id,
                x: quantize_pos(actor.position.x as f32),
                y: quantize_pos(actor.position.y as f32),
                vx: quantize_vel(actor.move_velocity as f32),
                vy: quantize_vel(actor.vertical_velocity as f32),
                impulse_x: quantize_vel(actor.impulse.x as f32),
                impulse_y: quantize_vel(actor.impulse.y as f32),
                facing: actor.facing,
                flags,
                status: match actor.status {
                    ActorStatus::Alive => 0,
                    ActorStatus::Respawning => 1,
                    ActorStatus::Eliminated => 2,
                },
                stocks: actor.stocks.clamp(0, 255) as u8,
                weapon: actor.weapon.weapon,
                ammo: actor
                    .weapon
                    .ammo
                    .map(|ammo| ammo.clamp(0, 254) as u8)
                    .unwrap_or(255),
                reserve: actor.weapon.reserve.clamp(0, 255) as u8,
                fire_cd: (actor.fire_cooldown * 100.0).clamp(0.0, 255.0) as u8,
                reload_ms: (actor.reload_remaining * 1000.0).round() as u16,
                protection: (actor.protection_remaining * 10.0).clamp(0.0, 255.0) as u8,
                respawn: (actor.respawn_remaining * 10.0).clamp(0.0, 255.0) as u8,
                grounded_platform: actor.grounded_on.unwrap_or(u8::MAX),
                drop_platform: actor.drop_platform.unwrap_or(u8::MAX),
                drop_timer: movement_timer(actor.drop_remaining, MOVEMENT.drop_time),
                coyote_timer: movement_timer(actor.coyote_remaining, MOVEMENT.coyote_time),
                jump_timer: movement_timer(actor.jump_buffer, MOVEMENT.input_buffer),
                bombs: actor.bombs_remaining,
                bomb_cooldown_ms: (actor.bomb_cooldown * 1000.0).round() as u16,
                knockouts: actor.stats.knockouts,
                falls: actor.stats.falls,
                self_falls: actor.stats.self_falls,
            }
        })
        .collect();
    let projectiles = state
        .projectiles
        .iter()
        .map(|projectile| gunbrawl_proto::ProjSnap {
            id: projectile.id,
            owner: projectile.owner,
            weapon: projectile.weapon,
            x: quantize_pos(projectile.position.x as f32),
            y: quantize_pos(projectile.position.y as f32),
            vx: quantize_vel(projectile.velocity.x as f32),
            vy: quantize_vel(projectile.velocity.y as f32),
        })
        .collect();
    let bombs = state
        .bombs
        .iter()
        .map(|bomb| BombSnap {
            id: bomb.id,
            owner: bomb.owner,
            x: quantize_pos(bomb.position.x as f32),
            y: quantize_pos(bomb.position.y as f32),
            fuse_ms: (bomb.fuse_remaining * 1000.0).round() as u16,
            vx: quantize_vel(bomb.velocity.x as f32),
            vy: quantize_vel(bomb.velocity.y as f32),
        })
        .collect();
    let drops = state
        .drops
        .iter()
        .map(|drop| DropSnap {
            id: drop.id,
            weapon: drop.weapon,
            x: quantize_pos(drop.position.x as f32),
            y: quantize_pos(drop.position.y as f32),
            state: u8::from(drop.state == DropState::Active),
            warning: drop.warning,
            timer_ms: (drop.timer * 1000.0).round() as u16,
        })
        .collect();
    Snapshot {
        tick,
        server_ms: (state.elapsed * 1000.0) as u64,
        phase,
        remaining_ms: (state.remaining * 1000.0) as u32,
        countdown_ms: (state.countdown_remaining * 1000.0).round() as u32,
        overtime: state.overtime,
        training_completed: mode.training_completed,
        dummy_moving: mode.dummy_moving,
        external_epoch: mode.external_epoch,
        playing_tick: mode.playing_tick,
        acks,
        actors,
        projectiles,
        bombs,
        drops,
        events: events.to_vec(),
    }
}

fn movement_timer(remaining: f64, duration: f64) -> u8 {
    if remaining <= 0.0 {
        return 0;
    }
    ((duration - remaining) * f64::from(TICK_RATE)).round() as u8 + 1
}

pub(super) fn event_snap(event: &BattleEvent) -> Option<EventSnap> {
    let base = |kind, actor, at: Vec2| EventSnap {
        kind,
        actor,
        x: quantize_pos(at.x as f32),
        y: quantize_pos(at.y as f32),
        weapon: 0,
        object: 0,
        other: u8::MAX,
        radius: 0,
    };
    use BattleEvent::*;
    Some(match *event {
        Shot {
            actor,
            position,
            weapon,
        } => EventSnap {
            weapon,
            ..base(EVENT_SHOT, actor, position)
        },
        ReloadStart {
            actor,
            position,
            weapon,
        } => EventSnap {
            weapon,
            ..base(EVENT_RELOAD, actor, position)
        },
        Hit { actor, position } => base(EVENT_HIT, actor, position),
        Bomb {
            actor,
            position,
            bomb_id,
        } => EventSnap {
            object: bomb_id,
            ..base(EVENT_BOMB, actor, position)
        },
        BombEmpty { actor, position } => base(EVENT_BOMB_EMPTY, actor, position),
        Explosion {
            source,
            owner,
            position,
            radius,
        } => EventSnap {
            other: u8::from(source == ExplosionSource::Rocket),
            radius: radius.round() as u16,
            ..base(EVENT_EXPLOSION, owner, position)
        },
        DropIncoming {
            drop_id,
            weapon,
            position,
        } => EventSnap {
            weapon,
            object: drop_id,
            ..base(EVENT_DROP_INCOMING, 0, position)
        },
        DropLanded {
            drop_id,
            weapon,
            position,
        } => EventSnap {
            weapon,
            object: drop_id,
            ..base(EVENT_DROP_LANDED, 0, position)
        },
        DropExpired { drop_id, position } => EventSnap {
            object: drop_id,
            ..base(EVENT_DROP_EXPIRED, 0, position)
        },
        Pickup {
            actor,
            weapon,
            position,
            drop_id,
        } => EventSnap {
            weapon,
            object: drop_id,
            ..base(EVENT_PICKUP, actor, position)
        },
        Ringout {
            actor,
            position,
            credited_to,
        } => EventSnap {
            other: credited_to.unwrap_or(u8::MAX),
            ..base(EVENT_RINGOUT, actor, position)
        },
        Respawn { actor, position } => base(EVENT_RESPAWN, actor, position),
        Phase(phase) => EventSnap {
            other: phase_id(phase),
            ..base(EVENT_PHASE, 0, Vec2::ZERO)
        },
        Overtime => base(EVENT_OVERTIME, 0, Vec2::ZERO),
        Finished(_) => return None, // The room sends a separate result with the full score table.
    })
}

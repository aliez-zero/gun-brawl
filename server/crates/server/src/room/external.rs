//! Turns a delayed model decision into ordinary inputs on the room's playing clock.
use gunbrawl_bot::BotController;
use gunbrawl_core::constants::ACTOR_WIDTH;
use gunbrawl_core::types::{
    ActorInput, ActorState, ActorStatus, Difficulty, MatchPhase, MatchState, Vec2,
};
use gunbrawl_proto::{InputFrame, PrivateAction};

const MAX_AGE: u32 = 180;
const MAX_HOLD: u8 = 45;

#[derive(Clone, Copy)]
enum Intent {
    Direct,
    Attack,
    Recover,
    Collect,
    Reposition,
}

#[derive(Clone, Copy)]
struct Decision {
    input: InputFrame,
    intent: Intent,
    until: u32,
    first: bool,
}

pub(super) struct ExternalController {
    actor: usize,
    lifecycle: Option<(MatchPhase, bool, ActorStatus, i32)>,
    epoch: u32,
    last_sequence: Option<u32>,
    decision: Option<Decision>,
    assist: BotController,
    previous: Option<Vec2>,
    stalled_for: f64,
    last_dodge: Option<u32>,
}

impl ExternalController {
    pub(super) fn new(actor: usize, seed: u32) -> Self {
        Self {
            actor,
            lifecycle: None,
            epoch: 0,
            last_sequence: None,
            decision: None,
            assist: BotController::new(Difficulty::Normal, seed),
            previous: None,
            stalled_for: 0.0,
            last_dodge: None,
        }
    }

    pub(super) fn sync(&mut self, state: &MatchState) {
        let lifecycle = state
            .actors
            .get(self.actor)
            .map(|actor| (state.phase, state.overtime, actor.status, actor.stocks));
        if self.lifecycle != lifecycle {
            self.lifecycle = lifecycle;
            self.epoch = self.epoch.wrapping_add(1);
            self.last_sequence = None;
            self.decision = None;
            self.last_dodge = None;
            self.previous = None;
            self.stalled_for = 0.0;
        }
    }

    pub(super) fn epoch(&self) -> u32 {
        self.epoch
    }

    fn active(&self) -> bool {
        matches!(
            self.lifecycle,
            Some((MatchPhase::Playing, _, ActorStatus::Alive, _))
        )
    }

    pub(super) fn accept(&mut self, action: &PrivateAction, tick: u32) -> bool {
        let PrivateAction::External {
            actor,
            epoch,
            sequence,
            observation_tick,
            hold,
            input,
            intent,
        } = *action
        else {
            return false;
        };
        if !self.active()
            || actor as usize != self.actor
            || epoch != self.epoch
            || self.last_sequence.is_some_and(|last| sequence <= last)
            || observation_tick > tick
            || tick - observation_tick >= MAX_AGE
            || !(1..=MAX_HOLD).contains(&hold)
            || !(-1..=1).contains(&input.move_x)
            || (input.jump() && input.drop())
        {
            return false;
        }
        let intent = match intent {
            0 => Intent::Direct,
            1 => Intent::Attack,
            2 => Intent::Recover,
            3 => Intent::Collect,
            4 => Intent::Reposition,
            _ => return false,
        };
        let until = tick
            .saturating_add(u32::from(hold))
            .min(observation_tick.saturating_add(MAX_AGE));
        self.last_sequence = Some(sequence);
        self.decision = Some(Decision {
            input,
            intent,
            until,
            first: true,
        });
        true
    }

    pub(super) fn sample(&mut self, state: &MatchState, tick: u32, dt: f64) -> ActorInput {
        if !self.active() {
            return ActorInput::IDLE;
        }
        let actor = &state.actors[self.actor];
        self.stalled_for = if self
            .previous
            .is_some_and(|p| distance(p, actor.position) < 0.5)
        {
            self.stalled_for + dt
        } else {
            0.0
        };
        self.previous = Some(actor.position);
        let assist = self.assist.sample(self.actor, state, dt);
        let current = self.decision.filter(|d| tick < d.until);
        if let Some(decision) = &mut self.decision {
            decision.first = false;
        }
        if let Some(move_x) = recovery_direction(actor, state) {
            let jump_pressed = actor.jumps_remaining > 0
                && self
                    .last_dodge
                    .is_none_or(|last| tick.saturating_sub(last) >= 18);
            if jump_pressed {
                self.last_dodge = Some(tick);
            }
            let shoot_held = current.is_some_and(|d| d.input.fire() && move_x == d.input.move_x);
            return ActorInput {
                move_x,
                jump_pressed,
                shoot_held,
                ..ActorInput::IDLE
            };
        }
        let Some(decision) = current else {
            return if self
                .decision
                .is_some_and(|d| matches!(d.intent, Intent::Direct))
            {
                ActorInput::IDLE
            } else {
                assist
            };
        };
        let input = decision.input;
        let target = state
            .actors
            .iter()
            .filter(|a| a.id() != actor.id() && a.status == ActorStatus::Alive)
            .min_by(|a, b| {
                distance(a.position, actor.position)
                    .total_cmp(&distance(b.position, actor.position))
            });
        let dx = target.map_or(0.0, |t| t.position.x - actor.position.x);
        let toward = if dx < 0.0 { -1 } else { 1 };
        let in_range = target.is_some_and(|t| {
            (t.position.y - actor.position.y).abs() < 55.0
                && dx.abs() <= state.config.weapon(actor.weapon.weapon).range
        });
        let attack = matches!(decision.intent, Intent::Attack);
        let tactical = (actor.grounded_on.is_none() && actor.vertical_velocity > 0.0)
            || (self.stalled_for >= 0.45 && assist.move_x != 0)
            || matches!(decision.intent, Intent::Recover | Intent::Collect)
            || (matches!(decision.intent, Intent::Reposition) && input.move_x == 0);
        let move_x = if tactical {
            assist.move_x
        } else if attack && target.is_some() {
            toward
        } else {
            input.move_x
        };
        let aim = if attack && in_range {
            toward
        } else if input.move_x != 0 {
            input.move_x
        } else {
            actor.facing
        };
        let shoot_held = if matches!(decision.intent, Intent::Direct) {
            input.fire()
        } else {
            in_range && aim == toward && (input.fire() || attack)
        };
        ActorInput {
            move_x,
            shoot_held,
            jump_pressed: (decision.first && input.jump())
                || (assist.jump_pressed && actor.grounded_on.is_some()),
            drop_pressed: (decision.first && input.drop())
                || (assist.drop_pressed && actor.grounded_on.is_some()),
            bomb_pressed: decision.first && input.bomb(),
            reload_pressed: (decision.first && input.reload()) || assist.reload_pressed,
        }
    }
}

fn distance(a: Vec2, b: Vec2) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

fn recovery_direction(actor: &ActorState, state: &MatchState) -> Option<i8> {
    let p = actor.position;
    let map = &state.config.map;
    let half = ACTOR_WIDTH / 2.0;
    if p.x - half <= map.bounds.left + 64.0 {
        return Some(1);
    }
    if p.x + half >= map.bounds.right - 64.0 {
        return Some(-1);
    }
    let projectile = state
        .projectiles
        .iter()
        .filter(|shot| {
            shot.owner != actor.id()
                && distance(shot.position, p) < 180.0
                && (p.x - shot.position.x) * shot.velocity.x > 0.0
        })
        .min_by(|a, b| distance(a.position, p).total_cmp(&distance(b.position, p)));
    let threat = projectile.map(|shot| shot.position.x).or_else(|| {
        state
            .bombs
            .iter()
            .filter(|bomb| {
                bomb.owner != actor.id()
                    && bomb.fuse_remaining < 1.0
                    && distance(bomb.position, p) < bomb.radius * 0.9
            })
            .min_by(|a, b| a.fuse_remaining.total_cmp(&b.fuse_remaining))
            .map(|bomb| bomb.position.x)
    });
    if let Some(x) = threat {
        return Some(if p.x >= x { 1 } else { -1 });
    }
    if actor.grounded_on.is_some() || actor.vertical_velocity <= 0.0 {
        return None;
    }
    let overlaps = |platform: &gunbrawl_core::types::Platform| {
        p.x >= platform.x - half && p.x <= platform.x + platform.width + half
    };
    let platform = map
        .platforms
        .iter()
        .filter(|platform| platform.y >= p.y - 8.0 && platform.y - p.y < 280.0)
        .map(|platform| {
            let center = platform.x + platform.width / 2.0;
            let score = if overlaps(platform) { 0.0 } else { 500.0 };
            (
                platform,
                center,
                score + (platform.y - p.y).abs() + (center - p.x).abs() * 0.08,
            )
        })
        .min_by(|a, b| a.2.total_cmp(&b.2));
    platform
        .filter(|(platform, _, _)| !overlaps(platform))
        .map(|(_, center, _)| if center > p.x { 1 } else { -1 })
}

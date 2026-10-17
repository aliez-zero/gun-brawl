import { createActor } from './actors';
import { idleInput } from './types';
import type { ActorInput, BattleEvent, MatchConfig, MatchState } from './types';
import { moveActor } from '../systems/MovementSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { GrenadeSystem } from '../systems/GrenadeSystem';
import { resolveRingouts, updateLifeTimers } from '../systems/LifeSystem';
import { resolveMatch } from '../systems/MatchSystem';

export class BattleSimulation {
  readonly state: MatchState;
  private readonly combat = new CombatSystem();
  private readonly grenades = new GrenadeSystem();
  private events: BattleEvent[] = [];

  constructor(config: MatchConfig) {
    const ids = new Set(config.actors.map((actor) => actor.id));
    if (config.actors.length < 2 || config.actors.length > 4 || ids.size !== config.actors.length) throw new Error('参战人数应为 2—4，角色 ID 必须唯一');
    if (!config.actors.some((actor) => actor.control === 'human')) throw new Error('至少需要一名本地玩家');
    if (config.map.spawns.length < config.actors.length || !Number.isFinite(config.duration) || config.duration <= 0 || !Number.isInteger(config.stocks) || config.stocks < 1) throw new Error('地图或对局规则无效');
    this.state = {
      config, phase: 'countdown', actors: config.actors.map((actor, index) => createActor(
        actor, config.map.spawns[index]!, config.stocks, config.map.width / 2, config.startingWeapon,
      )),
      projectiles: [], bombs: [], elapsed: 0, remaining: config.duration,
      countdownRemaining: config.countdown, overtime: false, result: null,
    };
  }

  step(dt: number, inputs: ReadonlyMap<string, ActorInput>): void {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
    const state = this.state;
    if (state.phase === 'paused' || state.phase === 'finished') return;
    if (state.phase === 'countdown') {
      state.countdownRemaining = Math.max(0, state.countdownRemaining - dt);
      if (state.countdownRemaining <= 1e-8) {
        state.countdownRemaining = 0;
        state.phase = 'playing';
        this.events.push({ type: 'phase', phase: 'playing' });
      }
      return;
    }
    state.elapsed += dt;
    if (state.config.mode !== 'training') state.remaining = Math.max(0, state.remaining - dt);
    updateLifeTimers(state, dt, this.events);
    for (const actor of state.actors) moveActor(actor, inputs.get(actor.config.id) ?? idleInput(), state.config.map, dt);
    this.combat.update(state, inputs, dt, this.events);
    this.grenades.update(state, inputs, dt, this.events);
    resolveRingouts(state, this.events);
    resolveMatch(state, this.events);
  }

  pause(): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'countdown') return;
    this.state.phase = 'paused';
    this.events.push({ type: 'phase', phase: 'paused' });
  }

  resume(): void {
    if (this.state.phase !== 'paused') return;
    this.state.phase = 'countdown';
    this.state.countdownRemaining = 3;
    this.events.push({ type: 'phase', phase: 'countdown' });
  }

  drainEvents(): BattleEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }
}

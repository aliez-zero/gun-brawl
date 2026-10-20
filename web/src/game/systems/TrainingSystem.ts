import { BOMB } from '../core/constants';
import { createTrainingState } from '../../content/tutorial';
import type { ActorInput, BattleEvent, MatchState, TrainingTaskId, TrainingState } from '../core/types';

/**
 * Training-only observer. It never mutates combat state; it only records tasks
 * from legal inputs/events so a UI button cannot fake completion.
 */
export class TrainingSystem {
  readonly state: TrainingState;

  constructor(completed: readonly TrainingTaskId[] = []) {
    this.state = createTrainingState(completed);
  }

  update(state: MatchState, inputs: ReadonlyMap<string, ActorInput>, dt: number, events: readonly BattleEvent[]): void {
    if (state.config.mode !== 'training') return;
    const humans = state.actors.filter((actor) => actor.config.control === 'human' && actor.status === 'alive');
    for (const actor of humans) {
      const input = inputs.get(actor.config.id);
      if (input?.moveX) {
        this.state.moveTime += dt;
        if (this.state.moveTime >= 0.6) this.complete('move');
      }
      if (input?.jumpPressed && actor.groundedOn === null && actor.jumpsRemaining === 0) this.complete('double-jump');
      if (input?.dropPressed && actor.dropPlatform !== null) this.complete('drop');
    }
    for (const event of events) {
      if (event.type === 'hit') {
        const target = state.actors.find((actor) => actor.config.id === event.actorId);
        if (target?.config.control === 'dummy' && target.protectionRemaining <= 0) this.complete('hit');
      }
      if (event.type === 'ringout' && event.creditedTo && state.actors.find((actor) => actor.config.id === event.actorId)?.config.control === 'dummy') {
        this.complete('ringout');
      }
      if (event.type === 'bomb' && state.actors.find((actor) => actor.config.id === event.actorId)?.config.control === 'human') {
        this.complete('bomb');
      }
    }
  }

  resetRound(state: MatchState, events: BattleEvent[]): void {
    if (state.config.mode !== 'training') return;
    this.state.moveTime = 0;
    state.projectiles = [];
    state.bombs = [];
    state.drops = [];
    state.phase = 'countdown';
    state.countdownRemaining = state.config.countdown;
    state.elapsed = 0;
    state.remaining = state.config.duration;
    state.overtime = false;
    state.result = null;
    state.actors.forEach((actor, index) => {
      const spawn = state.config.map.spawns[index] ?? state.config.map.spawns[0]!;
      actor.position = { ...spawn };
      actor.previous = { ...spawn };
      actor.moveVelocity = 0;
      actor.verticalVelocity = 0;
      actor.impulse = { x: 0, y: 0 };
      actor.facing = spawn.x < state.config.map.width / 2 ? 1 : -1;
      actor.groundedOn = null;
      actor.jumpsRemaining = 2;
      actor.coyoteRemaining = 0;
      actor.jumpBuffer = 0;
      actor.dropPlatform = null;
      actor.dropRemaining = 0;
      actor.stocks = state.config.stocks;
      actor.status = 'alive';
      actor.respawnRemaining = 0;
      actor.protectionRemaining = 0;
      actor.fireCooldown = 0;
      actor.reloadRemaining = 0;
      actor.bombCooldown = 0;
      actor.bombsRemaining = BOMB.perLife;
      actor.lastHit = null;
      actor.stats = { knockouts: 0, falls: 0, selfFalls: 0 };
    });
    events.push({ type: 'phase', phase: 'countdown' });
  }

  private complete(task: TrainingTaskId): void {
    if (this.state.completed[task]) return;
    this.state.completed[task] = true;
    this.state.completedTasks.push(task);
  }
}

import { BotController } from '../ai/BotController';
import { BattleSimulation } from './BattleSimulation';
import { FixedStepLoop } from './FixedStepLoop';
import { idleInput } from './types';
import type { ActorInput, BattleEvent, HumanSlot, MatchConfig, MatchState } from './types';

export class MatchRunner {
  readonly simulation: BattleSimulation;
  private readonly clock = new FixedStepLoop();
  private readonly bots = new Map<string, BotController>();

  constructor(config: MatchConfig) {
    this.simulation = new BattleSimulation(config);
    config.actors.forEach((actor, index) => {
      if (actor.control === 'bot') this.bots.set(actor.id, new BotController(actor.difficulty, config.seed + index));
    });
  }

  get state(): Readonly<MatchState> { return this.simulation.state; }
  get alpha(): number { return this.clock.alpha; }

  advance(milliseconds: number, readHuman: (slot: HumanSlot) => ActorInput): BattleEvent[] {
    if (this.state.phase === 'paused' || this.state.phase === 'finished') {
      this.clock.reset();
      return this.simulation.drainEvents();
    }
    this.clock.advance(milliseconds, (dt) => {
      const inputs = new Map<string, ActorInput>();
      for (const actor of this.state.actors) {
        const config = actor.config;
        const input = config.control === 'human'
          ? readHuman(config.inputSlot)
          : this.bots.get(config.id)?.sample(actor, this.simulation.state, dt) ?? idleInput();
        inputs.set(config.id, input);
      }
      this.simulation.step(dt, inputs);
    });
    return this.simulation.drainEvents();
  }

  pause(): void { this.simulation.pause(); this.clock.reset(); }
  resume(): void { this.simulation.resume(); this.clock.reset(); }
}

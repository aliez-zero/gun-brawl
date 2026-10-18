import { BotController } from '../ai/BotController';
import { ExternalInputController } from '../ai/external/ExternalInputController';
import type { CommandContext } from '../ai/external/Protocol';
import { BattleSimulation } from './BattleSimulation';
import { FixedStepLoop } from './FixedStepLoop';
import { idleInput } from './types';
import type { ActorInput, ActorState, BattleEvent, HumanSlot, MatchConfig, MatchState } from './types';

export class MatchRunner {
  readonly simulation: BattleSimulation;
  private readonly clock = new FixedStepLoop();
  private readonly bots = new Map<string, BotController>();
  private readonly external = new Map<string, ExternalInputController>();
  private playingTick = 0;

  constructor(config: MatchConfig) {
    this.simulation = new BattleSimulation(config);
    config.actors.forEach((actor, index) => {
      if (actor.control === 'bot') this.bots.set(actor.id, new BotController(actor.difficulty, config.seed + index));
      if (actor.control === 'external') this.external.set(actor.id, new ExternalInputController());
    });
    this.synchronizeExternal();
  }

  get state(): Readonly<MatchState> { return this.simulation.state; }
  get alpha(): number { return this.clock.alpha; }
  get tick(): number { return this.playingTick; }

  externalEpoch(actorId: string): number | undefined { return this.external.get(actorId)?.epoch; }

  applyExternalInput(actorId: string, value: unknown, context: CommandContext): boolean {
    this.synchronizeExternal();
    return this.external.get(actorId)?.accept(value, context, this.playingTick) ?? false;
  }

  private synchronizeExternal(): void {
    for (const actor of this.state.actors) this.external.get(actor.config.id)?.synchronize(actor, this.state);
  }

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
          : config.control === 'external'
            ? this.external.get(config.id)?.sample(this.playingTick, actor, this.state) ?? idleInput()
          : config.control === 'dummy'
            ? this.dummyInput(actor)
            : this.bots.get(config.id)?.sample(actor, this.simulation.state, dt) ?? idleInput();
        inputs.set(config.id, input);
      }
      const playing = this.state.phase === 'playing';
      this.simulation.step(dt, inputs);
      if (playing) this.playingTick++;
      this.synchronizeExternal();
    });
    return this.simulation.drainEvents();
  }

  pause(): void { this.simulation.pause(); this.clock.reset(); this.synchronizeExternal(); }
  resume(): void { this.simulation.resume(); this.clock.reset(); this.synchronizeExternal(); }
  resetTraining(): boolean { const result = this.simulation.resetTraining(); this.synchronizeExternal(); return result; }
  setDummyMoving(value: boolean): void { this.simulation.setDummyMoving(value); }

  private dummyInput(actor: ActorState): ActorInput {
    if (!this.simulation.dummyMoving) return idleInput();
    const target = this.simulation.state.config.map.width / 2 + Math.sin(this.simulation.state.elapsed * 0.8) * 220;
    const delta = target - actor.position.x;
    return { ...idleInput(), moveX: Math.abs(delta) < 12 ? 0 : delta > 0 ? 1 : -1 };
  }
}

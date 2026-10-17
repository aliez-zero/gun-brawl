import Phaser from 'phaser';
import { MatchRunner } from '../game/core/MatchRunner';
import type { BattleEvent, CharacterAppearance, HumanSlot, MapDefinition, MatchConfig, MatchState } from '../game/core/types';
import { KeyboardInput } from '../presentation/KeyboardInput';
import { ArenaRenderer } from '../presentation/ArenaRenderer';
import type { SoundEffects } from '../presentation/SoundEffects';

export interface ArenaCallbacks {
  onReady: () => void;
  onFrame: (state: Readonly<MatchState>) => void;
  onEvents: (events: readonly BattleEvent[]) => void;
  onPause: () => void;
}

export class ArenaScene extends Phaser.Scene {
  private runner: MatchRunner | null = null;
  private keyboard!: KeyboardInput;
  private arenaView!: ArenaRenderer;

  constructor(private readonly callbacks: ArenaCallbacks, private readonly soundEffects: SoundEffects) { super('arena'); }

  create(): void {
    this.arenaView = new ArenaRenderer(this);
    this.keyboard = new KeyboardInput(this.callbacks.onPause);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      this.keyboard.destroy();
      this.arenaView.destroy();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.callbacks.onReady();
  }

  startMatch(config: MatchConfig): void {
    this.keyboard.clear();
    this.arenaView.reset();
    this.arenaView.setMap(config.map);
    this.runner = new MatchRunner(config);
    this.callbacks.onFrame(this.runner.state);
  }

  showMenu(): void { this.keyboard.clear(); this.keyboard.enabled = false; this.runner = null; this.arenaView.reset(); }

  setMenuPreview(map: MapDefinition, looks: Record<HumanSlot, CharacterAppearance>): void { this.arenaView.setMenuPreview(map, looks); }

  pauseMatch(): void {
    this.keyboard.enabled = false;
    this.keyboard.clear();
    this.cameras.main.resetFX();
    this.runner?.pause();
  }

  resumeMatch(): void { this.keyboard.clear(); this.runner?.resume(); }
  setReducedMotion(value: boolean): void { this.arenaView.reducedMotion = value; }
  get matchState(): Readonly<MatchState> | null { return this.runner?.state ?? null; }

  update(_time: number, delta: number): void {
    if (!this.runner) { this.arenaView.draw(null, 0, delta / 1000); return; }
    this.keyboard.enabled = this.runner.state.phase === 'playing';
    const events = this.runner.advance(delta, (slot) => this.keyboard.sample(slot));
    this.arenaView.handle(events);
    for (const event of events) this.soundEffects.play(event);
    this.arenaView.draw(this.runner.state, this.runner.alpha, delta / 1000);
    this.callbacks.onFrame(this.runner.state);
    if (events.length) this.callbacks.onEvents(events);
  }
}

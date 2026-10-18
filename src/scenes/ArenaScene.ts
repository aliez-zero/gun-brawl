import Phaser from 'phaser';
import { DEFAULT_KEY_BINDINGS } from '../content/controls';
import type { KeyBindings } from '../content/controls';
import { MatchRunner } from '../game/core/MatchRunner';
import type { BattleEvent, CharacterAppearance, HumanSlot, MapDefinition, MatchConfig, MatchState } from '../game/core/types';
import { KeyboardInput } from '../presentation/KeyboardInput';
import { ArenaRenderer } from '../presentation/ArenaRenderer';
import { FieldLayer } from '../presentation/FieldLayer';
import { WeaponLayer } from '../presentation/WeaponLayer';
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
  private weaponView!: WeaponLayer;
  private fieldView!: FieldLayer;

  constructor(
    private readonly callbacks: ArenaCallbacks,
    private readonly soundEffects: SoundEffects,
    private bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
  ) { super('arena'); }

  create(): void {
    this.arenaView = new ArenaRenderer(this);
    this.weaponView = new WeaponLayer(this);
    this.fieldView = new FieldLayer(this);
    this.keyboard = new KeyboardInput(this.callbacks.onPause, this.bindings);
    let cleaned = false;
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      this.keyboard.destroy();
      this.fieldView.destroy();
      this.weaponView.destroy();
      this.arenaView.destroy();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.callbacks.onReady();
  }

  startMatch(config: MatchConfig): void {
    this.keyboard.clear();
    this.arenaView.reset();
    this.weaponView.reset();
    this.fieldView.reset();
    this.arenaView.setMap(config.map);
    this.runner = new MatchRunner(config);
    this.callbacks.onFrame(this.runner.state);
  }

  showMenu(): void {
    this.keyboard.clear(); this.keyboard.enabled = false; this.runner = null;
    this.weaponView.reset(); this.fieldView.reset(); this.arenaView.reset();
  }

  setMenuPreview(map: MapDefinition, looks: Record<HumanSlot, CharacterAppearance>): void {
    this.weaponView.reset();
    this.fieldView.reset();
    this.arenaView.setMenuPreview(map, looks);
  }

  pauseMatch(): void {
    this.keyboard.enabled = false;
    this.keyboard.clear();
    this.cameras.main.resetFX();
    this.runner?.pause();
  }

  resumeMatch(): void { this.keyboard.clear(); this.runner?.resume(); }
  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    if (this.keyboard) this.keyboard.setBindings(bindings);
  }
  setReducedMotion(value: boolean): void { this.arenaView.reducedMotion = value; }
  get matchState(): Readonly<MatchState> | null { return this.runner?.state ?? null; }

  update(_time: number, delta: number): void {
    if (!this.runner) {
      this.arenaView.draw(null, 0, delta / 1000);
      this.weaponView.draw(null, 0);
      this.fieldView.draw(null, 0, delta / 1000);
      return;
    }
    this.keyboard.enabled = this.runner.state.phase === 'playing';
    const weaponSlot = this.keyboard.consumeWeaponSlot();
    if (weaponSlot !== null) this.runner.simulation.selectTrainingWeapon(weaponSlot);
    const events = this.runner.advance(delta, (slot) => this.keyboard.sample(slot));
    this.arenaView.handle(events);
    this.fieldView.handle(events);
    for (const event of events) this.soundEffects.play(event);
    this.arenaView.draw(this.runner.state, this.runner.alpha, delta / 1000);
    this.weaponView.draw(this.runner.state, this.runner.alpha);
    this.fieldView.draw(this.runner.state, this.runner.alpha, delta / 1000);
    this.callbacks.onFrame(this.runner.state);
    if (events.length) this.callbacks.onEvents(events);
  }
}

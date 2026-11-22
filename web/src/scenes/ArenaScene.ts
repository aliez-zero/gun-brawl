import Phaser from 'phaser';
import { DeepSeekClient } from '../adapters/ai/DeepSeekClient';
import type { DeepSeekSession, DeepSeekStatus } from '../adapters/ai/DeepSeekClient';
import { DEFAULT_KEY_BINDINGS } from '../content/controls';
import type { KeyBindings } from '../content/controls';
import type { BattleEvent, CharacterAppearance, HumanSlot, MapDefinition, MatchState } from '../game/core/types';
import { KeyboardInput } from '../presentation/KeyboardInput';
import { ArenaRenderer } from '../presentation/ArenaRenderer';
import { FieldLayer } from '../presentation/FieldLayer';
import { WeaponLayer } from '../presentation/WeaponLayer';
import type { NetMatchSource } from '../net/NetMatchSource';
import { netStats } from '../net/NetStats';
import type { SoundEffects } from '../presentation/SoundEffects';

export interface ArenaCallbacks {
  onReady: () => void;
  onFrame: (state: Readonly<MatchState>) => void;
  onEvents: (events: readonly BattleEvent[]) => void;
  onPause: () => void;
  onExternalAI: (status: DeepSeekStatus | null) => void;
}

export class ArenaScene extends Phaser.Scene {
  private source: NetMatchSource | null = null;
  private suspended = false;
  private externalAI: DeepSeekClient | null = null;
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
      this.externalAI?.destroy();
      this.keyboard.destroy();
      this.fieldView.destroy();
      this.weaponView.destroy();
      this.arenaView.destroy();
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    this.events.once(Phaser.Scenes.Events.DESTROY, cleanup);
    this.callbacks.onReady();
  }

  startMatch(source: NetMatchSource, session?: DeepSeekSession): void {
    this.showMenu();
    this.source = source;
    this.arenaView.setMap(source.state.config.map);
    if (session) this.externalAI = new DeepSeekClient(source, 'deepseek', session, this.callbacks.onExternalAI);
  }

  showMenu(): void {
    this.externalAI?.destroy();
    this.externalAI = null;
    this.source = null;
    this.suspended = false;
    this.keyboard.enabled = false;
    this.keyboard.clear();
    this.weaponView.reset();
    this.fieldView.reset();
    this.arenaView.reset();
  }

  setMenuPreview(map: MapDefinition, looks: Record<HumanSlot, CharacterAppearance>): void {
    this.weaponView.reset();
    this.fieldView.reset();
    this.arenaView.setMenuPreview(map, looks);
  }

  pauseMatch(): void {
    this.suspended = true;
    this.keyboard.enabled = false;
    this.keyboard.clear();
    this.cameras.main.resetFX();
    this.externalAI?.setPaused(true);
    this.source?.pause();
  }

  finishMatch(): void {
    this.keyboard.enabled = false;
    this.keyboard.clear();
    this.externalAI?.update();
  }

  resumeMatch(): void {
    this.keyboard.clear();
    this.source?.resume();
    this.externalAI?.setPaused(false);
    this.suspended = false;
  }

  setBindings(bindings: KeyBindings): void {
    this.bindings = bindings;
    if (this.keyboard) this.keyboard.setBindings(bindings);
  }
  setReducedMotion(value: boolean): void { this.arenaView.reducedMotion = value; }
  resetTraining(): void { this.source?.resetTraining(); this.keyboard.clear(); }
  setDummyMoving(value: boolean): void { this.source?.setDummyMoving(value); }
  get matchState(): Readonly<MatchState> | null { return this.source?.state ?? null; }

  update(_time: number, delta: number): void {
    const source = this.source;
    if (source) {
      this.frame(source, delta);
    } else {
      this.arenaView.draw(null, 0, delta / 1000);
      this.weaponView.draw(null, 0);
      this.fieldView.draw(null, 0, delta / 1000);
    }
  }

  private frame(source: NetMatchSource, delta: number): void {
    netStats.frames++;
    this.keyboard.enabled = !this.suspended && source.state.phase === 'playing';
    if (source.state.config.mode === 'training') {
      const slot = this.keyboard.consumeWeaponSlot();
      if (slot !== null) source.selectTrainingWeapon(slot);
    }
    const events = source.advance(delta, (slot) => this.keyboard.sample(slot));
    this.externalAI?.update();
    this.arenaView.handle(events);
    this.fieldView.handle(events);
    for (const event of events) this.soundEffects.play(event);
    this.arenaView.draw(source.state, source.alpha, delta / 1000, source.localPoses);
    this.weaponView.draw(source.state, source.alpha, this.arenaView.weaponMounts, source.localPoses);
    this.fieldView.draw(source.state, source.alpha, delta / 1000);
    this.callbacks.onFrame(source.state);
    if (events.length) this.callbacks.onEvents(events);
  }
}

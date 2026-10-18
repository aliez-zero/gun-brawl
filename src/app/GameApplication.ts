import Phaser from 'phaser';
import { cloneCustomMatch, createCustomMatchConfig, createMatchConfig, validateCustomMatch } from '../content/matches';
import type { CustomMatchSettings } from '../content/matches';
import { normalizeAppearance } from '../content/appearances';
import { getArena, isMapId } from '../content/maps';
import { getWeapon, WEAPON_SLOTS } from '../content/weapons';
import type { BattleEvent, GameMode, MatchState, WeaponId } from '../game/core/types';
import { SoundEffects } from '../presentation/SoundEffects';
import { ArenaScene } from '../scenes/ArenaScene';
import { BootScene } from '../scenes/BootScene';
import { browserStorage, SaveStore } from '../storage/SaveStore';
import { GameUI } from '../ui/GameUI';

type Dialog = 'settings' | 'help' | 'appearance' | 'maps' | 'custom' | 'encyclopedia';
type Screen = 'menu' | 'match' | 'pause' | 'result' | Dialog;
const isDialog = (screen: Screen): screen is Dialog => ['settings', 'help', 'appearance', 'maps', 'custom', 'encyclopedia'].includes(screen);

export class GameApplication {
  private readonly store = new SaveStore(browserStorage());
  private readonly sound = new SoundEffects();
  private readonly ui: GameUI;
  private readonly arena: ArenaScene;
  private readonly game: Phaser.Game;
  private screen: Screen = 'menu';
  private returnScreen: 'menu' | 'pause' | 'result' = 'menu';
  private activeMode: GameMode = this.store.data.lastMode;
  private isReady = false;
  private storageNotified = false;

  constructor(root: HTMLElement) {
    this.ui = new GameUI(root, {
      start: (mode) => this.start(mode),
      pause: () => this.pause(),
      resume: () => this.resume(),
      restart: () => this.restart(),
      menu: () => this.menu(),
      settings: () => this.openDialog('settings'),
      help: () => this.openDialog('help'),
      appearance: () => this.openDialog('appearance'),
      maps: () => this.openDialog('maps'),
      close: () => this.closeDialog(),
      setAppearance: (slot, look) => {
        this.store.data.appearances[slot] = normalizeAppearance(look, this.store.data.appearances[slot]);
        this.persist(); this.refreshMenuPreview();
      },
      setMap: (id) => {
        if (!isMapId(id)) return;
        this.store.data.selectedMapId = id;
        this.persist(); this.refreshMenuPreview();
      },
      setVolume: (volume) => { this.sound.volume = volume; this.store.data.settings.volume = volume; this.persist(); this.sound.unlock(); },
      setReducedMotion: (value) => { this.arena.setReducedMotion(value); this.store.data.settings.reducedMotion = value; this.persist(); },
      setBindings: (bindings) => {
        this.store.data.bindings = bindings;
        this.arena.setBindings(bindings);
        this.persist();
      },
      startCustom: (settings) => this.startCustom(settings),
      resetTraining: () => { this.arena.resetTraining(); },
      setDummyMoving: (value) => { this.arena.setDummyMoving(value); },
      startTrainingWeapon: (weaponId) => this.startTrainingWeapon(weaponId),
      encyclopedia: () => this.openDialog('encyclopedia'),
      clearSave: () => this.clearSave(),
    }, this.store.data);
    this.arena = new ArenaScene({
      onReady: () => {
        this.isReady = true;
        this.arena.setReducedMotion(this.store.data.settings.reducedMotion);
        this.refreshMenuPreview();
        this.ui.setReady();
        this.notifyStorage();
      },
      onFrame: (state) => this.frame(state),
      onEvents: (events) => this.handleEvents(events),
      onPause: () => this.handleEscape(),
    }, this.sound, this.store.data.bindings);
    this.sound.volume = this.store.data.settings.volume;
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: 'game-canvas',
      width: 1280, height: 720,
      backgroundColor: '#151e19',
      antialias: true,
      powerPreference: 'high-performance',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [BootScene, this.arena],
      audio: { noAudio: true },
      input: { keyboard: false },
    });
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private start(mode: GameMode): void {
    if (!this.isReady) return;
    if (mode === 'custom') { this.openDialog('custom'); return; }
    this.sound.unlock();
    this.activeMode = mode;
    this.store.data.lastMode = mode;
    this.persist();
    this.screen = 'match';
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const matchId = crypto.randomUUID();
    this.arena.startMatch(createMatchConfig(mode, seed, {
      mapId: this.store.data.selectedMapId, appearances: this.store.data.appearances, matchId,
      trainingCompleted: this.store.data.trainingCompleted,
    }));
    this.ui.showMatch(this.arena.matchState!);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private startCustom(settings: CustomMatchSettings): void {
    if (!this.isReady) return;
    const errors = validateCustomMatch(settings);
    if (errors.length) { this.ui.notify(errors[0]!); return; }
    const normalized = cloneCustomMatch(settings);
    this.sound.unlock();
    this.activeMode = 'custom';
    this.store.data.lastMode = 'custom';
    this.store.data.customMatch = normalized;
    this.persist();
    this.screen = 'match';
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const matchId = crypto.randomUUID();
    this.arena.startMatch(createCustomMatchConfig(normalized, seed, {
      appearances: this.store.data.appearances, matchId,
    }));
    this.ui.showMatch(this.arena.matchState!);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private restart(): void {
    if (this.activeMode === 'custom') this.startCustom(this.store.data.customMatch);
    else this.start(this.activeMode);
  }

  private clearSave(): void {
    this.store.clear();
    this.arena.setBindings(this.store.data.bindings);
    this.arena.setReducedMotion(this.store.data.settings.reducedMotion);
    this.sound.volume = this.store.data.settings.volume;
    this.screen = 'menu';
    this.activeMode = this.store.data.lastMode;
    this.arena.showMenu();
    this.refreshMenuPreview();
    this.ui.showMenu();
    this.ui.notify(this.store.available ? '本地存档已清除' : '存档已重置，但本地存储不可写');
  }

  private startTrainingWeapon(weaponId: WeaponId): void {
    this.start('training');
    if (!this.isReady) return;
    const slot = WEAPON_SLOTS.indexOf(weaponId) + 1;
    if (slot > 0) {
      this.arena.selectTrainingWeapon(slot);
      this.ui.updateHUD(this.arena.matchState!);
    }
  }

  private frame(state: Readonly<MatchState>): void {
    if (this.screen === 'match') this.ui.updateHUD(state);
    if (state.config.mode === 'training' && state.training) {
      const completed = state.training.completedTasks;
      if (completed.length !== this.store.data.trainingCompleted.length) {
        this.store.data.trainingCompleted = [...completed];
        this.persist();
        this.ui.notify(`训练任务完成 ${completed.length}/6`);
      }
    }
  }

  private handleEvents(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'finished') {
        this.screen = 'result';
        this.store.recordResult(event.result);
        this.notifyStorage();
        this.ui.showResult(event.result);
      }
      if (event.type === 'overtime') this.ui.notify('进入决胜加时，每人只剩一条命！');
      if (event.type === 'pickup') {
        const actor = this.arena.matchState?.actors.find((candidate) => candidate.config.id === event.actorId);
        this.ui.notify(`${actor?.config.name ?? '玩家'} 拾取 ${getWeapon(event.weaponId).name}`);
      }
    }
  }

  private pause(): void {
    if (this.screen !== 'match') return;
    this.arena.pauseMatch();
    this.screen = 'pause';
    this.ui.showPause();
  }

  private resume(): void {
    if (this.screen !== 'pause') return;
    this.sound.unlock();
    this.screen = 'match';
    this.arena.resumeMatch();
    this.ui.showMatch(this.arena.matchState!);
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private menu(): void {
    if (!this.isReady) return;
    this.screen = 'menu';
    this.arena.showMenu();
    this.refreshMenuPreview();
    this.ui.showMenu();
  }

  private openDialog(kind: Dialog): void {
    if (!this.isReady) return;
    if (isDialog(this.screen)) { this.screen = kind; }
    else {
      if (this.screen === 'match') this.pause();
      this.returnScreen = this.screen === 'pause' ? 'pause' : this.screen === 'result' ? 'result' : 'menu';
      this.screen = kind;
    }
    if (kind === 'settings') this.ui.showSettings();
    else if (kind === 'help') this.ui.showHelp();
    else if (kind === 'appearance') this.ui.showAppearance(this.returnScreen !== 'menu');
    else if (kind === 'custom') this.ui.showCustomSetup(this.store.data.customMatch);
    else if (kind === 'encyclopedia') this.ui.showEncyclopedia();
    else this.ui.showMaps(this.returnScreen !== 'menu');
  }

  private closeDialog(): void {
    if (!isDialog(this.screen)) return;
    this.screen = this.returnScreen;
    if (this.screen === 'pause') this.ui.showPause();
    else if (this.screen === 'result' && this.arena.matchState?.result) this.ui.showResult(this.arena.matchState.result);
    else this.menu();
  }

  private handleEscape(): void {
    if (this.screen === 'match') this.pause();
    else if (this.screen === 'pause') this.resume();
    else this.closeDialog();
  }

  private readonly onBlur = (): void => { this.pause(); };
  private readonly onVisibility = (): void => { if (document.hidden) this.pause(); };

  private refreshMenuPreview(): void {
    if (this.isReady && (this.screen === 'menu' || (isDialog(this.screen) && this.returnScreen === 'menu'))) {
      this.arena.setMenuPreview(getArena(this.store.data.selectedMapId), this.store.data.appearances);
    }
  }

  private persist(): void { this.store.persist(); this.notifyStorage(); }
  private notifyStorage(): void {
    if (!this.store.available && !this.storageNotified) {
      this.storageNotified = true;
      this.ui.notify('本地保存不可用，当前设置和战绩仅本次有效。');
    }
  }

  destroy(): void {
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ui.destroy();
    this.sound.destroy();
    this.game.destroy(true);
  }
}

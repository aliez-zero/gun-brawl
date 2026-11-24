import Phaser from 'phaser';
import { cloneCustomMatch, createCustomMatchConfig, createDeepSeekMatchConfig, createMatchConfig, validateCustomMatch } from '../content/matches';
import { closeDeepSeekSession, getDeepSeekInfo, openDeepSeekSession } from '../adapters/ai/DeepSeekClient';
import type { DeepSeekInfo, DeepSeekSession } from '../adapters/ai/DeepSeekClient';
import type { CustomMatchSettings, MatchSelections } from '../content/matches';
import { CAMPAIGN_LEVELS, createCampaignConfig, getCampaignLevel } from '../content/campaign';
import { normalizeAppearance } from '../content/appearances';
import { getArena, isMapId } from '../content/maps';
import { getWeapon } from '../content/weapons';
import type { BattleEvent, GameMode, MatchConfig, MatchResult, MatchState, WeaponId } from '../game/core/types';
import { SoundEffects } from '../presentation/SoundEffects';
import { MusicPlayer } from '../presentation/music/MusicPlayer';
import { normalizeMusic, sceneMusic } from '../content/music';
import type { MusicSettings } from '../content/music';
import { ArenaScene } from '../scenes/ArenaScene';
import { NetClient } from '../net/NetClient';
import { NetMatchSource } from '../net/NetMatchSource';
import { netStats } from '../net/NetStats';
import { Predictor } from '../net/Predictor';
import type { MatchResultWire, RoomView } from '../net/protocol';
import { PHASE_COUNTDOWN, PHASE_LOBBY, PHASE_PLAYING } from '../net/protocol';
import { BootScene } from '../scenes/BootScene';
import { randomId } from '../ids';
import { browserStorage, SaveStore } from '../storage/SaveStore';
import { GameUI } from '../ui/GameUI';
import { gameServerUrl, PrivateMatchSession, type PrivateMatchOptions } from './PrivateMatchSession';

type Dialog = 'settings' | 'help' | 'appearance' | 'maps' | 'custom' | 'encyclopedia' | 'campaign' | 'deepseek' | 'online';
type Screen = 'menu' | 'connecting' | 'match' | 'pause' | 'result' | Dialog;
const isDialog = (screen: Screen): screen is Dialog => ['settings', 'help', 'appearance', 'maps', 'custom', 'encyclopedia', 'campaign', 'deepseek', 'online'].includes(screen);

const newSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

export class GameApplication {
  private readonly store = new SaveStore(browserStorage());
  private readonly sound = new SoundEffects();
  private readonly music = new MusicPlayer();
  private readonly audioListeners = new AbortController();
  private readonly ui: GameUI;
  private readonly arena: ArenaScene;
  private readonly game: Phaser.Game;
  private screen: Screen = 'menu';
  private returnScreen: 'menu' | 'pause' | 'result' = 'menu';
  private activeMode: GameMode = this.store.data.lastMode;
  private activeCampaignLevel: string | null = null;
  private isReady = false;
  private storageNotified = false;
  private deepSeekActive = false;
  private deepSeekInfo: DeepSeekInfo | null = null;
  private deepSeekSetupRequest: AbortController | null = null;
  private privateMatch: PrivateMatchSession | null = null;
  private online: NetClient | null = null;
  private connectingOnline: Promise<NetClient> | null = null;
  private onlineSource: NetMatchSource | null = null;
  private onlineRoom: RoomView | null = null;
  private onlineStatus = '';
  private predictor: Predictor | null = null;
  private predictorPromise: Promise<Predictor | null> | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private reconnecting = false;

  constructor(root: HTMLElement) {
    this.ui = new GameUI(root, {
      deepseek: () => this.openDialog('deepseek'),
      startDeepSeek: () => { void this.startDeepSeek(); },
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
      setMusic: (settings) => this.setMusic(settings),
      toggleMusic: () => this.setMusic({ enabled: !this.store.data.settings.music.enabled }),
      setReducedMotion: (value) => { this.arena.setReducedMotion(value); this.store.data.settings.reducedMotion = value; this.persist(); },
      setBindings: (bindings) => {
        this.store.data.bindings = bindings;
        this.arena.setBindings(bindings);
        this.persist();
      },
      startCustom: (settings) => this.startCustom(settings),
      resetTraining: () => { this.arena.resetTraining(); },
      setDummyMoving: (value) => { this.arena.setDummyMoving(value); },
      startTrainingWeapon: (weaponId) => this.start('training', weaponId),
      dismissTrainingIntro: () => {
        this.store.data.trainingIntroSeen = true;
        this.persist();
      },
      encyclopedia: () => this.openDialog('encyclopedia'),
      clearSave: () => this.clearSave(),
      selectCampaign: (levelId) => this.startCampaign(levelId),
      nextCampaign: () => this.nextCampaign(),
      campaignSelect: () => this.openDialog('campaign'),
      online: () => { void this.openOnline(); },
      onlineCreate: (name, map, stocks, duration) => { void this.createOnlineRoom(name, map, stocks, duration); },
      onlineJoin: (name, code) => { void this.joinOnlineRoom(name, code); },
      onlineReady: (ready) => { this.online?.ready(ready); },
      onlineStart: () => { this.online?.start(); },
      onlineLeave: () => this.leaveOnline(),
      onlineRematch: () => { this.online?.rematch(); },
      onlineBot: (slot) => { this.online?.pickSlot(slot, 2, 1); },
    }, this.store.data);
    this.arena = new ArenaScene({
      onReady: () => {
        this.isReady = true;
        this.arena.setReducedMotion(this.store.data.settings.reducedMotion);
        this.refreshMenuPreview();
        this.ui.setReady();
        this.syncMusic();
        this.notifyStorage();
        this.loadPredictor();
      },
      onFrame: (state) => this.frame(state),
      onEvents: (events) => this.handleEvents(events),
      onPause: () => this.handleEscape(),
      onExternalAI: (value) => this.ui.updateExternalAI(value),
    }, this.sound, this.store.data.bindings);
    this.sound.volume = this.store.data.settings.volume;
    this.music.onChange = (status) => this.ui.updateMusic(status);
    this.music.configure(this.store.data.settings.music);
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
    const signal = this.audioListeners.signal;
    window.addEventListener('pointerdown', this.onAudioGesture, { capture: true, signal });
    window.addEventListener('keydown', this.onAudioGesture, { capture: true, signal });
    window.addEventListener('focus', this.onAudioFocus, { signal });
    // Test hook for the online smoke: forces a socket drop without a server restart.
    (window as unknown as {
      __gunbrawlDebug?: {
        dropConnection: () => void;
        netStats: () => Record<string, number>;
      };
    }).__gunbrawlDebug = {
      dropConnection: () => (this.privateMatch ?? this.online)?.dropConnection(),
      netStats: () => netStats.snapshot(),
    };
  }

  private selections(matchId = randomId()): MatchSelections {
    return {
      mapId: this.store.data.selectedMapId,
      appearances: this.store.data.appearances,
      trainingCompleted: this.store.data.trainingCompleted,
      matchId,
    };
  }

  private start(mode: GameMode, trainingWeapon?: WeaponId): void {
    if (!this.isReady) return;
    if (mode === 'custom') { this.openDialog('custom'); return; }
    if (mode === 'campaign') { this.openDialog('campaign'); return; }
    this.startPrivate(createMatchConfig(mode, newSeed(), this.selections()), { trainingWeapon });
  }

  private startCustom(settings: CustomMatchSettings): void {
    if (!this.isReady) return;
    const errors = validateCustomMatch(settings);
    if (errors.length) { this.ui.notify(errors[0]!); return; }
    this.store.data.customMatch = cloneCustomMatch(settings);
    this.startPrivate(createCustomMatchConfig(this.store.data.customMatch, newSeed(), this.selections()));
  }

  private startCampaign(levelId: string): void {
    if (!this.isReady) return;
    const level = getCampaignLevel(levelId);
    if (!level) { this.ui.notify('无效的战役关卡'); return; }
    if (this.store.data.campaign.unlocked < level.order) { this.ui.notify('先通关上一关才能解锁'); return; }
    this.startPrivate(createCampaignConfig(level, newSeed(), this.selections()));
  }

  private startPrivate(config: MatchConfig, options: PrivateMatchOptions = {}): void {
    this.cancelDeepSeekSetup();
    this.leavePrivateSession();
    this.leaveOnlineSession();
    this.arena.showMenu();
    this.sound.unlock();
    this.activeMode = config.mode;
    this.activeCampaignLevel = config.campaignLevelId ?? null;
    this.deepSeekActive = Boolean(options.deepSeek);
    if (!options.deepSeek) {
      this.store.data.lastMode = config.mode;
      this.persist();
    }
    this.screen = 'connecting';
    this.ui.showConnecting();
    this.syncMusic();
    this.privateMatch = new PrivateMatchSession(config, options, {
      predictor: () => this.predictor,
      onStart: (source, session) => {
        this.enterMatch(source, session);
        if (document.hidden || !document.hasFocus()) this.pause();
      },
      onResult: (result) => this.finishMatch(result),
      onLatency: () => this.updateNetStatus(),
      onError: (message) => {
        this.menu();
        this.ui.notify(`无法继续对局，${message}。请确认游戏服务已启动后重试。`);
      },
    });
    void this.privateMatch.start();
  }

  private leavePrivateSession(): void {
    this.privateMatch?.dispose();
    this.privateMatch = null;
    this.deepSeekActive = false;
  }

  private enterMatch(source: NetMatchSource, session?: DeepSeekSession): void {
    this.screen = 'match';
    this.arena.startMatch(source, session);
    this.ui.showMatch(source.state, Boolean(this.onlineSource));
    this.updateNetStatus();
    this.syncMusic();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private nextCampaign(): void {
    if (!this.activeCampaignLevel) return;
    const current = getCampaignLevel(this.activeCampaignLevel);
    const next = current ? CAMPAIGN_LEVELS.find((level) => level.order === current.order + 1) : undefined;
    if (!next) { this.ui.notify('已经是最后一关'); return; }
    this.startCampaign(next.id);
  }

  private restart(): void {
    if (this.onlineSource) {
      this.showOnlineRoom();
      if (this.online && this.online.playerId === this.onlineRoom?.host) this.online.rematch();
    } else if (this.deepSeekActive) {
      this.returnScreen = this.screen === 'result' ? 'result' : 'pause';
      this.screen = 'deepseek';
      void this.startDeepSeek();
    }
    else if (this.activeMode === 'custom') this.startCustom(this.store.data.customMatch);
    else if (this.activeMode === 'campaign' && this.activeCampaignLevel) this.startCampaign(this.activeCampaignLevel);
    else this.start(this.activeMode);
  }

  private cancelDeepSeekSetup(): void {
    this.deepSeekSetupRequest?.abort(); this.deepSeekSetupRequest = null;
  }

  private async refreshDeepSeek(): Promise<void> {
    this.cancelDeepSeekSetup();
    const request = new AbortController(); this.deepSeekSetupRequest = request;
    this.ui.showDeepSeekSetup(null);
    const timer = setTimeout(() => request.abort(), 6000);
    try {
      const info = await getDeepSeekInfo(request.signal);
      if (this.deepSeekSetupRequest !== request || this.screen !== 'deepseek') return;
      this.deepSeekInfo = info; this.ui.showDeepSeekSetup(info);
    } catch {
      if (this.deepSeekSetupRequest === request && this.screen === 'deepseek') this.ui.showDeepSeekSetup(null, '无法连接 AI 服务，请确认游戏服务已启动');
    } finally { clearTimeout(timer); }
  }

  private async startDeepSeek(): Promise<void> {
    if (!this.isReady || this.screen !== 'deepseek' || !this.deepSeekInfo?.configured) return;
    this.cancelDeepSeekSetup();
    const request = new AbortController(); this.deepSeekSetupRequest = request;
    this.ui.showDeepSeekSetup(this.deepSeekInfo, null, true);
    const matchId = randomId();
    const seed = newSeed();
    const timer = setTimeout(() => request.abort(), 6000);
    try {
      const session = await openDeepSeekSession(matchId, 'deepseek', request.signal);
      if (this.deepSeekSetupRequest !== request || this.screen !== 'deepseek') {
        void closeDeepSeekSession(session.sessionId).catch(() => {}); return;
      }
      this.startPrivate(createDeepSeekMatchConfig(seed, this.selections(matchId)), { deepSeek: session });
    } catch (error) {
      if (this.deepSeekSetupRequest === request && this.screen === 'deepseek') this.ui.showDeepSeekSetup(this.deepSeekInfo, error instanceof Error ? error.message : '无法连接 DeepSeek');
    } finally { clearTimeout(timer); }
  }

  /** Warm up the WASM predictor; online play silently falls back if it fails. */
  private loadPredictor(): void {
    if (this.predictorPromise) return;
    this.predictorPromise = Predictor.load();
    void this.predictorPromise.then((predictor) => {
      this.predictor = predictor;
      document.body.dataset.predictor = predictor ? 'ready' : 'off';
    });
  }

  /** Online lobby: connect once, then create or join a room. */
  private async openOnline(): Promise<void> {
    if (!this.isReady) return;
    if (this.screen === 'connecting') this.menu();
    this.cancelDeepSeekSetup();
    if (this.screen === 'match' && !this.onlineSource) this.pause();
    this.returnScreen = this.screen === 'pause' ? 'pause' : this.screen === 'result' ? 'result' : 'menu';
    this.screen = 'online';
    this.onlineStatus = '正在连接服务器…';
    this.ui.showOnline(this.onlineRoom, this.online?.playerId ?? 0, this.onlineStatus);
    this.updateNetStatus();
    this.syncMusic();
    try {
      await this.ensureOnline();
      this.onlineStatus = '已连接，创建或加入房间。';
    } catch (error) {
      this.onlineStatus = error instanceof Error ? error.message : '连接失败';
    }
    if (this.screen === 'online') {
      this.refreshOnline();
    }
  }

  /**
   * Re-render the lobby for room changes, but only touch the status line while there
   * is no room yet — otherwise the connect/reconnect status would wipe whatever the
   * player has typed into the name and room-code fields.
   */
  private refreshOnline(): void {
    if (this.onlineRoom) this.ui.showOnline(this.onlineRoom, this.online?.playerId ?? 0, this.onlineStatus);
    else this.ui.updateOnlineStatus(this.onlineStatus);
    this.updateNetStatus();
  }

  private async ensureOnline(): Promise<NetClient> {
    if (this.connectingOnline) return this.connectingOnline;
    if (this.online?.connected) return this.online;
    const client: NetClient = this.online ?? new NetClient({
      onRoom: (room) => this.handleOnlineRoom(room),
      onSnapshot: (snapshot) => this.onlineSource?.applySnapshot(snapshot),
      onMatchEnd: (result) => this.handleOnlineEnd(result),
      onStatus: (status, detail) => {
        if (this.online !== client) return;
        this.onlineStatus = detail ?? ({ connecting: '正在连接…', open: '已连接', closed: '连接已断开', error: '连接失败' }[status] ?? '');
        document.body.dataset.net = status;
        if (status === 'open') this.reconnectAttempts = 0;
        if (status === 'closed' && this.onlineSource) {
          this.onlineSource.resetConnection();
          if (!this.reconnecting) this.scheduleReconnect();
        }
        if (this.screen === 'online') this.refreshOnline();
        else this.updateNetStatus();
      },
      onLatency: () => this.updateNetStatus(),
    });
    this.online = client;
    const connection = client.connect(gameServerUrl()).then(() => client);
    this.connectingOnline = connection;
    try { return await connection; }
    finally { if (this.connectingOnline === connection) this.connectingOnline = null; }
  }

  /** Reconnect with backoff; the server replays room state by device token. */
  private scheduleReconnect(): void {
    const client = this.online;
    if (!client || this.reconnectTimer !== null) return;
    if (this.reconnectAttempts >= 5) {
      this.reconnecting = false;
      this.ui.notify('重连失败，已离开房间');
      this.leaveOnline();
      return;
    }
    this.reconnecting = true;
    const delay = 800 * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;
    this.onlineStatus = `连接断开，${(delay / 1000).toFixed(1)} 秒后重连…`;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.ensureOnline()
        .then(() => {
          if (this.online !== client) return;
          this.reconnecting = false;
          this.onlineStatus = '已重连';
        })
        .catch(() => {
          if (this.online !== client) return;
          this.reconnecting = false;
          this.scheduleReconnect();
        });
    }, delay);
  }

  private async createOnlineRoom(name: string, map: string, stocks: number, duration: number): Promise<void> {
    try {
      const client = await this.ensureOnline();
      if (this.screen !== 'online' || this.online !== client) return;
      client.createRoom(name || client.name, map, stocks, duration, 0);
      this.onlineStatus = '正在创建房间…';
    } catch (error) {
      this.onlineStatus = error instanceof Error ? error.message : '连接失败';
    }
    if (this.screen === 'online') this.refreshOnline();
  }

  private async joinOnlineRoom(name: string, code: string): Promise<void> {
    try {
      const client = await this.ensureOnline();
      if (this.screen !== 'online' || this.online !== client) return;
      if (!code) { this.onlineStatus = '请输入房间码'; } else { client.joinRoom(code, name || client.name); this.onlineStatus = '正在加入房间…'; }
    } catch (error) {
      this.onlineStatus = error instanceof Error ? error.message : '连接失败';
    }
    if (this.screen === 'online') this.refreshOnline();
  }

  private handleOnlineRoom(room: RoomView): void {
    this.onlineRoom = room;
    if (room.phase === PHASE_LOBBY && this.onlineSource) {
      this.onlineSource.dispose();
      this.onlineSource = null;
      this.arena.showMenu();
      this.showOnlineRoom();
      this.refreshMenuPreview();
      return;
    }
    if ((room.phase === PHASE_COUNTDOWN || room.phase === PHASE_PLAYING) && !this.onlineSource) {
      this.startOnlineMatch(room);
      return;
    }
    if (this.screen === 'online') this.refreshOnline();
  }

  private showOnlineRoom(): void {
    this.returnScreen = 'menu';
    this.screen = 'online';
    this.refreshOnline();
    this.syncMusic();
  }

  private startOnlineMatch(room: RoomView): void {
    if (!this.online) return;
    const source = new NetMatchSource(this.online, room, this.predictor);
    this.leavePrivateSession();
    this.onlineSource = source;
    this.sound.unlock();
    this.enterMatch(source);
  }

  private handleOnlineEnd(result: MatchResultWire): void {
    if (this.onlineSource && !this.onlineSource.state.result) this.finishMatch(this.onlineSource.finish(result));
  }

  private finishMatch(result: MatchResult): void {
    this.arena.finishMatch();
    this.screen = 'result';
    if (!this.onlineSource) {
      if (result.mode === 'campaign') {
        if (this.store.recordCampaignResult(result)) this.ui.notify('关卡通过，下一关已解锁');
      } else {
        this.store.recordResult(result);
      }
      this.notifyStorage();
    }
    this.ui.showResult(result, Boolean(this.onlineSource));
    this.syncMusic();
  }

  private leaveOnlineSession(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.onlineSource?.dispose();
    this.onlineSource = null;
    const client = this.online;
    this.online = null;
    this.connectingOnline = null;
    if (client) {
      client.leave();
      client.disconnect();
    }
    this.onlineRoom = null;
  }

  private leaveOnline(): void {
    this.onlineStatus = '已离开房间';
    this.menu();
  }

  private updateNetStatus(): void {
    if (this.screen !== 'online' && this.screen !== 'match') return;
    const online = this.screen === 'online' || this.onlineSource !== null;
    const client = online ? this.online : null;
    const latency = online ? client?.latency : this.privateMatch?.latency;
    let text = '延迟检测中…';
    if (latency) {
      text = `延迟 ${Math.round(latency.rtt)} ms · 抖动 ${Math.round(latency.jitter)} ms`;
    } else if (client && this.reconnecting && !client.connected) {
      text = '正在重连…';
    } else if (client?.status === 'closed' || client?.status === 'error') {
      text = '延迟不可用';
    }
    this.ui.updateNetStatus(text);
  }

  private clearSave(): void {
    this.store.clear();
    this.arena.setBindings(this.store.data.bindings);
    this.arena.setReducedMotion(this.store.data.settings.reducedMotion);
    this.sound.volume = this.store.data.settings.volume;
    this.music.configure(this.store.data.settings.music);
    this.activeMode = this.store.data.lastMode;
    this.menu();
    this.ui.notify(this.store.available ? '本地存档已清除' : '存档已重置，但本地存储不可写');
  }

  private frame(state: Readonly<MatchState>): void {
    if (this.screen === 'match') this.ui.updateHUD(state);
    if (state.config.mode === 'training' && state.training) {
      const completed = state.training.completedTasks;
      const saved = this.store.data.trainingCompleted;
      if (completed.some((task) => !saved.includes(task))) {
        this.store.data.trainingCompleted = [...new Set([...saved, ...completed])];
        this.persist();
        this.ui.notify(`训练任务完成 ${this.store.data.trainingCompleted.length}/6`);
      }
    }
  }

  private handleEvents(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'overtime') this.ui.notify('进入决胜加时，每人只剩一条命！');
      if (event.type === 'pickup') {
        const actor = this.arena.matchState?.actors.find((candidate) => candidate.config.id === event.actorId);
        this.ui.notify(`${actor?.config.name ?? '玩家'} 拾取 ${getWeapon(event.weaponId).name}`);
      }
    }
  }

  private pause(): void {
    if (this.screen !== 'match') return;
    if (this.onlineSource) { this.leaveOnline(); return; }
    this.arena.pauseMatch();
    this.screen = 'pause';
    this.ui.showPause();
    this.syncMusic();
  }

  private resume(): void {
    if (this.screen !== 'pause') return;
    this.sound.unlock();
    this.screen = 'match';
    this.arena.resumeMatch();
    this.ui.showMatch(this.arena.matchState!);
    this.updateNetStatus();
    this.syncMusic();
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private menu(): void {
    if (!this.isReady) return;
    this.cancelDeepSeekSetup();
    this.leavePrivateSession();
    this.leaveOnlineSession();
    this.screen = 'menu';
    this.arena.showMenu();
    this.refreshMenuPreview();
    this.ui.showMenu();
    this.syncMusic();
  }

  private openDialog(kind: Dialog): void {
    if (!this.isReady) return;
    if (this.screen === 'connecting') this.menu();
    this.cancelDeepSeekSetup();
    if (isDialog(this.screen)) { this.screen = kind; }
    else {
      if (this.screen === 'match') this.pause();
      this.returnScreen = this.screen === 'pause' ? 'pause' : this.screen === 'result' ? 'result' : 'menu';
      this.screen = kind;
    }
    if (kind === 'settings') { this.ui.showSettings(); this.ui.updateMusic(this.music.status); }
    else if (kind === 'deepseek') { void this.refreshDeepSeek(); }
    else if (kind === 'help') this.ui.showHelp();
    else if (kind === 'appearance') this.ui.showAppearance(this.returnScreen !== 'menu');
    else if (kind === 'custom') this.ui.showCustomSetup(this.store.data.customMatch);
    else if (kind === 'encyclopedia') this.ui.showEncyclopedia();
    else if (kind === 'campaign') this.ui.showCampaign(this.store.data.campaign);
    else this.ui.showMaps(this.returnScreen !== 'menu');
    this.syncMusic();
  }

  private closeDialog(): void {
    if (!isDialog(this.screen)) return;
    this.cancelDeepSeekSetup();
    this.screen = this.returnScreen;
    if (this.screen === 'pause') this.ui.showPause();
    else if (this.screen === 'result' && this.arena.matchState?.result) this.ui.showResult(this.arena.matchState.result, Boolean(this.onlineSource));
    else this.menu();
    this.syncMusic();
  }

  private handleEscape(): void {
    if (this.screen === 'match') this.pause();
    else if (this.screen === 'pause') this.resume();
    else if (this.screen === 'online') this.leaveOnline();
    else if (this.screen === 'connecting') this.menu();
    else this.closeDialog();
  }

  private readonly onBlur = (): void => { if (!this.onlineSource) this.pause(); this.music.setPaused(true); };
  private readonly onVisibility = (): void => { if (document.hidden && !this.onlineSource) this.pause(); this.syncMusic(); };
  private readonly onAudioFocus = (): void => { this.syncMusic(); };
  private readonly onAudioGesture = (): void => { void this.music.unlock(); };

  private setMusic(patch: Partial<MusicSettings>): void {
    this.store.data.settings.music = normalizeMusic({ ...this.store.data.settings.music, ...patch });
    this.syncMusic(); this.music.configure(this.store.data.settings.music);
    this.persist(); void this.music.unlock();
  }

  private syncMusic(): void {
    const inBattle = this.screen === 'match' || this.screen === 'pause' || (isDialog(this.screen) && this.returnScreen === 'pause');
    const paused = document.hidden || !document.hasFocus() || (inBattle && this.screen !== 'match');
    if (paused) this.music.setPaused(true);
    const map = inBattle ? this.arena.matchState?.config.map.id ?? this.store.data.selectedMapId : this.store.data.selectedMapId;
    this.music.setTrack(sceneMusic(this.store.data.settings.music.track, inBattle, map));
    if (!paused) this.music.setPaused(false);
  }

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
    this.cancelDeepSeekSetup();
    this.leavePrivateSession();
    this.leaveOnlineSession();
    this.audioListeners.abort();
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ui.destroy();
    this.sound.destroy();
    this.music.destroy();
    this.game.destroy(true);
  }
}

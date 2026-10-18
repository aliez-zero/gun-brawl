import { BINDING_ACTIONS, cloneBindings, keyLabel, rebind } from '../content/controls';
import type { ControlAction, KeyBindings } from '../content/controls';
import { TRAINING_TASKS } from '../content/tutorial';
import { ARMORY_WEAPONS, weaponBurstImpulse, weaponRole, weaponSustainedImpulse } from '../content/weapons';
import { createWeaponIconCanvas } from '../presentation/WeaponArt';
import {
  CUSTOM_MAP_OPTIONS, CUSTOM_MATCH_LIMITS, DIFFICULTY_LABELS, MODE_LABELS, cloneCustomMatch, validateCustomMatch,
} from '../content/matches';
import type { CustomMatchSettings, CustomSlot } from '../content/matches';
import { APPEARANCE_PRESETS, isCharacterStyle, normalizeAppearance, presetAppearance } from '../content/appearances';
import { CAMPAIGN_LEVELS, getCampaignLevel } from '../content/campaign';
import type { CampaignProgress } from '../content/campaign';
import { getArena, isMapId } from '../content/maps';
import type { CharacterAppearance, Difficulty, DropMode, GameMode, HumanSlot, MatchResult, MatchState, WeaponId } from '../game/core/types';
import { isGameMode } from '../storage/SaveStore';
import type { SaveData } from '../storage/SaveStore';
import { appearanceEditor, drawAppearancePreviews } from './appearance/AppearanceEditor';
import { drawMapPreviews, mapPicker } from './maps/MapPicker';

export interface UIActions {
  start: (mode: GameMode) => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  menu: () => void;
  settings: () => void;
  help: () => void;
  appearance: () => void;
  maps: () => void;
  close: () => void;
  setAppearance: (slot: HumanSlot, look: CharacterAppearance) => void;
  setMap: (id: string) => void;
  setVolume: (volume: number) => void;
  setReducedMotion: (value: boolean) => void;
  setBindings: (bindings: KeyBindings) => void;
  startCustom: (settings: CustomMatchSettings) => void;
  resetTraining: () => void;
  setDummyMoving: (value: boolean) => void;
  startTrainingWeapon: (weaponId: WeaponId) => void;
  dismissTrainingIntro: () => void;
  encyclopedia: () => void;
  clearSave: () => void;
  selectCampaign: (levelId: string) => void;
  nextCampaign: () => void;
  campaignSelect: () => void;
}

export class GameUI {
  private readonly overlay: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toast: HTMLElement;
  private selected: GameMode;
  private hudReady = false;
  private lastPhase = '';
  private readonly weaponIcons = new Map<string, string>();
  private ready = false;
  private editingSlot: HumanSlot = 1;
  private editNextRound = false;
  private readonly mapLabel: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBinding: { slot: HumanSlot; action: ControlAction } | null = null;
  private trainingDummyMoving = true;
  private lastTrainingWeaponId: WeaponId = 'pistol';
  private trainingIntroDismissed = false;
  private readonly listeners = new AbortController();

  constructor(root: HTMLElement, private readonly actions: UIActions, private readonly save: SaveData) {
    this.selected = save.lastMode;
    root.innerHTML = `
      <div class="app-shell">
        <header class="site-header">
          <a class="brand" href="#" aria-label="混枪大乱战，返回主菜单" data-action="menu">
            <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
            <span>混枪大乱战<small>GUN BRAWL / LOCAL ARENA</small></span>
          </a>
          <nav aria-label="游戏导航">
            <span class="build-tag"><i></i> READY TO RUMBLE</span>
            <button class="text-button" data-action="appearance">角色外观 <span aria-hidden="true">✦</span></button>
            <button class="text-button" data-action="help">操作说明 <span aria-hidden="true">↗</span></button>
            <button class="text-button" data-action="settings">设置 <span aria-hidden="true">⚙</span></button>
          </nav>
        </header>
        <main>
          <div class="stage-topline"><span><i></i> 平台乱斗 / 本地同屏</span><span id="current-map-label"></span></div>
          <section class="arena-shell" aria-label="游戏区域">
            <div id="game-canvas"></div>
            <div id="game-overlay"></div>
            <div class="toast" role="status" aria-live="polite" hidden></div>
          </section>
          <div class="control-strip"><div id="match-status"></div><div id="control-guide"></div></div>
          <div class="mobile-note">建议使用电脑和键盘体验。两位玩家可以在同一台电脑上对战。</div>
        </main>
        <footer class="site-footer"><span>高台有优势，边缘有代价。</span><span>跳跃 · 开火 · 把对手送出场外 <b>↗</b></span></footer>
      </div>`;
    this.overlay = root.querySelector('#game-overlay')!;
    this.footer = root.querySelector('#control-guide')!;
    this.status = root.querySelector('#match-status')!;
    this.toast = root.querySelector('.toast')!;
    this.mapLabel = root.querySelector('#current-map-label')!;
    root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-action]');
      if (!button || button.hasAttribute('disabled')) return;
      event.preventDefault();
      const action = button.dataset.action;
      const mode = button.dataset.mode;
      if (action === 'mode' && isGameMode(mode)) { this.selected = mode; this.showMenu(); return; }
      if (action === 'start') { this.actions.start(this.selected); return; }
      if (action === 'rebind') {
        const slot = Number(button.dataset.slot) as HumanSlot;
        const control = button.dataset.control as ControlAction;
        if ((slot === 1 || slot === 2) && BINDING_ACTIONS.some((entry) => entry.action === control)) {
          this.pendingBinding = { slot, action: control };
          this.overlay.querySelectorAll('.binding-key.listening').forEach((key) => key.classList.remove('listening'));
          button.classList.add('listening');
          button.textContent = '按下新键…';
          const hint = this.overlay.querySelector<HTMLElement>('#binding-status');
          if (hint) hint.textContent = '按下新键；Esc 取消。冲突键不会保存。';
        }
        return;
      }
      if (action === 'reset-bindings') {
        this.pendingBinding = null;
        this.actions.setBindings(cloneBindings());
        this.setGuide(this.selected);
        this.showSettings();
        return;
      }
      if (action !== 'rebind') this.pendingBinding = null;
      if (action === 'start-custom') {
        const settings = this.readCustomSettings();
        const errors = validateCustomMatch(settings);
        if (errors.length) { this.showCustomErrors(errors); return; }
        this.actions.startCustom(settings);
        return;
      }
      if (action === 'reset-training') { this.actions.resetTraining(); return; }
      if (action === 'dummy-toggle') {
        this.trainingDummyMoving = !this.trainingDummyMoving;
        this.actions.setDummyMoving(this.trainingDummyMoving);
        const toggle = this.overlay.querySelector<HTMLElement>('[data-action="dummy-toggle"]');
        if (toggle) toggle.textContent = this.trainingDummyMoving ? '假人：移动中' : '假人：静止';
        return;
      }
      if (action === 'dismiss-training-intro') {
        this.trainingIntroDismissed = true;
        this.actions.dismissTrainingIntro();
        this.overlay.querySelector('#training-intro')?.remove();
        return;
      }
      if (action === 'encyclopedia') { this.actions.encyclopedia(); return; }
      if (action === 'next-campaign') { this.actions.nextCampaign(); return; }
      if (action === 'campaign-select') { this.actions.campaignSelect(); return; }
      if (action === 'campaign-level') {
        const id = button.dataset.level;
        if (id) this.actions.selectCampaign(id);
        return;
      }
      if (action === 'clear-save') {
        if (window.confirm('清除本地存档？音量、键位、外观、自定义配置、训练进度和战绩都会恢复默认。')) this.actions.clearSave();
        return;
      }
      if (action === 'train-weapon') {
        const weaponId = button.dataset.weapon as WeaponId;
        if (ARMORY_WEAPONS.some((weapon) => weapon.id === weaponId)) {
          this.lastTrainingWeaponId = weaponId;
          this.actions.startTrainingWeapon(weaponId);
        }
        return;
      }
      if (action === 'appearance-slot') {
        if (button.dataset.slot === '1' || button.dataset.slot === '2') this.editingSlot = Number(button.dataset.slot) as HumanSlot;
        this.showAppearance(this.editNextRound); return;
      }
      if (action === 'look-preset' && isCharacterStyle(button.dataset.value)) {
        this.actions.setAppearance(this.editingSlot, presetAppearance(button.dataset.value));
        this.refreshAppearance(button); return;
      }
      if (action === 'look-field') {
        const field = button.dataset.field;
        if (field === 'hat' || field === 'outfit' || field === 'color' || field === 'skin') {
          const current = this.save.appearances[this.editingSlot];
          const value = field === 'color' || field === 'skin' ? Number(button.dataset.value) : button.dataset.value;
          this.actions.setAppearance(this.editingSlot, normalizeAppearance({ ...current, [field]: value }, current));
          this.refreshAppearance(button);
        }
        return;
      }
      if (action === 'select-map' && isMapId(button.dataset.map)) {
        this.actions.setMap(button.dataset.map);
        this.showMaps(this.editNextRound);
        this.overlay.querySelector<HTMLButtonElement>(`[data-map="${button.dataset.map}"]`)?.focus({ preventScroll: true });
        return;
      }
      if (action && action in this.actions) {
        const callback = this.actions[action as keyof UIActions];
        if (typeof callback === 'function' && callback.length === 0) (callback as () => void)();
      }
    }, { signal: this.listeners.signal });
    root.addEventListener('input', (event) => {
      this.pendingBinding = null;
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.id === 'volume') {
        const volume = Number(event.target.value) / 100;
        this.actions.setVolume(volume);
        const output = this.overlay.querySelector('output');
        if (output) output.textContent = `${Math.round(volume * 100)}%`;
      }
      if (event.target.id === 'reduced-motion') this.actions.setReducedMotion(event.target.checked);
    }, { signal: this.listeners.signal });
    root.addEventListener('change', (event) => {
      if (event.target instanceof Element && event.target.closest('#custom-form')) this.refreshCustomValidation();
    }, { signal: this.listeners.signal });
    window.addEventListener('keydown', this.captureBinding, { capture: true, signal: this.listeners.signal });
    root.addEventListener('keydown', (event) => {
      const dialog = this.overlay.querySelector<HTMLElement>('[role="dialog"]');
      if (!dialog || event.key !== 'Tab') return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')];
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }, { signal: this.listeners.signal });
    this.showMenu();
  }

  private readonly captureBinding = (event: KeyboardEvent): void => {
    if (!this.pendingBinding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || !event.code) return;
    if (event.code === 'Escape') {
      this.pendingBinding = null;
      this.showSettings();
      return;
    }
    const { slot, action } = this.pendingBinding;
    const result = rebind(this.save.bindings, slot, action, event.code);
    if (result.error) {
      const hint = this.overlay.querySelector<HTMLElement>('#binding-status');
      if (hint) hint.textContent = result.error;
      return;
    }
    this.actions.setBindings(result.bindings);
    this.pendingBinding = null;
    this.setGuide(this.selected);
    this.showSettings();
    const hint = this.overlay.querySelector<HTMLElement>('#binding-status');
    if (hint) hint.textContent = `已保存：玩家 ${slot} ${BINDING_ACTIONS.find((entry) => entry.action === action)?.label ?? action} → ${keyLabel(event.code)}`;
  };

  destroy(): void {
    this.listeners.abort();
    if (this.toastTimer) clearTimeout(this.toastTimer);
  }

  setReady(): void { this.ready = true; this.showMenu(); }

  showMenu(): void {
    this.hudReady = false;
    this.overlay.className = 'menu-overlay';
    const map = getArena(this.save.selectedMapId);
    const look = APPEARANCE_PRESETS.find((entry) => entry.id === this.save.appearances[1].style)!;
    this.mapLabel.textContent = map.name + ' / ' + map.subtitle;
    const descriptions: Record<GameMode, string> = {
      'duel-ai': '和 AI 过过招，练一手漂亮的击退。',
      'local-duel': '叫上身边的朋友，一块键盘决胜负。',
      training: '没有时间限制，找回跳跃和开火的手感。',
      custom: '自选地图、人数、AI 难度、生命、时限与武器池。',
      campaign: '六关连续挑战；通关解锁下一关并记录最佳成绩。',
    };
    this.overlay.innerHTML = `
      <div class="hero-panel">
        <div class="eyebrow"><span class="slash">//</span> SMALL ARENA. BIG MAYHEM.</div>
        <h1>枪响，<br>就该<span>飞出去。</span></h1>
        <p class="hero-copy">平台之间，谁能站到最后？<br>跳跃、开火，把对手送出场外。</p>
        <div class="mode-picker" role="group" aria-label="选择游戏模式">
          ${(['duel-ai', 'local-duel', 'campaign', 'training', 'custom'] as const).map((mode, index) => `<button class="mode-option ${this.selected === mode ? 'selected' : ''}" data-action="mode" data-mode="${mode}" aria-pressed="${this.selected === mode}"><small>0${index + 1}</small><span>${MODE_LABELS[mode]}</span><i>${mode === 'duel-ai' ? '◈' : mode === 'local-duel' ? '▦' : mode === 'campaign' ? '♛' : mode === 'training' ? '◎' : '⚙'}</i></button>`).join('')}
        </div>
        <p class="mode-description">${descriptions[this.selected]}</p>
        <div class="loadout-actions"><button data-action="appearance"><span>✦ 角色外观</span><small>${look.name} ↗</small></button><button data-action="maps"><span>▧ 更换地图</span><small>${map.name} ↗</small></button></div>
        <button class="encyclopedia-entry" data-action="encyclopedia"><span>▤ 武器图鉴</span><small>17 个型号真实数据 / 直接试枪 ↗</small></button>
        <button class="start-button" data-action="start" ${this.ready ? '' : 'disabled'}><span>${!this.ready ? '正在准备战场' : this.selected === 'custom' ? '配置对局' : this.selected === 'campaign' ? '选择关卡' : '进入战场'}</span><span>↗</span></button>
        <div class="match-rules"><span>${this.selected === 'training' ? '无限练习' : this.selected === 'custom' ? '2—4 人自由配置' : this.selected === 'campaign' ? '六关战役' : '每人 3 条命'}</span><i></i><span>${this.selected === 'training' ? '随时重新开始' : this.selected === 'custom' ? '可关闭特殊投放' : this.selected === 'campaign' ? '胜利解锁下一关' : '最后存活者获胜'}</span></div>
      </div>
      <div class="arena-caption"><span class="caption-line"></span><small>${map.subtitle}</small><strong>${map.name}</strong><span>挑个新造型，换座新战场。</span></div>`;
    this.setGuide(this.selected);
    this.status.innerHTML = '<span class="status-dot"></span> 战场就绪';
  }

  showMatch(state: Readonly<MatchState>): void {
    this.hudReady = true;
    this.lastPhase = '';
    this.weaponIcons.clear();
    this.overlay.className = 'match-overlay';
    this.overlay.innerHTML = `
      <div class="hud-top">
        <div class="actor-cards ${state.actors.length > 2 ? 'many' : ''}">${state.actors.map((actor) => `<div class="actor-card" id="card-${actor.config.id}" style="--player-color:#${actor.config.color.toString(16).padStart(6, '0')}"><div class="actor-name"><i></i><span>${actor.config.name}</span><canvas class="weapon-icon" id="weapon-icon-${actor.config.id}" width="120" height="48" aria-label="当前武器"></canvas></div><div class="stocks" id="stocks-${actor.config.id}"></div><small id="actor-status-${actor.config.id}"></small></div>`).join('')}</div>
        <div class="timer-block"><span id="round-label">${MODE_LABELS[state.config.mode]}</span><strong id="round-time">03:00</strong></div>
        <button class="pause-button" data-action="pause" aria-label="暂停对战">Ⅱ <kbd>ESC</kbd></button>
      </div>
      <div class="countdown" aria-live="polite" hidden><small>准备就绪</small><strong></strong><span>保持移动，远离边缘。</span></div>
      <div class="spectator-banner" id="spectator-banner" hidden><small>SPECTATING</small><strong>本地玩家已出局 · 观战中</strong><span>本局结束后可重赛或返回菜单</span></div>
      ${state.config.mode === 'training' && state.training ? this.trainingPanel(state) : ''}`;
    this.trainingDummyMoving = state.training?.dummyMoving ?? true;
    this.setGuide(state.config.mode);
    this.mapLabel.textContent = state.config.map.name + ' / ' + state.config.map.subtitle;
    this.status.innerHTML = `<span class="status-dot"></span> ${MODE_LABELS[state.config.mode]} <span class="status-divider">/</span> ${state.config.map.name}`;
    this.updateHUD(state);
  }

  private trainingPanel(state: Readonly<MatchState>): string {
    const training = state.training;
    const done = training ? training.completedTasks.length : 0;
    const tasks = TRAINING_TASKS.map((task) => `<li class="training-task ${training?.completed[task.id] ? 'done' : ''}" data-training-task="${task.id}"><b>${task.title}</b><span>${task.hint}</span></li>`).join('');
    const intro = !this.save.trainingIntroSeen && !this.trainingIntroDismissed
      ? `<div class="training-intro" id="training-intro"><small>第一次来训练台？</small><p>先按 A / D 移动，空格跳跃；按 J 开火。底栏 1—8 可直接换枪，右侧图鉴可试全部 17 个型号。</p><button data-action="dismiss-training-intro">知道了</button></div>`
      : '';
    return `<aside class="training-panel" aria-label="训练任务">
      ${intro}
      <div class="training-head"><strong>训练任务 <span id="training-progress">${done}/6</span></strong><span>不扣命 · 不计战绩</span></div>
      <ul class="training-tasks">${tasks}</ul>
      <div class="training-actions"><button data-action="dummy-toggle">${training?.dummyMoving ? '假人：移动中' : '假人：静止'}</button><button data-action="reset-training">重置训练</button><button data-action="encyclopedia">武器图鉴</button></div>
    </aside>`;
  }

  updateHUD(state: Readonly<MatchState>): void {
    if (!this.hudReady) return;
    const timer = this.overlay.querySelector('#round-time');
    const label = this.overlay.querySelector('#round-label');
    if (timer) timer.textContent = state.config.mode === 'training' ? '∞' : formatTime(state.remaining);
    if (label) label.textContent = state.overtime ? '决胜加时' : MODE_LABELS[state.config.mode];
    const spectator = this.overlay.querySelector<HTMLElement>('#spectator-banner');
    if (spectator) {
      const humans = state.actors.filter((actor) => actor.config.control === 'human');
      spectator.hidden = !(state.phase === 'playing' && humans.length > 0 && humans.every((actor) => actor.status !== 'alive'));
    }
    for (const actor of state.actors) {
      const stocks = this.overlay.querySelector(`#stocks-${actor.config.id}`);
      const status = this.overlay.querySelector(`#actor-status-${actor.config.id}`);
      const card = this.overlay.querySelector(`#card-${actor.config.id}`);
      const stockText = state.config.mode === 'training' ? '∞ 无限生命' : `${'● '.repeat(actor.stocks)}${'○ '.repeat(Math.max(0, state.config.stocks - actor.stocks))}`;
      if (stocks && stocks.textContent !== stockText) stocks.textContent = stockText;
      const ammo = actor.weapon.ammoRemaining === null ? '∞' : `${actor.weapon.ammoRemaining}/${actor.weapon.reserveRemaining}`;
      const reload = actor.reloadRemaining > 0 ? ` · 换弹 ${actor.reloadRemaining.toFixed(1)}s` : '';
      const tier = actor.weapon.definition.tier === 'ultimate' ? '终极 · ' : '';
      if (status) status.textContent = actor.status === 'eliminated' ? '已淘汰 · 观战中' : actor.status === 'respawning' ? '正在返回战场' : `${tier}${actor.weapon.definition.name} · ${ammo}${reload} · 炸弹 ${actor.bombsRemaining}`;
      card?.classList.toggle('eliminated', actor.status === 'eliminated');
      this.drawWeaponIcon(actor.config.id, actor.weapon.definition.id);
    }
    if (state.training) {
      const human = state.actors.find((actor) => actor.config.control === 'human');
      if (human) this.lastTrainingWeaponId = human.weapon.definition.id;
      const progress = this.overlay.querySelector<HTMLElement>('#training-progress');
      if (progress) progress.textContent = `${state.training.completedTasks.length}/6`;
      for (const task of TRAINING_TASKS) {
        this.overlay.querySelector(`[data-training-task="${task.id}"]`)?.classList.toggle('done', state.training.completed[task.id]);
      }
      this.trainingDummyMoving = state.training.dummyMoving;
    }
    const countdown = this.overlay.querySelector<HTMLElement>('.countdown');
    if (countdown) {
      countdown.hidden = state.phase !== 'countdown';
      const number = countdown.querySelector('strong');
      if (number) number.textContent = String(Math.max(1, Math.ceil(state.countdownRemaining)));
    }
    if (this.lastPhase !== state.phase) {
      this.lastPhase = state.phase;
      this.overlay.classList.toggle('is-countdown', state.phase === 'countdown');
    }
  }

  showPause(): void {
    this.dialog('TIME OUT', '喘口气，再上场。', '<p class="dialog-copy">战场已经暂停，返回后会有 3 秒准备时间。</p><button class="start-button" data-action="resume"><span>继续对战</span><span>↗</span></button><div class="dialog-actions"><button data-action="restart">重新开始</button><button data-action="appearance">角色外观</button><button data-action="maps">更换地图</button><button data-action="settings">设置</button><button data-action="menu">返回主菜单</button></div>');
  }

  showAppearance(nextRound = false): void {
    this.editNextRound = nextRound;
    const look = this.save.appearances[this.editingSlot];
    this.dialog('THE DRESSING ROOM', '你的角色，你的风格。', appearanceEditor(this.editingSlot, look, nextRound), 'studio-panel');
    drawAppearancePreviews(this.overlay, look);
  }

  private refreshAppearance(button: HTMLElement): void {
    const { action, field, value } = button.dataset;
    this.showAppearance(this.editNextRound);
    this.overlay.querySelector<HTMLButtonElement>(`[data-action="${action}"]${field ? `[data-field="${field}"]` : ''}[data-value="${value}"]`)?.focus({ preventScroll: true });
  }

  showMaps(nextRound = false): void {
    this.editNextRound = nextRound;
    this.dialog('PICK YOUR BATTLEGROUND', '下一站，哪里开打？', mapPicker(this.save.selectedMapId, nextRound), 'map-picker-panel');
    drawMapPreviews(this.overlay);
  }

  showCampaign(progress: CampaignProgress): void {
    const cards = CAMPAIGN_LEVELS.map((level) => {
      const locked = level.order > progress.unlocked;
      const done = progress.completed.includes(level.id);
      const best = progress.bestScores[level.id];
      return `<button class="campaign-level ${locked ? 'locked' : ''} ${done ? 'done' : ''}" data-action="campaign-level" data-level="${level.id}" ${locked ? 'disabled' : ''}>
        <span class="campaign-order">${locked ? '锁' : `0${level.order}`}</span>
        <span class="campaign-copy"><strong>${escapeLabel(level.name)}</strong><small>${escapeLabel(level.brief)}</small></span>
        <span class="campaign-meta">${locked ? '完成上一关' : done ? `最佳 ${best ?? 0}` : `${DIFFICULTY_LABELS[level.difficulty]} · ${level.stocks} 命`}</span>
      </button>`;
    }).join('');
    this.dialog('CAMPAIGN', '六关，一条命一条命打上去。', `<p class="dialog-copy">胜利解锁下一关并记录最佳成绩；失败或平局不解锁。当前已解锁 ${progress.unlocked}/6。</p><div class="campaign-list">${cards}</div><div class="dialog-actions"><button data-action="close">返回</button></div>`);
  }

  showResult(result: MatchResult): void {
    const level = result.campaignLevelId ? getCampaignLevel(result.campaignLevelId) : undefined;
    const heading = level
      ? result.winner === 'p1' ? `${level.name} · 通关` : result.winner === null ? `${level.name} · 平局` : `${level.name} · 失败`
      : winnerHeading(result);
    this.dialog('ROUND COMPLETE', heading, `
      <p class="dialog-copy">${level ? `战役第 ${level.order} 关` : MODE_LABELS[result.mode]} · 用时 ${formatTime(result.duration)}${result.overtime ? ' · 决胜加时' : ''}${level && result.winner === 'p1' ? ' · 下一关已解锁' : ''}</p>
      <div class="result-table"><div class="result-row table-label"><span>参战者</span><span>剩余生命</span><span>击出</span><span>出界</span></div>${result.actors.map((actor) => `<div class="result-row ${actor.id === result.winner ? 'winner-row' : ''}"><strong>${actor.name}</strong><span>${actor.stocks}</span><span>${actor.knockouts}</span><span>${actor.falls}</span></div>`).join('')}</div>
      ${level && result.winner === 'p1' ? '<button class="start-button" data-action="next-campaign"><span>下一关</span><span>↗</span></button>' : ''}
      <button class="${level && result.winner === 'p1' ? 'secondary-button' : 'start-button'}" data-action="restart"><span>${level ? '重试本关' : '再来一局'}</span><span>↗</span></button>
      <div class="dialog-actions">${level ? '<button data-action="campaign-select">选择关卡</button>' : ''}<button data-action="menu">返回主菜单</button></div>`);
  }

  showEncyclopedia(): void {
    const cards = ARMORY_WEAPONS.map((weapon) => {
      const id = weapon.id;
      const magazine = weapon.maxAmmo === null ? '∞' : `${weapon.maxAmmo}/${weapon.reserveAmmo ?? 0}`;
      const spread = weapon.pellets > 1
        ? `${weapon.pellets} 丸 · ±${Math.round(weapon.spreadRadians * 180 / Math.PI)}°`
        : '单发直线';
      const blast = weapon.explosion ? ` · 爆炸 ${weapon.explosion.radius}px` : '';
      const selected = id === this.lastTrainingWeaponId;
      const burst = weaponBurstImpulse(weapon);
      const sustained = weaponSustainedImpulse(weapon);
      const burstWidth = Math.max(3, Math.min(100, Math.round(burst / 12.5)));
      const sustainedWidth = Math.max(3, Math.min(100, Math.round(sustained / 22)));
      return `<article class="weapon-card ${weapon.tier === 'ultimate' ? 'ultimate' : ''} ${selected ? 'selected' : ''}" ${selected ? 'aria-current="true"' : ''}>
        <canvas class="weapon-card-art" data-weapon-art="${id}" width="120" height="48" aria-label="${escapeLabel(weapon.name)} 轮廓"></canvas>
        <div class="weapon-card-head"><strong>${escapeLabel(weapon.name)}</strong><small>${selected ? '当前试枪' : weaponRole(id)}</small></div>
        <p>${magazine} 弹匣 · 换弹 ${weapon.reloadTime ?? '—'}s</p>
        <p>${Math.round(weapon.interval * 1000)}ms / 发 · ${weapon.range}px · 击退 ${weapon.knockback}</p>
        <p>${spread}${blast}</p>
        <div class="weapon-power"><span>单发 ${burst}</span><i><b style="width:${burstWidth}%"></b></i></div>
        <div class="weapon-power sustained"><span>持续 ${sustained}/s</span><i><b style="width:${sustainedWidth}%"></b></i></div>
        <button data-action="train-weapon" data-weapon="${id}">用此枪训练 ↗</button>
      </article>`;
    }).join('');
    this.dialog('ARMORY', '十七个型号，真实参数。', `<p class="dialog-copy">六类标准枪共 17 个具体型号，逐枪展示弹匣、备弹、换弹、射速、射程、击退与后坐；点任意型号可直接进入训练场试枪。训练中 1—8 为类别代表。</p><div class="encyclopedia-grid">${cards}</div><div class="dialog-actions"><button data-action="close">返回</button></div>`);
    for (const canvas of this.overlay.querySelectorAll<HTMLCanvasElement>('[data-weapon-art]')) {
      const id = canvas.dataset.weaponArt as WeaponId | undefined;
      if (!id) continue;
      const icon = createWeaponIconCanvas(id);
      canvas.getContext('2d')?.drawImage(icon, 0, 0);
    }
  }

  showCustomSetup(settings: CustomMatchSettings): void {
    const custom = cloneCustomMatch(settings);
    const mapOptions = CUSTOM_MAP_OPTIONS.map((map) => `<option value="${map.id}" ${custom.mapId === map.id ? 'selected' : ''}>${escapeLabel(map.name)}</option>`).join('');
    const slotRow = (index: number, slot: CustomSlot): string => {
      if (index === 0) return `<div class="custom-slot fixed"><span><b>槽位 1</b><small>玩家 1 · 本地键盘</small></span><em>固定</em></div>`;
      const modes = index === 1
        ? [['human', '玩家 2'], ['bot', 'AI'], ['empty', '关闭']]
        : [['bot', 'AI'], ['empty', '关闭']];
      const mode = slot.kind;
      const difficulty = slot.kind === 'bot' ? slot.difficulty : 'normal';
      return `<div class="custom-slot"><span><b>槽位 ${index + 1}</b><small data-custom-label="${index}">${mode === 'empty' ? '空置' : mode === 'human' ? '本地键盘 2' : `${DIFFICULTY_LABELS[difficulty]} AI`}</small></span>
        <select data-custom-slot="${index}" aria-label="槽位 ${index + 1}">${modes.map(([value, label]) => `<option value="${value}" ${mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select>
        <select data-custom-difficulty="${index}" aria-label="槽位 ${index + 1} AI 难度">${(['easy', 'normal', 'hard'] as const).map((level) => `<option value="${level}" ${difficulty === level ? 'selected' : ''}>${DIFFICULTY_LABELS[level]}</option>`).join('')}</select></div>`;
    };
    this.dialog('CUSTOM MATCH', '这一局，你说了算。', `
      <form id="custom-form" class="custom-form" onsubmit="return false">
        <div class="custom-grid">
          <label>地图<select id="custom-map">${mapOptions}</select></label>
          <label>每人生命<input id="custom-stocks" type="number" min="${CUSTOM_MATCH_LIMITS.minStocks}" max="${CUSTOM_MATCH_LIMITS.maxStocks}" step="1" value="${custom.stocks}" /></label>
          <label>时限（秒）<input id="custom-duration" type="number" min="${CUSTOM_MATCH_LIMITS.minDuration}" max="${CUSTOM_MATCH_LIMITS.maxDuration}" step="30" value="${custom.duration}" /></label>
          <label>武器池<select id="custom-drop">${dropModeOptions(custom.dropMode)}</select></label>
        </div>
        <div class="custom-slots">${custom.slots.map((slot, index) => slotRow(index, slot)).join('')}</div>
        <p class="setting-note" id="custom-errors" role="alert"></p>
        <p class="custom-summary" id="custom-summary"></p>
        <button type="button" class="start-button" data-action="start-custom"><span>开始对战</span><span>↗</span></button>
        <div class="dialog-actions"><button type="button" data-action="close">返回</button></div>
      </form>`);
    this.refreshCustomValidation();
  }

  private readCustomSettings(): CustomMatchSettings {
    const form = this.overlay.querySelector<HTMLFormElement>('#custom-form');
    if (!form) return cloneCustomMatch();
    const value = (selector: string): string => form.querySelector<HTMLInputElement | HTMLSelectElement>(selector)?.value ?? '';
    const slots: CustomSlot[] = [{ kind: 'human', inputSlot: 1 }];
    for (let index = 1; index < 4; index++) {
      const mode = value(`[data-custom-slot="${index}"]`);
      const rawDifficulty = value(`[data-custom-difficulty="${index}"]`);
      if (index === 1 && mode === 'human') slots.push({ kind: 'human', inputSlot: 2 });
      else if (mode === 'bot') slots.push({ kind: 'bot', difficulty: (rawDifficulty || 'normal') as Difficulty });
      else slots.push({ kind: 'empty' });
    }
    return {
      mapId: value('#custom-map'),
      stocks: Number(value('#custom-stocks')),
      duration: Number(value('#custom-duration')),
      dropMode: (value('#custom-drop') || 'all') as DropMode,
      slots,
    };
  }

  private refreshCustomValidation(): void {
    const settings = this.readCustomSettings();
    const errors = validateCustomMatch(settings);
    const errorBox = this.overlay.querySelector<HTMLElement>('#custom-errors');
    const summary = this.overlay.querySelector<HTMLElement>('#custom-summary');
    const start = this.overlay.querySelector<HTMLButtonElement>('[data-action="start-custom"]');
    for (let index = 1; index < 4; index++) {
      const mode = this.overlay.querySelector<HTMLSelectElement>(`[data-custom-slot="${index}"]`);
      const difficulty = this.overlay.querySelector<HTMLSelectElement>(`[data-custom-difficulty="${index}"]`);
      if (mode && difficulty) {
        difficulty.disabled = mode.value !== 'bot';
        const label = this.overlay.querySelector<HTMLElement>(`[data-custom-label="${index}"]`);
        if (label) label.textContent = mode.value === 'empty' ? '空置' : mode.value === 'human' ? '本地键盘 2' : `${DIFFICULTY_LABELS[difficulty.value as Difficulty] ?? '普通'} AI`;
      }
    }
    const active = settings.slots.filter((slot) => slot.kind !== 'empty');
    const humans = active.filter((slot) => slot.kind === 'human').length;
    const bots = active.length - humans;
    if (errorBox) {
      errorBox.textContent = errors.join(' ');
      errorBox.classList.toggle('error', errors.length > 0);
    }
    if (summary) summary.textContent = `${active.length} 人 · ${humans} 本地 / ${bots} AI · 每人 ${settings.stocks || 0} 命 · ${settings.duration || 0} 秒`;
    if (start) start.disabled = errors.length > 0;
  }

  private showCustomErrors(errors: string[]): void {
    const box = this.overlay.querySelector<HTMLElement>('#custom-errors');
    if (box) { box.textContent = errors.join(' '); box.classList.add('error'); }
  }

  showSettings(): void {
    this.pendingBinding = null;
    const bindingRows = ([1, 2] as const).map((slot) => `<div class="binding-player"><strong>玩家 ${slot}</strong>${BINDING_ACTIONS.map(({ action, label }) => {
      const binding = this.save.bindings[slot][action];
      return `<div class="binding-row"><span>${label}</span><button class="binding-key" data-action="rebind" data-slot="${slot}" data-control="${action}" aria-label="玩家 ${slot} ${label}，当前 ${escapeLabel(binding.label)}">${escapeLabel(binding.label)}</button></div>`;
    }).join('')}</div>`).join('');
    this.dialog('MAKE IT YOURS', '按你的节奏。', `
      <div class="setting-row"><label for="volume">音效音量</label><output>${Math.round(this.save.settings.volume * 100)}%</output><input id="volume" type="range" min="0" max="100" value="${Math.round(this.save.settings.volume * 100)}" /></div>
      <label class="toggle-row" for="reduced-motion"><span>减少画面震动<small>保留命中反馈，关闭镜头震动。</small></span><input id="reduced-motion" type="checkbox" ${this.save.settings.reducedMotion ? 'checked' : ''} /></label>
      <div class="binding-section"><div class="binding-heading"><span>键位</span><button class="link-button" data-action="reset-bindings">恢复默认</button></div>
        <p class="setting-note" id="binding-status">点击按键后按新键；Esc 取消；冲突键不会保存。系统键与训练 1—8 保留。</p>
        <div class="binding-grid">${bindingRows}</div>
      </div>
      <button class="danger-button" data-action="clear-save">清除本地存档</button>
      <button class="start-button" data-action="close"><span>完成</span><span>✓</span></button>`);
  }

  showHelp(): void {
    this.dialog('KNOW THE RULES', '把对手打出去。', `
      <p class="dialog-copy">子弹会把对手击退。越过场地边界会失去一条生命；最后仍有生命的人获胜。试着在空中再跳一次，返回平台。</p>
      <div class="help-grid">${([1, 2] as const).map((slot) => {
        const keys = this.save.bindings[slot];
        return `<div><strong>玩家 ${slot}</strong><p><kbd>${escapeLabel(keys.left.label)}</kbd> <kbd>${escapeLabel(keys.right.label)}</kbd> 移动</p><p><kbd>${escapeLabel(keys.jump.label)}</kbd> 跳跃 / 二段跳</p><p><kbd>${escapeLabel(keys.drop.label)}</kbd> 向下穿台</p><p><kbd>${escapeLabel(keys.shoot.label)}</kbd> 持续开火</p><p><kbd>${escapeLabel(keys.reload.label)}</kbd> 换弹 <kbd>${escapeLabel(keys.bomb.label)}</kbd> 投弹</p></div>`;
      }).join('')}</div>
      <p class="help-note"><kbd>Esc</kbd> 暂停 · 切换窗口会自动暂停 · 自由练习不限时间与生命，按 <kbd>1—8</kbd> 直接试八把枪（7—8 为终极武器）。</p>
      <button class="start-button" data-action="close"><span>明白了</span><span>↗</span></button>`);
  }

  notify(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, 3500);
  }

  private dialog(eyebrow: string, title: string, body: string, panelClass = ''): void {
    this.pendingBinding = null;
    this.hudReady = false;
    this.overlay.className = 'dialog-overlay';
    this.overlay.innerHTML = `<section class="dialog-panel ${panelClass}" role="dialog" aria-modal="true" aria-label="${title}"><div class="eyebrow"><span class="slash">//</span> ${eyebrow}</div><h2>${title}</h2>${body}</section>`;
    this.overlay.querySelector<HTMLButtonElement>('.start-button')?.focus({ preventScroll: true });
  }

  private drawWeaponIcon(actorId: string, weaponId: WeaponId): void {
    if (this.weaponIcons.get(actorId) === weaponId) return;
    const canvas = this.overlay.querySelector<HTMLCanvasElement>(`#weapon-icon-${actorId}`);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(createWeaponIconCanvas(weaponId), 0, 0, canvas.width, canvas.height);
    this.weaponIcons.set(actorId, weaponId);
  }

  private setGuide(mode: GameMode): void {
    const p1 = this.save.bindings[1];
    const p2 = this.save.bindings[2];
    this.footer.innerHTML = mode === 'local-duel'
      ? `<span>P1 <kbd>${escapeLabel(p1.left.label)} ${escapeLabel(p1.right.label)}</kbd> 移动 <kbd>${escapeLabel(p1.jump.label)}</kbd> 跳 <kbd>${escapeLabel(p1.drop.label)}</kbd> 穿台 <kbd>${escapeLabel(p1.shoot.label)}</kbd> 开火 <kbd>${escapeLabel(p1.reload.label)}</kbd> 换弹 <kbd>${escapeLabel(p1.bomb.label)}</kbd> 投弹</span><span>P2 <kbd>${escapeLabel(p2.left.label)} ${escapeLabel(p2.right.label)}</kbd> 移动 <kbd>${escapeLabel(p2.jump.label)}</kbd> 跳 <kbd>${escapeLabel(p2.drop.label)}</kbd> 穿台 <kbd>${escapeLabel(p2.shoot.label)}</kbd> 开火 <kbd>${escapeLabel(p2.reload.label)}</kbd> 换弹 <kbd>${escapeLabel(p2.bomb.label)}</kbd> 投弹</span><span><kbd>Esc</kbd> 暂停</span>`
      : `<span><kbd>${escapeLabel(p1.left.label)}</kbd> <kbd>${escapeLabel(p1.right.label)}</kbd> 移动</span><span><kbd>${escapeLabel(p1.jump.label)}</kbd> 二段跳</span><span><kbd>${escapeLabel(p1.drop.label)}</kbd> 穿台</span><span><kbd>${escapeLabel(p1.shoot.label)}</kbd> 开火</span><span><kbd>${escapeLabel(p1.reload.label)}</kbd> 换弹</span><span><kbd>${escapeLabel(p1.bomb.label)}</kbd> 投弹</span><span><kbd>1—8</kbd> 试枪</span><span><kbd>Esc</kbd> 暂停</span>`;
  }
}

function dropModeOptions(selected: DropMode): string {
  const options: [DropMode, string][] = [
    ['all', '全部武器（含终极）'],
    ['standard', '仅标准武器'],
    ['none', '关闭特殊投放'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function winnerHeading(result: MatchResult): string {
  const winner = result.actors.find((actor) => actor.id === result.winner);
  return winner ? `${winner.name}，站到了最后。` : '势均力敌，平局。';
}

function escapeLabel(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}

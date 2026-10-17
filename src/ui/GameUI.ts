import { KEY_BINDINGS } from '../content/controls';
import { MODE_LABELS } from '../content/matches';
import { APPEARANCE_PRESETS, isCharacterStyle, normalizeAppearance, presetAppearance } from '../content/appearances';
import { getArena, isMapId } from '../content/maps';
import type { CharacterAppearance, GameMode, HumanSlot, MatchResult, MatchState } from '../game/core/types';
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
}

export class GameUI {
  private readonly overlay: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly status: HTMLElement;
  private readonly toast: HTMLElement;
  private selected: GameMode;
  private hudReady = false;
  private lastPhase = '';
  private ready = false;
  private editingSlot: HumanSlot = 1;
  private editNextRound = false;
  private readonly mapLabel: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
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
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.id === 'volume') {
        const volume = Number(event.target.value) / 100;
        this.actions.setVolume(volume);
        const output = this.overlay.querySelector('output');
        if (output) output.textContent = `${Math.round(volume * 100)}%`;
      }
      if (event.target.id === 'reduced-motion') this.actions.setReducedMotion(event.target.checked);
    }, { signal: this.listeners.signal });
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
    };
    this.overlay.innerHTML = `
      <div class="hero-panel">
        <div class="eyebrow"><span class="slash">//</span> SMALL ARENA. BIG MAYHEM.</div>
        <h1>枪响，<br>就该<span>飞出去。</span></h1>
        <p class="hero-copy">平台之间，谁能站到最后？<br>跳跃、开火，把对手送出场外。</p>
        <div class="mode-picker" role="group" aria-label="选择游戏模式">
          ${(['duel-ai', 'local-duel', 'training'] as const).map((mode, index) => `<button class="mode-option ${this.selected === mode ? 'selected' : ''}" data-action="mode" data-mode="${mode}" aria-pressed="${this.selected === mode}"><small>0${index + 1}</small><span>${MODE_LABELS[mode]}</span><i>${mode === 'duel-ai' ? '◈' : mode === 'local-duel' ? '▦' : '◎'}</i></button>`).join('')}
        </div>
        <p class="mode-description">${descriptions[this.selected]}</p>
        <div class="loadout-actions"><button data-action="appearance"><span>✦ 角色外观</span><small>${look.name} ↗</small></button><button data-action="maps"><span>▧ 更换地图</span><small>${map.name} ↗</small></button></div>
        <button class="start-button" data-action="start" ${this.ready ? '' : 'disabled'}><span>${this.ready ? '进入战场' : '正在准备战场'}</span><span>↗</span></button>
        <div class="match-rules"><span>${this.selected === 'training' ? '无限练习' : '每人 3 条命'}</span><i></i><span>${this.selected === 'training' ? '随时重新开始' : '最后存活者获胜'}</span></div>
      </div>
      <div class="arena-caption"><span class="caption-line"></span><small>${map.subtitle}</small><strong>${map.name}</strong><span>挑个新造型，换座新战场。</span></div>`;
    this.setGuide(this.selected);
    this.status.innerHTML = '<span class="status-dot"></span> 战场就绪';
  }

  showMatch(state: Readonly<MatchState>): void {
    this.hudReady = true;
    this.lastPhase = '';
    this.overlay.className = 'match-overlay';
    this.overlay.innerHTML = `
      <div class="hud-top">
        <div class="actor-cards">${state.actors.map((actor) => `<div class="actor-card" id="card-${actor.config.id}" style="--player-color:#${actor.config.color.toString(16).padStart(6, '0')}"><div class="actor-name"><i></i><span>${actor.config.name}</span></div><div class="stocks" id="stocks-${actor.config.id}"></div><small id="actor-status-${actor.config.id}"></small></div>`).join('')}</div>
        <div class="timer-block"><span id="round-label">${MODE_LABELS[state.config.mode]}</span><strong id="round-time">03:00</strong></div>
        <button class="pause-button" data-action="pause" aria-label="暂停对战">Ⅱ <kbd>ESC</kbd></button>
      </div>
      <div class="countdown" aria-live="polite" hidden><small>准备就绪</small><strong></strong><span>保持移动，远离边缘。</span></div>`;
    this.setGuide(state.config.mode);
    this.mapLabel.textContent = state.config.map.name + ' / ' + state.config.map.subtitle;
    this.status.innerHTML = `<span class="status-dot"></span> ${MODE_LABELS[state.config.mode]} <span class="status-divider">/</span> ${state.config.map.name}`;
    this.updateHUD(state);
  }

  updateHUD(state: Readonly<MatchState>): void {
    if (!this.hudReady) return;
    const timer = this.overlay.querySelector('#round-time');
    const label = this.overlay.querySelector('#round-label');
    if (timer) timer.textContent = state.config.mode === 'training' ? '∞' : formatTime(state.remaining);
    if (label) label.textContent = state.overtime ? '决胜加时' : MODE_LABELS[state.config.mode];
    for (const actor of state.actors) {
      const stocks = this.overlay.querySelector(`#stocks-${actor.config.id}`);
      const status = this.overlay.querySelector(`#actor-status-${actor.config.id}`);
      const card = this.overlay.querySelector(`#card-${actor.config.id}`);
      const stockText = state.config.mode === 'training' ? '∞ 无限生命' : `${'● '.repeat(actor.stocks)}${'○ '.repeat(Math.max(0, state.config.stocks - actor.stocks))}`;
      if (stocks && stocks.textContent !== stockText) stocks.textContent = stockText;
      if (status) status.textContent = actor.status === 'eliminated' ? '已淘汰 · 观战中' : actor.status === 'respawning' ? '正在返回战场' : '基础手枪 · ∞';
      card?.classList.toggle('eliminated', actor.status === 'eliminated');
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

  showResult(result: MatchResult): void {
    const winner = result.actors.find((actor) => actor.id === result.winner);
    this.dialog('ROUND COMPLETE', winner ? `${winner.name}，站到了最后。` : '势均力敌，平局。', `
      <p class="dialog-copy">${MODE_LABELS[result.mode]} · 用时 ${formatTime(result.duration)}${result.overtime ? ' · 决胜加时' : ''}</p>
      <div class="result-table"><div class="result-row table-label"><span>参战者</span><span>剩余生命</span><span>击出</span><span>出界</span></div>${result.actors.map((actor) => `<div class="result-row ${actor.id === result.winner ? 'winner-row' : ''}"><strong>${actor.name}</strong><span>${actor.stocks}</span><span>${actor.knockouts}</span><span>${actor.falls}</span></div>`).join('')}</div>
      <button class="start-button" data-action="restart"><span>再来一局</span><span>↗</span></button><div class="dialog-actions"><button data-action="menu">返回主菜单</button></div>`);
  }

  showSettings(): void {
    this.dialog('MAKE IT YOURS', '按你的节奏。', `
      <div class="setting-row"><label for="volume">音效音量</label><output>${Math.round(this.save.settings.volume * 100)}%</output><input id="volume" type="range" min="0" max="100" value="${Math.round(this.save.settings.volume * 100)}" /></div>
      <label class="toggle-row" for="reduced-motion"><span>减少画面震动<small>保留命中反馈，关闭镜头震动。</small></span><input id="reduced-motion" type="checkbox" ${this.save.settings.reducedMotion ? 'checked' : ''} /></label>
      <button class="start-button" data-action="close"><span>完成</span><span>✓</span></button>`);
  }

  showHelp(): void {
    this.dialog('KNOW THE RULES', '把对手打出去。', `
      <p class="dialog-copy">子弹会把对手击退。越过场地边界会失去一条生命；最后仍有生命的人获胜。试着在空中再跳一次，返回平台。</p>
      <div class="help-grid">${([1, 2] as const).map((slot) => {
        const keys = KEY_BINDINGS[slot];
        return `<div><strong>玩家 ${slot}</strong><p><kbd>${keys.left.label}</kbd> <kbd>${keys.right.label}</kbd> 移动</p><p><kbd>${keys.jump.label}</kbd> 跳跃 / 二段跳</p><p><kbd>${keys.drop.label}</kbd> 向下穿台</p><p><kbd>${keys.shoot.label}</kbd> 持续开火</p></div>`;
      }).join('')}</div>
      <p class="help-note"><kbd>Esc</kbd> 暂停 · 切换窗口会自动暂停 · 自由练习不限时间与生命。</p>
      <button class="start-button" data-action="close"><span>明白了</span><span>↗</span></button>`);
  }

  notify(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.hidden = false;
    this.toastTimer = setTimeout(() => { this.toast.hidden = true; }, 3500);
  }

  private dialog(eyebrow: string, title: string, body: string, panelClass = ''): void {
    this.hudReady = false;
    this.overlay.className = 'dialog-overlay';
    this.overlay.innerHTML = `<section class="dialog-panel ${panelClass}" role="dialog" aria-modal="true" aria-label="${title}"><div class="eyebrow"><span class="slash">//</span> ${eyebrow}</div><h2>${title}</h2>${body}</section>`;
    this.overlay.querySelector<HTMLButtonElement>('.start-button')?.focus({ preventScroll: true });
  }

  private setGuide(mode: GameMode): void {
    const p1 = KEY_BINDINGS[1];
    const p2 = KEY_BINDINGS[2];
    this.footer.innerHTML = mode === 'local-duel'
      ? `<span>P1 <kbd>${p1.left.label} ${p1.right.label}</kbd> 移动 <kbd>${p1.jump.label}</kbd> 跳 <kbd>${p1.drop.label}</kbd> 穿台 <kbd>${p1.shoot.label}</kbd> 开火</span><span>P2 <kbd>${p2.left.label} ${p2.right.label}</kbd> 移动 <kbd>${p2.jump.label}</kbd> 跳 <kbd>${p2.drop.label}</kbd> 穿台 <kbd>${p2.shoot.label}</kbd> 开火</span><span><kbd>Esc</kbd> 暂停</span>`
      : `<span><kbd>${p1.left.label}</kbd> <kbd>${p1.right.label}</kbd> 移动</span><span><kbd>${p1.jump.label}</kbd> 二段跳</span><span><kbd>${p1.drop.label}</kbd> 穿台</span><span><kbd>${p1.shoot.label}</kbd> 开火</span><span><kbd>Esc</kbd> 暂停</span>`;
  }
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, '0')}:${(rounded % 60).toString().padStart(2, '0')}`;
}

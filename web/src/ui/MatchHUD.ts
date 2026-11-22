import { MODE_LABELS } from '../content/matches';
import { TRAINING_TASKS } from '../content/tutorial';
import type { MatchState, WeaponId } from '../game/core/types';
import { createWeaponIconCanvas } from '../presentation/WeaponArt';
import { escapeLabel, formatTime } from './format';

export function matchLabel(state: Readonly<MatchState>): string {
  return state.actors.some(({ config }) => config.control === 'external') ? 'DeepSeek 对战' : MODE_LABELS[state.config.mode];
}

export class MatchHUD {
  trainingWeapon: WeaponId = 'pistol';
  private lastPhase = '';
  private readonly weaponIcons = new Map<string, WeaponId>();
  private trainingDummyMoving = true;
  private requestedDummyMoving: boolean | null = null;

  constructor(private readonly overlay: HTMLElement) {}

  render(state: Readonly<MatchState>, showIntro: boolean, publicRoom: boolean): void {
    const label = matchLabel(state);
    this.lastPhase = '';
    this.weaponIcons.clear();
    this.overlay.className = 'match-overlay';
    this.overlay.innerHTML = `
      <div class="hud-top">
        <div class="actor-cards ${state.actors.length > 2 ? 'many' : ''}">${state.actors.map((actor) => `<div class="actor-card" id="card-${actor.config.id}" style="--player-color:#${actor.config.color.toString(16).padStart(6, '0')}"><div class="actor-name"><i></i><span>${escapeLabel(actor.config.name)}</span><canvas class="weapon-icon" id="weapon-icon-${actor.config.id}" width="120" height="48" aria-label="当前武器"></canvas></div><div class="stocks" id="stocks-${actor.config.id}"></div><small id="actor-status-${actor.config.id}"></small></div>`).join('')}</div>
        <div class="timer-block"><span id="round-label">${label}</span><strong id="round-time">03:00</strong></div>
        <div class="net-status" id="net-status" hidden></div>
        <button class="pause-button" data-action="pause" aria-label="${publicRoom ? '离开房间' : '暂停对战'}">${publicRoom ? '离开' : 'Ⅱ'} <kbd>ESC</kbd></button>
      </div>
      <div class="countdown" aria-live="polite" hidden><small>准备就绪</small><strong></strong><span>保持移动，远离边缘。</span></div>
      <div class="spectator-banner" id="spectator-banner" hidden><small>SPECTATING</small><strong>本地玩家已出局 · 观战中</strong><span>本局结束后可重赛或返回菜单</span></div>
      ${state.config.mode === 'training' && state.training ? this.trainingPanel(state, showIntro) : ''}`;
    this.trainingDummyMoving = state.training?.dummyMoving ?? true;
    this.requestedDummyMoving = null;
    this.update(state);
  }

  private trainingPanel(state: Readonly<MatchState>, showIntro: boolean): string {
    const training = state.training;
    const done = training ? training.completedTasks.length : 0;
    const tasks = TRAINING_TASKS.map((task) => `<li class="training-task ${training?.completed[task.id] ? 'done' : ''}" data-training-task="${task.id}"><b>${task.title}</b><span>${task.hint}</span></li>`).join('');
    const intro = showIntro
      ? `<div class="training-intro" id="training-intro"><small>第一次来训练台？</small><p>先按 A / D 移动，空格跳跃；按 J 开火。底栏 1—8 可直接换枪，右侧图鉴可试全部 17 个型号。</p><button data-action="dismiss-training-intro">知道了</button></div>`
      : '';
    return `<aside class="training-panel" aria-label="训练任务">
      ${intro}
      <div class="training-head"><strong>训练任务 <span id="training-progress">${done}/6</span></strong><span>不扣命 · 不计战绩</span></div>
      <ul class="training-tasks">${tasks}</ul>
      <div class="training-actions"><button data-action="dummy-toggle">${training?.dummyMoving ? '假人：移动中' : '假人：静止'}</button><button data-action="reset-training">重置训练</button><button data-action="encyclopedia">武器图鉴</button></div>
    </aside>`;
  }

  update(state: Readonly<MatchState>): void {
    const timer = this.overlay.querySelector('#round-time');
    const label = this.overlay.querySelector('#round-label');
    if (timer) timer.textContent = state.config.mode === 'training' ? '∞' : formatTime(state.remaining);
    if (label) label.textContent = state.overtime ? '决胜加时' : matchLabel(state);
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
      if (human) this.trainingWeapon = human.weapon.definition.id;
      const progress = this.overlay.querySelector<HTMLElement>('#training-progress');
      if (progress) progress.textContent = `${state.training.completedTasks.length}/6`;
      for (const task of TRAINING_TASKS) {
        this.overlay.querySelector(`[data-training-task="${task.id}"]`)?.classList.toggle('done', state.training.completed[task.id]);
      }
      this.trainingDummyMoving = state.training.dummyMoving;
      if (this.trainingDummyMoving === this.requestedDummyMoving) this.requestedDummyMoving = null;
      this.updateDummyButton();
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

  toggleDummy(): boolean {
    const moving = !(this.requestedDummyMoving ?? this.trainingDummyMoving);
    this.requestedDummyMoving = moving;
    this.updateDummyButton();
    return moving;
  }

  private updateDummyButton(): void {
    const button = this.overlay.querySelector<HTMLElement>('[data-action="dummy-toggle"]');
    const label = (this.requestedDummyMoving ?? this.trainingDummyMoving) ? '假人：移动中' : '假人：静止';
    if (button && button.textContent !== label) button.textContent = label;
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
}

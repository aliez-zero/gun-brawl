import { CUSTOM_MAP_OPTIONS, CUSTOM_MATCH_LIMITS, DIFFICULTY_LABELS, cloneCustomMatch, validateCustomMatch } from '../content/matches';
import type { CustomMatchSettings, CustomSlot } from '../content/matches';
import type { Difficulty, DropMode } from '../game/core/types';
import { escapeLabel } from './format';

export function customMatchForm(settings: CustomMatchSettings): string {
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
  return `
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
    </form>`;
}

export function readCustomSettings(overlay: HTMLElement): CustomMatchSettings {
  const form = overlay.querySelector<HTMLFormElement>('#custom-form');
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

export function refreshCustomValidation(overlay: HTMLElement, settings = readCustomSettings(overlay)): boolean {
  const errors = validateCustomMatch(settings);
  const errorBox = overlay.querySelector<HTMLElement>('#custom-errors');
  const summary = overlay.querySelector<HTMLElement>('#custom-summary');
  const start = overlay.querySelector<HTMLButtonElement>('[data-action="start-custom"]');
  for (let index = 1; index < 4; index++) {
    const mode = overlay.querySelector<HTMLSelectElement>(`[data-custom-slot="${index}"]`);
    const difficulty = overlay.querySelector<HTMLSelectElement>(`[data-custom-difficulty="${index}"]`);
    if (mode && difficulty) {
      difficulty.disabled = mode.value !== 'bot';
      const label = overlay.querySelector<HTMLElement>(`[data-custom-label="${index}"]`);
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
  return errors.length === 0;
}

function dropModeOptions(selected: DropMode): string {
  const options: [DropMode, string][] = [
    ['all', '全部武器（含终极）'],
    ['standard', '仅标准武器'],
    ['none', '关闭特殊投放'],
  ];
  return options.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

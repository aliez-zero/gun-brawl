import type { HumanSlot } from '../game/core/types';

export type ControlAction = 'left' | 'right' | 'jump' | 'drop' | 'shoot' | 'reload' | 'bomb';
export type KeyBindings = Record<HumanSlot, Record<ControlAction, KeyBinding>>;

export interface KeyBinding {
  readonly codes: readonly string[];
  readonly label: string;
}

/** UI order and labels for the remap panel. */
export const BINDING_ACTIONS: readonly { action: ControlAction; label: string }[] = [
  { action: 'left', label: '左移' },
  { action: 'right', label: '右移' },
  { action: 'jump', label: '跳跃' },
  { action: 'drop', label: '穿台' },
  { action: 'shoot', label: '开火' },
  { action: 'reload', label: '换弹' },
  { action: 'bomb', label: '投弹' },
];

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  1: {
    left: { codes: ['KeyA'], label: 'A' },
    right: { codes: ['KeyD'], label: 'D' },
    jump: { codes: ['KeyW', 'Space'], label: 'W / 空格' },
    drop: { codes: ['KeyS'], label: 'S' },
    shoot: { codes: ['KeyJ'], label: 'J' },
    reload: { codes: ['KeyR'], label: 'R' },
    bomb: { codes: ['KeyK'], label: 'K' },
  },
  2: {
    left: { codes: ['ArrowLeft'], label: '←' },
    right: { codes: ['ArrowRight'], label: '→' },
    jump: { codes: ['ArrowUp'], label: '↑' },
    drop: { codes: ['ArrowDown'], label: '↓' },
    shoot: { codes: ['Enter', 'NumpadEnter', 'Numpad0'], label: 'Enter / 小键盘 0' },
    reload: { codes: ['Numpad2'], label: '小键盘 2' },
    bomb: { codes: ['Numpad1'], label: '小键盘 1' },
  },
};

/** Backwards-compatible alias used by older modules. */
export const KEY_BINDINGS = DEFAULT_KEY_BINDINGS;

const RESERVED = new Set([
  'Escape', 'Tab', 'F5', 'F11', 'F12',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8',
]);

/** Human-readable label for a KeyboardEvent.code value. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `小键盘 ${code.slice(6)}`;
  const fixed: Record<string, string> = {
    Space: '空格', Enter: 'Enter', NumpadEnter: '小键盘 Enter', ArrowLeft: '←', ArrowRight: '→',
    ArrowUp: '↑', ArrowDown: '↓', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/',
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Backquote: '`',
  };
  return fixed[code] ?? code;
}

export const bindingFromCode = (code: string): KeyBinding => ({ codes: [code], label: keyLabel(code) });

export function cloneBindings(bindings: KeyBindings = DEFAULT_KEY_BINDINGS): KeyBindings {
  const cloneSlot = (source: Record<ControlAction, KeyBinding>): Record<ControlAction, KeyBinding> => {
    const result = {} as Record<ControlAction, KeyBinding>;
    for (const { action } of BINDING_ACTIONS) {
      result[action] = { codes: [...source[action].codes], label: source[action].label };
    }
    return result;
  };
  return { 1: cloneSlot(bindings[1]), 2: cloneSlot(bindings[2]) };
}

/** Saved data must never be trusted: malformed / colliding bindings fall back to defaults. */
export function normalizeBindings(value: unknown): KeyBindings {
  const source = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const next = cloneBindings();
  for (const slot of [1, 2] as const) {
    const rawSlot = typeof source[slot] === 'object' && source[slot] !== null ? source[slot] as Record<string, unknown> : {};
    for (const { action } of BINDING_ACTIONS) {
      const raw = rawSlot[action];
      if (typeof raw !== 'object' || raw === null) continue;
      const record = raw as Record<string, unknown>;
      const codes = Array.isArray(record.codes)
        ? [...new Set(record.codes.filter((code): code is string => typeof code === 'string' && code.length > 0))].slice(0, 4)
        : [];
      if (!codes.length || codes.some((code) => RESERVED.has(code))) continue;
      const fallback = next[slot][action];
      const matchesDefault = codes.length === fallback.codes.length && codes.every((code, index) => code === fallback.codes[index]);
      next[slot][action] = { codes, label: matchesDefault ? fallback.label : keyLabel(codes[0]!) };
    }
  }
  return conflicts(next) ? cloneBindings() : next;
}

export function validateCode(bindings: KeyBindings, slot: HumanSlot, action: ControlAction, code: string): string | null {
  if (!code) return '没有识别到按键，请重试。';
  if (RESERVED.has(code)) return `${keyLabel(code)} 是系统 / 训练保留键，不能绑定。`;
  for (const otherSlot of [1, 2] as const) {
    for (const [otherAction, binding] of Object.entries(bindings[otherSlot]) as [ControlAction, KeyBinding][]) {
      if (otherSlot === slot && otherAction === action) continue;
      if (binding.codes.includes(code)) {
        const who = otherSlot === slot ? `本玩家的「${actionLabel(otherAction)}」` : `玩家 ${otherSlot} 的「${actionLabel(otherAction)}」`;
        return `${keyLabel(code)} 已被${who}占用。`;
      }
    }
  }
  return null;
}

export function rebind(
  bindings: KeyBindings, slot: HumanSlot, action: ControlAction, code: string,
): { bindings: KeyBindings; error: string | null } {
  const error = validateCode(bindings, slot, action, code);
  if (error) return { bindings, error };
  const next = cloneBindings(bindings);
  next[slot][action] = bindingFromCode(code);
  return { bindings: next, error: null };
}

function actionLabel(action: ControlAction): string {
  return BINDING_ACTIONS.find((entry) => entry.action === action)?.label ?? action;
}

function conflicts(bindings: KeyBindings): boolean {
  const seen = new Map<string, string>();
  for (const slot of [1, 2] as const) {
    for (const { action } of BINDING_ACTIONS) {
      for (const code of bindings[slot][action].codes) {
        const owner = `${slot}:${action}`;
        const previous = seen.get(code);
        if (previous && previous !== owner) return true;
        seen.set(code, owner);
      }
    }
  }
  return false;
}

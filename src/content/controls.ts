import type { HumanSlot } from '../game/core/types';

export interface KeyBinding {
  readonly codes: readonly string[];
  readonly label: string;
}

type ControlAction = 'left' | 'right' | 'jump' | 'drop' | 'shoot';

export const KEY_BINDINGS: Record<HumanSlot, Record<ControlAction, KeyBinding>> = {
  1: {
    left: { codes: ['KeyA'], label: 'A' },
    right: { codes: ['KeyD'], label: 'D' },
    jump: { codes: ['KeyW', 'Space'], label: 'W / 空格' },
    drop: { codes: ['KeyS'], label: 'S' },
    shoot: { codes: ['KeyJ'], label: 'J' },
  },
  2: {
    left: { codes: ['ArrowLeft'], label: '←' },
    right: { codes: ['ArrowRight'], label: '→' },
    jump: { codes: ['ArrowUp'], label: '↑' },
    drop: { codes: ['ArrowDown'], label: '↓' },
    shoot: { codes: ['Enter', 'NumpadEnter', 'Numpad0'], label: 'Enter / 小键盘 0' },
  },
};

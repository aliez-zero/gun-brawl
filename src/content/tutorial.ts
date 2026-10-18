import type { TrainingTaskId, TrainingState } from '../game/core/types';

export interface TrainingTaskDefinition {
  id: TrainingTaskId;
  title: string;
  hint: string;
}

export const TRAINING_TASKS: readonly TrainingTaskDefinition[] = [
  { id: 'move', title: '移动', hint: '按住左 / 右移动约 0.6 秒。' },
  { id: 'double-jump', title: '二段跳', hint: '在空中再按一次跳跃。' },
  { id: 'drop', title: '穿台', hint: '站在单向平台上按向下。' },
  { id: 'hit', title: '命中假人', hint: '用任意枪的子弹打中训练假人。' },
  { id: 'ringout', title: '击出假人', hint: '把假人推出场地边界。' },
  { id: 'bomb', title: '投弹', hint: '按投弹键，扔出一枚炸弹。' },
];

export function createTrainingState(completed: readonly TrainingTaskId[] = []): TrainingState {
  const valid = new Set(TRAINING_TASKS.map((task) => task.id));
  const completedTasks = [...new Set(completed.filter((id): id is TrainingTaskId => valid.has(id)))];
  const completedMap = Object.fromEntries(TRAINING_TASKS.map((task) => [task.id, completedTasks.includes(task.id)])) as Record<TrainingTaskId, boolean>;
  return { completed: completedMap, completedTasks, moveTime: 0, dummyMoving: true };
}

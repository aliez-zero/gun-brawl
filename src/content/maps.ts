import type { MapDefinition } from '../game/core/types';

export const TRAINING_ARENA: MapDefinition = {
  id: 'training-deck', name: '训练台', width: 1280, height: 720,
  theme: 'training', subtitle: 'THE TRAINING GROUNDS', description: '开阔主平台与对称高台，先找回跳跃和射击的节奏。', accent: 0xb9d77e,
  bounds: { left: -96, right: 1376, top: -240, bottom: 860 },
  platforms: [
    { id: 'main', x: 140, y: 620, width: 1000, height: 24, kind: 'one-way' },
    { id: 'left', x: 40, y: 500, width: 260, height: 18, kind: 'one-way' },
    { id: 'center', x: 470, y: 500, width: 340, height: 18, kind: 'one-way' },
    { id: 'right', x: 980, y: 500, width: 260, height: 18, kind: 'one-way' },
    { id: 'upper-left', x: 240, y: 380, width: 230, height: 18, kind: 'one-way' },
    { id: 'upper-right', x: 810, y: 380, width: 230, height: 18, kind: 'one-way' },
    { id: 'top', x: 530, y: 260, width: 220, height: 18, kind: 'one-way' },
  ],
  spawns: [{ x: 340, y: 620 }, { x: 940, y: 620 }, { x: 520, y: 620 }, { x: 760, y: 620 }],
};

export const SKY_CITADEL: MapDefinition = {
  id: 'sky-citadel', name: '云上古城', theme: 'citadel', subtitle: 'CITADEL ABOVE THE CLOUDS',
  description: '落日、钟塔与云海。沿着悬空石台，争夺古城的最高处。', accent: 0xe2ba76,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    { id: 'citadel-court', x: 150, y: 630, width: 980, height: 28, kind: 'one-way' },
    { id: 'west-bastion', x: 65, y: 510, width: 285, height: 26, kind: 'one-way' },
    { id: 'east-bastion', x: 930, y: 510, width: 285, height: 26, kind: 'one-way' },
    { id: 'clock-bridge', x: 450, y: 495, width: 380, height: 24, kind: 'one-way' },
    { id: 'west-roof', x: 250, y: 375, width: 235, height: 24, kind: 'one-way' },
    { id: 'east-roof', x: 795, y: 375, width: 235, height: 24, kind: 'one-way' },
    { id: 'crown', x: 525, y: 255, width: 230, height: 26, kind: 'one-way' },
  ],
  spawns: [{ x: 320, y: 630 }, { x: 960, y: 630 }, { x: 520, y: 630 }, { x: 760, y: 630 }],
};

export const NEON_CITY: MapDefinition = {
  id: 'neon-city', name: '霓虹天际', theme: 'city', subtitle: 'AFTER HOURS / SKYLINE',
  description: '雨后的摩天楼与霓虹灯。屋顶高低交错，横穿城市的夜空。', accent: 0x79cdd6,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    { id: 'avenue', x: 130, y: 635, width: 1020, height: 26, kind: 'one-way' },
    { id: 'west-rooftop', x: 50, y: 515, width: 330, height: 22, kind: 'one-way' },
    { id: 'east-rooftop', x: 900, y: 515, width: 330, height: 22, kind: 'one-way' },
    { id: 'skywalk', x: 455, y: 490, width: 370, height: 20, kind: 'one-way' },
    { id: 'west-sign', x: 225, y: 380, width: 250, height: 20, kind: 'one-way' },
    { id: 'east-sign', x: 805, y: 365, width: 250, height: 20, kind: 'one-way' },
    { id: 'penthouse', x: 520, y: 245, width: 240, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 310, y: 635 }, { x: 970, y: 635 }, { x: 520, y: 635 }, { x: 760, y: 635 }],
};

export const ALIEN_STARSHIP: MapDefinition = {
  id: 'alien-starship', name: '星际方舟', theme: 'starship', subtitle: 'ARK 07 / DEEP SPACE',
  description: '舷窗外是遥远行星，脚下是悬浮甲板。借助低层通道返回战场。', accent: 0x9bc5fa,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    { id: 'port-deck', x: 115, y: 610, width: 420, height: 26, kind: 'one-way' },
    { id: 'starboard-deck', x: 745, y: 610, width: 420, height: 26, kind: 'one-way' },
    { id: 'lower-airlock', x: 485, y: 675, width: 310, height: 22, kind: 'one-way' },
    { id: 'port-wing', x: 45, y: 490, width: 300, height: 22, kind: 'one-way' },
    { id: 'starboard-wing', x: 935, y: 490, width: 300, height: 22, kind: 'one-way' },
    { id: 'reactor', x: 440, y: 475, width: 400, height: 24, kind: 'one-way' },
    { id: 'port-array', x: 235, y: 355, width: 230, height: 22, kind: 'one-way' },
    { id: 'starboard-array', x: 815, y: 355, width: 230, height: 22, kind: 'one-way' },
    { id: 'observation', x: 525, y: 235, width: 230, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 300, y: 610 }, { x: 980, y: 610 }, { x: 170, y: 610 }, { x: 1110, y: 610 }],
};

export const ARENAS: readonly MapDefinition[] = [SKY_CITADEL, NEON_CITY, ALIEN_STARSHIP, TRAINING_ARENA];
export const isMapId = (value: unknown): value is string => ARENAS.some((map) => map.id === value);
export function getArena(id: string): MapDefinition { return ARENAS.find((map) => map.id === id) ?? TRAINING_ARENA; }

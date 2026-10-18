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
  description: '双塔与窄庭院之间是深谷。抢占断墙，留好二段跳，击退对手越过内侧缺口。', accent: 0xe2ba76,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // The 140px valleys beside the court are lethal below the broken walls.
    { id: 'citadel-court', x: 510, y: 660, width: 260, height: 30, kind: 'one-way' },
    { id: 'west-bastion', x: 110, y: 555, width: 260, height: 28, kind: 'one-way' },
    { id: 'east-bastion', x: 910, y: 555, width: 260, height: 28, kind: 'one-way' },
    { id: 'west-wall', x: 330, y: 445, width: 180, height: 26, kind: 'one-way' },
    { id: 'east-wall', x: 770, y: 445, width: 180, height: 26, kind: 'one-way' },
    { id: 'west-roof', x: 150, y: 320, width: 210, height: 26, kind: 'one-way' },
    { id: 'east-roof', x: 920, y: 320, width: 210, height: 26, kind: 'one-way' },
    { id: 'west-crown', x: 185, y: 200, width: 140, height: 24, kind: 'one-way' },
    { id: 'east-crown', x: 955, y: 200, width: 140, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 230, y: 555 }, { x: 1050, y: 555 }, { x: 565, y: 660 }, { x: 715, y: 660 }],
};

export const NEON_CITY: MapDefinition = {
  id: 'neon-city', name: '霓虹天际', theme: 'city', subtitle: 'AFTER HOURS / SKYLINE',
  description: '高低屋顶之间留出坠落街巷。借广告牌跨楼，底部只有一座窄维修台可供回跳。', accent: 0x79cdd6,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // The narrow service island leaves open falls on both sides of the rooftop route.
    { id: 'west-rooftop', x: 90, y: 610, width: 270, height: 26, kind: 'one-way' },
    { id: 'market-rooftop', x: 505, y: 485, width: 210, height: 24, kind: 'one-way' },
    { id: 'penthouse', x: 960, y: 290, width: 230, height: 26, kind: 'one-way' },
    { id: 'west-sign', x: 190, y: 400, width: 145, height: 18, kind: 'one-way' },
    { id: 'east-sign', x: 755, y: 200, width: 140, height: 18, kind: 'one-way' },
    { id: 'skywalk', x: 735, y: 395, width: 215, height: 20, kind: 'one-way' },
    { id: 'service-bypass', x: 510, y: 690, width: 260, height: 22, kind: 'one-way' },
    { id: 'east-duct', x: 1025, y: 555, width: 140, height: 22, kind: 'one-way' },
  ],
  spawns: [{ x: 235, y: 610 }, { x: 610, y: 485 }, { x: 1075, y: 290 }, { x: 640, y: 690 }],
};

export const ALIEN_STARSHIP: MapDefinition = {
  id: 'alien-starship', name: '星际方舟', theme: 'starship', subtitle: 'ARK 07 / DEEP SPACE',
  description: '窄反应堆连接两侧独立泊台，之间就是太空。气闸只接住核心正下方，失足需尽快回跳。', accent: 0x9bc5fa,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // The airlock catches the core only; dock-to-core gaps stay open to space.
    { id: 'reactor', x: 500, y: 540, width: 280, height: 30, kind: 'one-way' },
    { id: 'port-deck', x: 125, y: 610, width: 230, height: 26, kind: 'one-way' },
    { id: 'starboard-deck', x: 925, y: 610, width: 230, height: 26, kind: 'one-way' },
    { id: 'lower-airlock', x: 540, y: 675, width: 200, height: 22, kind: 'one-way' },
    { id: 'port-transfer', x: 285, y: 430, width: 180, height: 22, kind: 'one-way' },
    { id: 'starboard-transfer', x: 815, y: 430, width: 180, height: 22, kind: 'one-way' },
    { id: 'port-observation', x: 170, y: 285, width: 320, height: 24, kind: 'one-way' },
    { id: 'starboard-observation', x: 790, y: 285, width: 320, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 300, y: 610 }, { x: 980, y: 610 }, { x: 560, y: 540 }, { x: 720, y: 540 }],
};

export const ARENAS: readonly MapDefinition[] = [SKY_CITADEL, NEON_CITY, ALIEN_STARSHIP, TRAINING_ARENA];
export const isMapId = (value: unknown): value is string => ARENAS.some((map) => map.id === value);
export function getArena(id: string): MapDefinition { return ARENAS.find((map) => map.id === id) ?? TRAINING_ARENA; }

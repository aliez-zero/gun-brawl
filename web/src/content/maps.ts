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
  dropPoints: [
    { x: 100, y: 500 }, { x: 640, y: 500 }, { x: 1100, y: 500 },
    { x: 300, y: 380 }, { x: 950, y: 380 },
  ],
};

export const SKY_CITADEL: MapDefinition = {
  id: 'sky-citadel', name: '云上古城', theme: 'citadel', subtitle: 'CITADEL ABOVE THE CLOUDS',
  description: '双塔与断墙围绕低庭院。内侧失足可落回庭院，沿墙登塔，留意外围的悬崖。', accent: 0xe2ba76,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // Inner edges overlap the lower court; the exposed outer cliffs still allow knockouts.
    { id: 'citadel-court', x: 360, y: 660, width: 560, height: 30, kind: 'one-way' },
    { id: 'west-bastion', x: 100, y: 555, width: 310, height: 28, kind: 'one-way' },
    { id: 'east-bastion', x: 870, y: 555, width: 310, height: 28, kind: 'one-way' },
    { id: 'west-wall', x: 310, y: 445, width: 220, height: 26, kind: 'one-way' },
    { id: 'east-wall', x: 750, y: 445, width: 220, height: 26, kind: 'one-way' },
    { id: 'west-roof', x: 150, y: 320, width: 230, height: 26, kind: 'one-way' },
    { id: 'east-roof', x: 900, y: 320, width: 230, height: 26, kind: 'one-way' },
    { id: 'west-crown', x: 180, y: 200, width: 170, height: 24, kind: 'one-way' },
    { id: 'east-crown', x: 930, y: 200, width: 170, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 230, y: 555 }, { x: 1050, y: 555 }, { x: 565, y: 660 }, { x: 715, y: 660 }],
  dropPoints: [
    { x: 420, y: 445 }, { x: 860, y: 445 },
    { x: 250, y: 320 }, { x: 1030, y: 320 },
  ],
};

export const NEON_CITY: MapDefinition = {
  id: 'neon-city', name: '霓虹天际', theme: 'city', subtitle: 'AFTER HOURS / SKYLINE',
  description: '高低屋顶与广告牌构成立体街区。楼间失足可落到维修通道，再借侧台回到屋顶。', accent: 0x79cdd6,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // A lower service route catches transfers between roofs without covering the outskirts.
    { id: 'west-rooftop', x: 80, y: 610, width: 320, height: 26, kind: 'one-way' },
    { id: 'market-rooftop', x: 470, y: 485, width: 280, height: 24, kind: 'one-way' },
    { id: 'penthouse', x: 930, y: 290, width: 270, height: 26, kind: 'one-way' },
    { id: 'west-sign', x: 190, y: 400, width: 180, height: 18, kind: 'one-way' },
    { id: 'east-sign', x: 755, y: 200, width: 175, height: 18, kind: 'one-way' },
    { id: 'skywalk', x: 720, y: 395, width: 260, height: 20, kind: 'one-way' },
    { id: 'service-bypass', x: 330, y: 690, width: 620, height: 22, kind: 'one-way' },
    { id: 'east-duct', x: 900, y: 585, width: 285, height: 22, kind: 'one-way' },
  ],
  spawns: [{ x: 235, y: 610 }, { x: 610, y: 485 }, { x: 1075, y: 290 }, { x: 640, y: 690 }],
  dropPoints: [
    { x: 100, y: 610 }, { x: 300, y: 400 }, { x: 820, y: 200 },
    { x: 850, y: 395 }, { x: 1100, y: 585 },
  ],
};

export const ALIEN_STARSHIP: MapDefinition = {
  id: 'alien-starship', name: '星际方舟', theme: 'starship', subtitle: 'ARK 07 / DEEP SPACE',
  description: '宽反应堆连接两侧泊台，下层气闸接应内侧失足。沿转运台登上观察舱，外围仍通向太空。', accent: 0x9bc5fa,
  width: 1280, height: 720, bounds: { ...TRAINING_ARENA.bounds },
  platforms: [
    // The airlock overlaps both inner dock ends, leaving the outside edges exposed.
    { id: 'reactor', x: 430, y: 540, width: 420, height: 30, kind: 'one-way' },
    { id: 'port-deck', x: 110, y: 610, width: 300, height: 26, kind: 'one-way' },
    { id: 'starboard-deck', x: 870, y: 610, width: 300, height: 26, kind: 'one-way' },
    { id: 'lower-airlock', x: 350, y: 675, width: 580, height: 22, kind: 'one-way' },
    { id: 'port-transfer', x: 270, y: 430, width: 220, height: 22, kind: 'one-way' },
    { id: 'starboard-transfer', x: 790, y: 430, width: 220, height: 22, kind: 'one-way' },
    { id: 'port-observation', x: 160, y: 285, width: 340, height: 24, kind: 'one-way' },
    { id: 'starboard-observation', x: 780, y: 285, width: 340, height: 24, kind: 'one-way' },
  ],
  spawns: [{ x: 300, y: 610 }, { x: 980, y: 610 }, { x: 560, y: 540 }, { x: 720, y: 540 }],
  dropPoints: [
    { x: 150, y: 610 }, { x: 400, y: 430 }, { x: 880, y: 430 },
    { x: 1120, y: 610 }, { x: 250, y: 285 }, { x: 1000, y: 285 },
  ],
};

export const ARENAS: readonly MapDefinition[] = [SKY_CITADEL, NEON_CITY, ALIEN_STARSHIP, TRAINING_ARENA];
export const isMapId = (value: unknown): value is string => ARENAS.some((map) => map.id === value);
export function getArena(id: string): MapDefinition { return ARENAS.find((map) => map.id === id) ?? TRAINING_ARENA; }

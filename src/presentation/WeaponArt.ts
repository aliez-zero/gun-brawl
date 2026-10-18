import { getWeapon } from '../content/weapons';
import type { WeaponId } from '../game/core/types';

const WIDTH = 160;
const HEIGHT = 80;
const SAMPLE = 3;
export const WEAPON_ART = {
  width: WIDTH,
  height: HEIGHT,
  gripX: 46,
  gripY: 46,
  /** Canvas is 3x; this display scale makes rifles readable without covering the body. */
  displayScale: 0.55 / SAMPLE,
  handX: 16,
  handY: 24,
} as const;

/**
 * Scale relative to the 160x80 art grid. The generated canvas is SAMPLE=3
 * larger, so weaponDisplayScale() divides by SAMPLE; forgetting that made a
 * rifle render at ~160 px instead of ~54 px next to a 96 px character.
 */
const MODEL_SCALE: Partial<Record<WeaponId, number>> = {
  pistol: 0.24, p1911: 0.23, deagle: 0.28,
  smg: 0.27, ump45: 0.28, vector: 0.26, uzi: 0.24,
  rifle: 0.33, m416: 0.33, akm: 0.34, 'scar-l': 0.35,
  shotgun: 0.33, s686: 0.32, s1897: 0.35, s12k: 0.31,
  sniper: 0.39, kar98k: 0.39, m24: 0.4, awm: 0.42,
  rocket: 0.38, rpg7: 0.38, at4: 0.4,
  gatling: 0.43, cannon: 0.44,
};

export function weaponDisplayScale(id: WeaponId): number {
  const scale = MODEL_SCALE[id];
  return scale === undefined ? WEAPON_ART.displayScale : scale / SAMPLE;
}

const LINE = '#17232c';

type Ctx = CanvasRenderingContext2D;

function poly(ctx: Ctx, points: number[], fill: string, outline = true): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!, points[1]!);
  for (let index = 2; index < points.length; index += 2) ctx.lineTo(points[index]!, points[index + 1]!);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) { ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.stroke(); }
}

function box(ctx: Ctx, x: number, y: number, width: number, height: number, fill: string, radius = 1): void {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.stroke();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function arc(ctx: Ctx, x: number, y: number, width: number, height: number, start: number, end: number): void {
  ctx.beginPath(); ctx.ellipse(x, y, width / 2, height / 2, 0, start, end);
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.stroke();
}

function pistol(ctx: Ctx): void {
  poly(ctx, [38, 40, 50, 40, 46, 66, 36, 64], '#2b3338');
  box(ctx, 39, 45, 8, 15, '#6b4a36');
  poly(ctx, [22, 26, 64, 26, 70, 32, 68, 40, 24, 40], '#44515b');
  box(ctx, 65, 30, 11, 6, '#9aa8ae');
  line(ctx, 26, 36, 64, 36, '#e0b45a', 1.4);
  box(ctx, 26, 21, 6, 5, '#697984');
  box(ctx, 62, 21, 3, 5, '#697984');
  arc(ctx, 42, 40, 18, 18, 0, Math.PI);
}

function smg(ctx: Ctx): void {
  poly(ctx, [8, 30, 28, 30, 30, 40, 16, 48], '#252e33');
  box(ctx, 28, 26, 60, 18, '#3f4d48', 2);
  box(ctx, 88, 31, 20, 6, '#8c9a97');
  box(ctx, 54, 42, 14, 24, '#29312f', 2);
  box(ctx, 62, 44, 14, 26, '#59645e', 1);
  line(ctx, 30, 32, 78, 32, '#4fc3b1', 1.5);
  line(ctx, 60, 47, 60, 66, '#4fc3b1', 1);
  box(ctx, 34, 21, 42, 4, '#71827b');
}

function rifle(ctx: Ctx): void {
  poly(ctx, [4, 28, 28, 26, 32, 38, 20, 46], '#2e3638');
  line(ctx, 28, 33, 10, 33, '#71807a');
  box(ctx, 28, 24, 56, 20, '#8a7a5c', 2);
  box(ctx, 82, 27, 44, 12, '#5f594b');
  box(ctx, 126, 31, 22, 6, '#8d999a');
  poly(ctx, [54, 44, 68, 44, 66, 70, 52, 68], '#3d423c');
  poly(ctx, [44, 44, 56, 44, 52, 64, 42, 62], '#2e3638');
  box(ctx, 32, 19, 50, 4, '#b0a88f');
  line(ctx, 32, 36, 82, 36, '#f0a23a', 1.5);
  for (let x = 92; x <= 108; x += 8) line(ctx, x, 30, x, 39, '#8b826b', 0.7);
}

function shotgun(ctx: Ctx): void {
  poly(ctx, [4, 28, 30, 26, 34, 40, 18, 48], '#8b5a36');
  box(ctx, 30, 24, 28, 20, '#4a5155', 1);
  box(ctx, 58, 27, 88, 9, '#8a969b');
  box(ctx, 58, 38, 80, 6, '#3f474b');
  box(ctx, 78, 32, 20, 13, '#5e3a26');
  box(ctx, 146, 28, 3, 8, '#30383d');
  line(ctx, 34, 34, 46, 34, '#e05a4f', 1.4);
  arc(ctx, 38, 42, 18, 14, 0, Math.PI);
}

function sniper(ctx: Ctx): void {
  poly(ctx, [2, 28, 34, 26, 38, 38, 20, 48], '#59644a');
  box(ctx, 34, 24, 36, 20, '#343b3f', 1);
  box(ctx, 70, 30, 80, 6, '#8f9a9b');
  box(ctx, 44, 14, 28, 9, '#1e2629', 2);
  box(ctx, 46, 11, 5, 4, '#1e2629');
  box(ctx, 64, 11, 5, 4, '#1e2629');
  line(ctx, 46, 42, 54, 30, '#8f9a9b', 2);
  line(ctx, 36, 36, 68, 36, '#b48ce0', 1.3);
  box(ctx, 146, 27, 4, 7, '#30383d');
  arc(ctx, 38, 42, 17, 14, 0, Math.PI);
}

function gatling(ctx: Ctx): void {
  poly(ctx, [4, 26, 28, 24, 32, 40, 16, 48], '#3d332b');
  box(ctx, 22, 26, 46, 22, '#4e554d', 2);
  box(ctx, 28, 48, 48, 22, '#6d5336', 2);
  line(ctx, 50, 50, 50, 67, '#f2a23a', 1.2);
  for (let barrel = 0; barrel < 6; barrel++) {
    const y = 29 + barrel * 3.2;
    line(ctx, 62, y, 138, y, '#aab4b2', 2.2);
    line(ctx, 62, y + 1, 138, y + 1, '#394448', 0.7);
  }
  box(ctx, 130, 27, 14, 22, '#30383d', 2);
  line(ctx, 134, 30, 134, 46, '#f2a23a', 1.5);
  box(ctx, 40, 20, 26, 5, '#76817c', 1);
  line(ctx, 44, 56, 60, 56, '#c7b184', 1.2);
}

function cannon(ctx: Ctx): void {
  poly(ctx, [2, 30, 30, 26, 36, 42, 20, 50], '#4b3540');
  box(ctx, 30, 24, 44, 24, '#3b4248', 2);
  box(ctx, 70, 30, 78, 12, '#87939a', 1);
  box(ctx, 144, 26, 13, 20, '#30383d', 2);
  line(ctx, 148, 30, 148, 42, '#ff5d73', 1.6);
  box(ctx, 42, 12, 30, 10, '#20282d', 2);
  box(ctx, 44, 8, 5, 4, '#20282d');
  box(ctx, 66, 8, 5, 4, '#20282d');
  line(ctx, 48, 22, 36, 34, '#9fadb2', 2);
  line(ctx, 76, 36, 76, 54, '#59646a', 2);
  line(ctx, 66, 54, 86, 54, '#59646a', 2);
  line(ctx, 70, 34, 70, 58, '#ff5d73', 1.1);
  line(ctx, 74, 36, 74, 42, '#ff5d73', 1.1);
}

function rocket(ctx: Ctx): void {
  poly(ctx, [0, 24, 8, 24, 8, 46, 0, 46], '#3f4740');
  box(ctx, 8, 27, 124, 16, '#5f6248', 2);
  box(ctx, 45, 25, 30, 20, '#7a4b2e', 2);
  poly(ctx, [132, 20, 156, 35, 132, 50], '#6b7050');
  box(ctx, 58, 42, 14, 24, '#2e3530', 2);
  box(ctx, 78, 20, 13, 5, '#30383d');
  line(ctx, 10, 32, 40, 32, '#f2c94c', 1.6);
  line(ctx, 55, 30, 55, 43, '#f2c94c', 1);
  arc(ctx, 50, 42, 18, 16, 0, Math.PI);
}

const PAINTERS: Partial<Record<WeaponId, (ctx: Ctx) => void>> = {
  pistol, smg, rifle, shotgun, sniper, rocket, gatling, cannon,
};

/** Tight local-space content boxes for HUD / crate icons (no grip-origin margins). */
const ICON_BOUNDS: Partial<Record<WeaponId, { x: number; y: number; width: number; height: number }>> = {
  pistol: { x: 18, y: 16, width: 62, height: 54 },
  smg: { x: 8, y: 19, width: 102, height: 54 },
  rifle: { x: 4, y: 17, width: 146, height: 55 },
  shotgun: { x: 4, y: 24, width: 148, height: 48 },
  sniper: { x: 2, y: 10, width: 150, height: 62 },
  rocket: { x: 0, y: 18, width: 158, height: 50 },
  gatling: { x: 4, y: 18, width: 150, height: 56 },
  cannon: { x: 0, y: 8, width: 158, height: 62 },
};

/** Silhouette-level changes so each model reads beyond its family + accent color. */
const MODEL_GEOMETRY: Partial<Record<WeaponId, (ctx: Ctx) => void>> = {
  p1911: (ctx) => {
    box(ctx, 20, 25, 38, 15, '#4b565c', 2);
    box(ctx, 56, 28, 10, 7, '#9aa8ae');
    box(ctx, 34, 43, 10, 20, '#7a5539', 1);
  },
  deagle: (ctx) => {
    box(ctx, 20, 22, 48, 19, '#3e4a52', 2);
    box(ctx, 66, 24, 16, 12, '#b8a16a', 1);
    line(ctx, 24, 25, 62, 25, '#d8b45a', 1.4);
  },
  ump45: (ctx) => {
    poly(ctx, [2, 27, 26, 26, 28, 40, 12, 48], '#252e33');
    box(ctx, 26, 25, 58, 19, '#394842', 2);
    box(ctx, 54, 42, 16, 24, '#29312f', 2);
  },
  vector: (ctx) => {
    poly(ctx, [4, 32, 26, 27, 30, 42, 10, 48], '#252e33');
    box(ctx, 28, 24, 52, 20, '#384640', 2);
    box(ctx, 50, 42, 14, 19, '#29312f', 2);
  },
  uzi: (ctx) => {
    box(ctx, 34, 22, 48, 18, '#303b40', 2);
    box(ctx, 54, 38, 12, 28, '#29312f', 2);
    box(ctx, 82, 30, 14, 6, '#8c9a97');
  },
  m416: (ctx) => {
    box(ctx, 2, 27, 26, 11, '#4b4e44', 1);
    box(ctx, 30, 22, 54, 21, '#7f765d', 1);
    box(ctx, 82, 28, 48, 11, '#5f594b');
  },
  akm: (ctx) => {
    poly(ctx, [2, 26, 28, 25, 32, 42, 14, 48], '#7c5a39');
    box(ctx, 28, 23, 56, 20, '#7b6445', 1);
    poly(ctx, [52, 43, 68, 43, 64, 70, 52, 66], '#3d423c');
  },
  'scar-l': (ctx) => {
    poly(ctx, [2, 28, 28, 25, 32, 40, 16, 48], '#595b4e');
    box(ctx, 30, 22, 70, 22, '#8b826b', 1);
    box(ctx, 100, 28, 28, 9, '#5f594b');
  },
  s686: (ctx) => {
    box(ctx, 58, 24, 88, 8, '#8a969b', 2);
    box(ctx, 58, 33, 88, 8, '#8a969b', 2);
    box(ctx, 30, 22, 30, 22, '#4a5155', 1);
  },
  s1897: (ctx) => {
    box(ctx, 58, 26, 82, 8, '#8a969b', 1);
    box(ctx, 76, 35, 24, 13, '#6b4a32', 2);
    box(ctx, 58, 42, 82, 5, '#3f474b');
  },
  s12k: (ctx) => {
    box(ctx, 58, 25, 62, 8, '#8a969b', 1);
    box(ctx, 64, 38, 20, 22, '#2e3538', 2);
    box(ctx, 30, 22, 30, 22, '#4a5155', 1);
  },
  kar98k: (ctx) => {
    poly(ctx, [2, 27, 34, 25, 38, 42, 18, 49], '#6b5236');
    box(ctx, 34, 23, 38, 21, '#3b413d', 1);
    line(ctx, 50, 34, 60, 27, '#c7b184', 2);
  },
  m24: (ctx) => {
    box(ctx, 34, 22, 38, 22, '#30383b', 1);
    box(ctx, 70, 30, 82, 5, '#9aa5a6');
    box(ctx, 42, 12, 38, 8, '#1e2629', 2);
  },
  awm: (ctx) => {
    poly(ctx, [2, 29, 34, 26, 38, 40, 22, 49], '#3f4a43');
    box(ctx, 34, 23, 34, 21, '#2d3538', 1);
    box(ctx, 144, 23, 12, 15, '#30383d', 2);
    line(ctx, 68, 34, 145, 34, '#9aa5a6', 2.2);
  },
  rpg7: (ctx) => {
    box(ctx, 8, 26, 126, 18, '#5f6248', 2);
    poly(ctx, [132, 18, 158, 35, 132, 52], '#737a54');
    box(ctx, 44, 23, 36, 23, '#8a5734', 2);
  },
  at4: (ctx) => {
    box(ctx, 8, 27, 126, 15, '#6b6f55', 2);
    poly(ctx, [132, 23, 154, 29, 154, 41, 132, 47], '#4f5544');
    box(ctx, 28, 22, 76, 5, '#8b9070');
  },
};

interface ModelAccent { color: string; style: 'wood' | 'gold' | 'rail' | 'double' | 'scope' | 'ring' | 'stripe'; x: number; y: number; width: number; height: number }

const MODEL_ACCENTS: Partial<Record<WeaponId, ModelAccent>> = {
  p1911: { color: '#9b6a43', style: 'wood', x: 36, y: 44, width: 12, height: 22 },
  deagle: { color: '#d8b45a', style: 'gold', x: 66, y: 28, width: 13, height: 10 },
  ump45: { color: '#4fc3b1', style: 'stripe', x: 32, y: 28, width: 54, height: 6 },
  vector: { color: '#f0a23a', style: 'stripe', x: 34, y: 38, width: 42, height: 5 },
  uzi: { color: '#e05a4f', style: 'stripe', x: 36, y: 27, width: 38, height: 5 },
  m416: { color: '#f0a23a', style: 'rail', x: 32, y: 20, width: 54, height: 4 },
  akm: { color: '#9b6a43', style: 'wood', x: 6, y: 26, width: 30, height: 20 },
  'scar-l': { color: '#f0a23a', style: 'rail', x: 30, y: 19, width: 70, height: 4 },
  s686: { color: '#e05a4f', style: 'double', x: 58, y: 26, width: 88, height: 20 },
  s1897: { color: '#e05a4f', style: 'double', x: 58, y: 38, width: 80, height: 7 },
  s12k: { color: '#e05a4f', style: 'stripe', x: 58, y: 27, width: 60, height: 5 },
  kar98k: { color: '#b48ce0', style: 'ring', x: 146, y: 26, width: 5, height: 10 },
  m24: { color: '#b48ce0', style: 'scope', x: 44, y: 12, width: 34, height: 9 },
  awm: { color: '#b48ce0', style: 'ring', x: 145, y: 24, width: 7, height: 16 },
  rpg7: { color: '#9b6a43', style: 'wood', x: 45, y: 25, width: 30, height: 20 },
  at4: { color: '#f2c94c', style: 'rail', x: 10, y: 26, width: 116, height: 5 },
};

const FAMILY_ACCENT: Partial<Record<WeaponId, string>> = {
  pistol: '#e0b45a', smg: '#4fc3b1', rifle: '#f0a23a', shotgun: '#e05a4f',
  sniper: '#b48ce0', rocket: '#f2c94c', gatling: '#f2a23a', cannon: '#ff5d73',
};

export function weaponFamily(id: WeaponId): WeaponId {
  return getWeapon(id).family ?? id;
}

export function weaponAccentColor(id: WeaponId): string {
  return MODEL_ACCENTS[id]?.color ?? FAMILY_ACCENT[weaponFamily(id)] ?? '#aab4b7';
}

function drawModelAccent(ctx: Ctx, id: WeaponId): void {
  const accent = MODEL_ACCENTS[id];
  if (!accent) return;
  if (accent.style === 'wood') box(ctx, accent.x, accent.y, accent.width, accent.height, accent.color, 1);
  if (accent.style === 'gold') poly(ctx, [accent.x, accent.y, accent.x + accent.width, accent.y + accent.height / 2, accent.x, accent.y + accent.height], accent.color);
  if (accent.style === 'rail') line(ctx, accent.x, accent.y, accent.x + accent.width, accent.y, accent.color, 2);
  if (accent.style === 'double') line(ctx, accent.x, accent.y, accent.x + accent.width, accent.y, accent.color, 2);
  if (accent.style === 'scope') box(ctx, accent.x, accent.y, accent.width, accent.height, '#20282d', 2);
  if (accent.style === 'ring') line(ctx, accent.x, accent.y, accent.x, accent.y + accent.height, accent.color, 2.2);
  if (accent.style === 'stripe') line(ctx, accent.x, accent.y, accent.x + accent.width, accent.y + accent.height, accent.color, 1.6);
}

export function weaponArtKey(id: WeaponId): string {
  return `weapon-art-${id}`;
}

export function weaponIconKey(id: WeaponId): string {
  return `weapon-icon-${id}`;
}

/** Cropped silhouette for 32-64 px HUD slots and crate labels. */
export function createWeaponIconCanvas(id: WeaponId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 120;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  const source = createWeaponArtCanvas(id);
  const bounds = ICON_BOUNDS[weaponFamily(id)] ?? ICON_BOUNDS.pistol!;
  ctx.drawImage(
    source,
    bounds.x * SAMPLE, bounds.y * SAMPLE, bounds.width * SAMPLE, bounds.height * SAMPLE,
    0, 0, canvas.width, canvas.height,
  );
  return canvas;
}

export function createWeaponArtCanvas(id: WeaponId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SAMPLE;
  canvas.height = HEIGHT * SAMPLE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SAMPLE, SAMPLE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const paint = PAINTERS[weaponFamily(id)] ?? PAINTERS.pistol!;
  paint(ctx);
  MODEL_GEOMETRY[id]?.(ctx);
  drawModelAccent(ctx, id);
  return canvas;
}

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

const PAINTERS: Record<WeaponId, (ctx: Ctx) => void> = {
  pistol, smg, rifle, shotgun, sniper, rocket,
};

/** Tight local-space content boxes for HUD / crate icons (no grip-origin margins). */
const ICON_BOUNDS: Record<WeaponId, { x: number; y: number; width: number; height: number }> = {
  pistol: { x: 18, y: 16, width: 62, height: 54 },
  smg: { x: 8, y: 19, width: 102, height: 54 },
  rifle: { x: 4, y: 17, width: 146, height: 55 },
  shotgun: { x: 4, y: 24, width: 148, height: 48 },
  sniper: { x: 2, y: 10, width: 150, height: 62 },
  rocket: { x: 0, y: 18, width: 158, height: 50 },
};

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
  const bounds = ICON_BOUNDS[id];
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
  PAINTERS[id](ctx);
  return canvas;
}

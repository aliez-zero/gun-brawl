import type { CharacterAppearance } from '../../game/core/types';

export const INK = '#252d35';
export const colorCss = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;
export function tint(value: number, amount: number): string {
  const channel = (shift: number): number => {
    const n = (value >> shift) & 255;
    return Math.round(amount > 0 ? n + (255 - n) * amount : n * (1 + amount));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

/** Shared lighting and stroke weight; garment silhouettes belong to each artist. */
export function artBrush(ctx: CanvasRenderingContext2D, look: CharacterAppearance) {
  const gradient = (light: string, mid: string, dark: string, x = -9, y = -22, w = 20, h = 35): CanvasGradient => {
    const result = ctx.createLinearGradient(x, y, x + w, y + h);
    result.addColorStop(0, light); result.addColorStop(0.55, mid); result.addColorStop(1, dark); return result;
  };
  const shape = (path: string, fill: string | CanvasGradient, outline = true): void => {
    const p = new Path2D(path); ctx.fillStyle = fill; ctx.fill(p);
    if (outline) { ctx.strokeStyle = INK; ctx.lineWidth = 0.85; ctx.stroke(p); }
  };
  const line = (path: string, color: string, width = 0.65): void => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(new Path2D(path));
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, outline = false): void => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = INK; ctx.lineWidth = 0.75; ctx.stroke(); }
  };
  const box = (x: number, y: number, w: number, h: number, fill: string | CanvasGradient, radius = 1): void => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.75; ctx.stroke();
  };
  const cloth = colorCss(look.color), light = tint(look.color, 0.27), dark = tint(look.color, -0.36);
  const skin = colorCss(look.skin), skinLight = tint(look.skin, 0.16), skinDark = tint(look.skin, -0.23);
  return { shape, line, ellipse, box, gradient, cloth, light, dark, skin, skinLight, skinDark,
    fabric: gradient(light, cloth, dark), steel: gradient('#d4dfe0', '#8ba5b2', '#4d6778'),
    gold: '#d6b677', leather: '#59443a', rubber: '#303c49' };
}
export type ArtBrush = ReturnType<typeof artBrush>;

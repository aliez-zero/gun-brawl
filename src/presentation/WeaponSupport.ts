import { getWeapon } from '../content/weapons';
import type { WeaponId } from '../game/core/types';

/** Local art coordinates (160 x 80) where the support hand meets the weapon. */
const SUPPORT_GRIP: Partial<Record<string, { x: number; y: number }>> = {
  smg: { x: 88, y: 39 },
  rifle: { x: 99, y: 41 },
  shotgun: { x: 101, y: 39 },
  sniper: { x: 106, y: 35 },
  rocket: { x: 91, y: 42 },
  gatling: { x: 92, y: 41 },
  cannon: { x: 92, y: 41 },
};

export function supportGrip(id: WeaponId): { x: number; y: number } | null {
  const family = getWeapon(id).family ?? id;
  return SUPPORT_GRIP[family] ?? null;
}

export function supportHandKey(skin: number): string {
  return `support-hand-${skin}`;
}

export function gripHandKey(skin: number): string {
  return `grip-hand-${skin}`;
}

/** A small foreground fist at the trigger grip, so the stock does not swallow the hand. */
export function createGripHandCanvas(skin: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 14; canvas.height = 12;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#152531'; ctx.lineWidth = 1.1;
  ctx.fillStyle = '#394b52';
  ctx.beginPath(); ctx.roundRect(0.5, 3, 9, 7, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = `#${skin.toString(16).padStart(6, '0')}`;
  ctx.beginPath(); ctx.roundRect(4.5, 2, 7, 5.5, 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = shade(skin); ctx.lineWidth = 0.7;
  for (let finger = 0; finger < 3; finger++) {
    ctx.beginPath(); ctx.moveTo(5, 3.2 + finger * 1.6); ctx.lineTo(11, 3.4 + finger * 1.5); ctx.stroke();
  }
  return canvas;
}

function shade(color: number): string {
  const value = Math.max(0, Math.min(255, color));
  const channel = Math.round(value * 0.78);
  return `#${channel.toString(16).padStart(2, '0')}${Math.round(value * 0.82).toString(16).padStart(2, '0')}${Math.round(value * 0.86).toString(16).padStart(2, '0')}`;
}

/**
 * A small procedural glove / forearm. The character atlas keeps its trigger hand;
 * this layer adds the support hand for two-handed families without rebuilding looks.
 */
export function createSupportHandCanvas(skin: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 20; canvas.height = 16;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#152531'; ctx.lineWidth = 1.2;

  ctx.fillStyle = '#3b4b52';
  ctx.beginPath(); ctx.roundRect(0, 7, 5, 6, 1.5); ctx.fill(); ctx.stroke();

  ctx.fillStyle = `#${skin.toString(16).padStart(6, '0')}`;
  ctx.beginPath(); ctx.roundRect(4, 4, 9, 9, 2.5); ctx.fill(); ctx.stroke();

  for (let finger = 0; finger < 3; finger++) {
    ctx.beginPath();
    ctx.roundRect(12, 4.5 + finger * 2.6, 6, 1.8, 0.9);
    ctx.fillStyle = finger === 1 ? shade(skin) : `#${skin.toString(16).padStart(6, '0')}`;
    ctx.fill(); ctx.stroke();
  }

  ctx.strokeStyle = shade(skin); ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(7, 12); ctx.lineTo(11, 12); ctx.stroke();
  return canvas;
}

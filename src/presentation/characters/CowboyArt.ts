import type { CharacterAppearance } from '../../game/core/types';
import type { CowboyPart, CowboyPose } from './CowboyRig';
import { COWBOY_PARTS } from './CowboyRig';

type Context = CanvasRenderingContext2D;
const INK = '#252b31';
const css = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;
function tint(color: number, amount: number): string {
  const channel = (shift: number): number => {
    const value = (color >> shift) & 255;
    return Math.round(amount > 0 ? value + (255 - value) * amount : value * (1 + amount));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

/** Curved silhouettes, broad material planes and sparse seams remain readable at 1x. */
export function paintCowboyPart(ctx: Context, look: CharacterAppearance, part: CowboyPart): void {
  const cloth = css(look.color), dark = tint(look.color, -0.42), lit = tint(look.color, 0.28);
  const skin = css(look.skin), skinDark = tint(look.skin, -0.24), skinLight = tint(look.skin, 0.17);
  const gold = '#d4b372', leather = '#594034', leatherLight = '#927052', cream = '#ded2b4';
  const gradient = (a: string, b: string, c: string, x1 = -12, y1 = -18, x2 = 16, y2 = 12): CanvasGradient => {
    const result = ctx.createLinearGradient(x1, y1, x2, y2);
    result.addColorStop(0, a); result.addColorStop(0.5, b); result.addColorStop(1, c); return result;
  };
  const shape = (path: string, fill: string | CanvasGradient, outline = true): void => {
    const p = new Path2D(path); ctx.fillStyle = fill; ctx.fill(p);
    if (outline) { ctx.strokeStyle = INK; ctx.lineWidth = 0.85; ctx.stroke(p); }
  };
  const line = (path: string, color: string, width = 0.7): void => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(new Path2D(path));
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, color: string, outline = false): void => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    if (outline) { ctx.strokeStyle = INK; ctx.lineWidth = 0.9; ctx.stroke(); }
  };
  const box = (x: number, y: number, w: number, h: number, fill: string, r = 1): void => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.85; ctx.stroke();
  };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (part) {
    case 'coatBack':
      shape('M-7-22 Q-12-22-12-12 L-14 18 Q-9 20-3 16 L1 3 6 17 13 15 Q10-3 10-20Z', gradient(lit, dark, '#37313a'));
      shape('M-9-13 Q-11 2-11 16 L-7 16-4-7Z', cloth, false);
      line('M-10-11-12 16-7 17 M7-9 11 13 8 15', '#c2986c', 0.55);
      break;
    case 'thighBack': case 'thigh': {
      const back = part === 'thighBack';
      shape('M-3.8 0 Q-3.8-3 0-3 Q3.7-3 3.9 0 L3.1 14 Q2 17-2.8 15 L-3.8 2Z', gradient(back ? '#526068' : '#718088', back ? '#354752' : '#495d69', '#2a3541', -4, 0, 6, 16));
      line('M-1.8 1-1.2 11', back ? '#566571' : '#95a09a', 0.55);
      if (!back) line('M2 1 2.2 9', '#b69b7c', 0.5);
      break;
    }
    case 'shinBack': case 'shin':
      shape('M-2.9 0 Q-2.6-2 0-2 Q2.8-2 3 0 Q2.5 8 2 14 L-2 15 Q-2.6 8-2.9 0Z', gradient('#71818a', '#41525e', '#303b46', -4, 0, 4, 15));
      line('M-1 3-0.7 10', '#8b9b9b', 0.55);
      break;
    case 'bootBack': case 'boot':
      shape('M-3.1-6 2.5-6 2.8 0 Q5 1 7 2 L7 4.5 Q1 5.3-4 4.5 L-4 1Z', gradient(leatherLight, leather, '#302d32', -4, -7, 7, 5));
      shape('M-4 3 Q1 4 7 3.5 L7 5-4 5Z', '#252b32', false);
      line('M-2-4 1.5-4 M-2-2-1 1 2 2', '#c9a17a', 0.55);
      line('M-3 0 2.5 0', '#292a30', 1.1);
      ellipse(-0.8, 0, 0.65, 0.65, gold);
      break;
    case 'torso':
      shape('M-8-23 Q-3-25 3-24 L8-23 Q12-22 12-18 L9 2 Q1 4-9 2 L-12-17 Q-12-21-8-23Z', gradient(lit, cloth, dark));
      shape('M-4-23 5-23 5-2-4-2Z', gradient('#eee2c4', cream, '#a69377'));
      shape('M-10-22-5-24-1-9-7-12-9-7Z', dark);
      shape('M5-24 10-21 7-9 3-6Z', lit);
      line('M-9-21-4-12-7-13 M8-20 5-10', '#dec39a', 0.55);
      // A readable brass badge and pocket, with fewer competing little marks.
      shape('M-7-18-6-16.3-4-16-5.5-14.6-5.2-12.8-7-13.7-8.8-12.8-8.5-14.6-10-16-8-16.3Z', gold);
      ellipse(-7, -15.5, 0.6, 0.6, '#fff1bf');
      line('M5-9 9-10 9-6 M-2-19-2-5', '#8c7259', 0.65);
      for (const y of [-17, -12, -7]) ellipse(0, y, 0.65, 0.65, leather);
      shape('M-9.5-1 10-1 9.5 2.7-9.5 2.7Z', leather);
      line('M-8 0 8 0', leatherLight, 0.5);
      box(-0.7, -1, 4.5, 3.7, gold, 0.6); box(0.4, 0, 2.2, 1.5, leather, 0.2);
      for (const x of [-7, -5]) ellipse(x, 1, 0.35, 0.35, '#dac49e');
      // Neck and bandana stay with the chest while the head counter-rotates.
      shape('M-2.8-28 4-28 4.5-22-3-22Z', skinDark);
      shape('M-6.5-23.6 Q0-21.5 7-24 L5.5-20 1-16.5-5-20.5Z', gradient('#dd8975', '#a94d53', '#783b48'));
      line('M-4.5-22 1-20.5 5-22 M0-19 1.5-18', '#f3b190', 0.55);
      break;
    case 'coatFront':
      shape('M-1 1 3-1 Q4 8 6 15 L1 17-2 13Z', gradient(lit, cloth, dark, -2, 0, 7, 16));
      line('M2.5 4 4 13 1 15', '#d5aa7c', 0.5);
      // Holster is a separate strong shape, rather than a mark on the trouser leg.
      shape('M1 1 5 1 6 5 4.5 12 0.5 11Z', gradient('#947455', leather, '#342e31', 0, 0, 7, 13));
      shape('M2 2 3-3 5-2 4.8 3Z', '#424b51');
      line('M2 6 4 6.5 3 10', '#bd9468', 0.55); ellipse(2.7, 4.5, 0.6, 0.6, gold);
      break;
    case 'scarfTail':
      shape('M2-1 Q-6-3-16 0 L-12 2-15 5 Q-7 3 1 3Z', gradient('#d98173', '#b25459', '#753b49', -17, -3, 2, 5));
      line('M-2 0.5 Q-7-0.5-12 1.5', '#efad92', 0.55);
      break;
    case 'head':
      // Smaller head with an exposed forehead, eyes, jaw and a visible neck.
      shape('M-7-10 Q-6-15 0-14 Q7-14 8-8 L8-4 10-1.8 8.2-0.6 7 2.5 Q3 6-2 4 L-6 1Z', gradient(skinLight, skin, skinDark, -7, -14, 9, 6));
      shape('M-7-9 Q-8-14-1-15 Q5-16 8-10 L4-11 0-12-4-9-5-3-7-3Z', '#453a35');
      ellipse(-7, -3, 1.8, 2.4, skinDark, true);
      line('M-7.6-3.5-6.5-3-7-1.8', skinLight, 0.6);
      shape('M-5.8-7-4-6.5-4-1.5-5.5-1.5Z', '#554138', false);
      shape('M4-5 7.5-5 8-2.5 5.5-1.5Z', tint(look.skin, -0.07), false);
      line('M-2.7-7.8 0-8 M4.4-8.2 6.8-8', '#4a3830', 0.8);
      ellipse(-0.8, -5.7, 1.05, 1, '#f2e9d7'); ellipse(5.4, -5.8, 0.85, 0.9, '#f2e9d7');
      ellipse(-0.4, -5.6, 0.55, 0.8, '#303330'); ellipse(5.7, -5.7, 0.5, 0.7, '#303330');
      line('M3.8-5 3.8-2.5 5.5-2', skinDark, 0.65);
      shape('M-3.5 0 Q1.5 2 7.7-0.2 L6.5 3 Q2 5-1.6 3Z', '#85614d', false);
      shape('M0-0.4 2-1 4-0.3 6 0 4.4 1 2 0.5 0 1Z', '#554034', false);
      line('M1.1 2.2 4.2 2', '#4d3831', 0.55);
      line('M-2 1.5-1.3 2 M5 1.7 5 2.6', '#c5a185', 0.5);
      break;
    case 'hat':
      if (look.hat === 'none') break;
      if (look.hat === 'cowboy') {
        shape('M-9 0-9-7 Q-8-12-4-10 L0-7 5-10 Q9-12 10-7 L11 0Z', gradient('#dfbd84', '#a87b4f', '#71523e', -10, -12, 12, 4));
        shape('M-9-2 Q0-1 10-3 L11 0 Q0 3-10 1Z', '#5a3d32');
        line('M-6-8-3-6 M5-7 7-9', '#efd4a1', 0.55);
        // Curled brim with a lit top surface and a distinct dark underside.
        shape('M-23-2 Q-18 1-12 0 Q1 3 13-0.5 L22-4 Q22 0 17 2 Q2 6-12 3 Q-20 4-23-2Z', gradient('#ead0a0', '#bb925f', '#78573e', -23, -3, 20, 5));
        line('M-19 0 Q-15 2-11 1 Q4 4 19-1', '#f5dfb1', 0.65);
        shape('M-12 3 Q1 5 13 2.5 Q2 6-12 3Z', '#553d33', false);
        box(5.5, -2.4, 3, 2.7, gold, 0.5); box(6.3, -1.7, 1.5, 1.3, '#765c3e', 0.2);
      } else if (look.hat === 'straw') {
        ctx.scale(0.78, 0.78);
        shape('M-28 3-4-14 3-13 28 3 Q4 12-28 3Z', gradient('#ead4a3', '#bea16d', '#7b694b'));
        for (const x of [-22, -14, -5, 5, 14, 22]) line(`M-2-11 ${x} 3`, '#8b7553', 0.55);
        line('M-24 4 Q0 9 24 3', '#f8e1b1', 1.1);
      } else if (look.hat === 'beret') {
        ctx.scale(0.78, 0.78);
        shape('M-13 1 Q-19-8-9-12 Q7-17 18-8 L12 1Z', gradient('#899b86', '#475f54', '#2e4140'));
        shape('M-13-1 13-2 12 2-12 3Z', '#2c3538');
        box(6, -8, 4, 6, gold); line('M-8-8 Q0-12 9-9', '#a8b29a');
      } else if (look.hat === 'space') {
        ctx.scale(0.72, 0.72);
        // Helmet is centered on the actual new head socket, not the old atlas head.
        ctx.beginPath(); ctx.ellipse(0, 9, 19, 22, 0, 0, Math.PI * 2);
        ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = '#bfced0'; ctx.lineWidth = 3.5; ctx.stroke();
        ellipse(0, 9, 17, 20, '#619cab35');
        line('M-12 1 Q-9-5-3-7', '#eff4df', 1.6); box(-22, 4, 5, 13, '#6a8996'); box(17, 4, 5, 13, '#6a8996');
        shape('M-12 25 Q1 30 13 24 L10 31-9 31Z', '#c5d1cd');
      } else if (look.hat === 'knight') {
        ctx.scale(0.68, 0.68);
        shape('M-14 6-15-4 Q-13-13 0-14 Q13-13 15-4 L14 6Z', gradient('#e3e8d9', '#a2b7bb', '#586f7d'));
        shape('M-14 5 15 4 16 12 5 18-13 14Z', '#607987');
        line('M-10 7 12 6', '#d6ded3', 1.2);
        for (const x of [-7, -2, 3, 8]) line(`M${x} 9 ${x} 13`, INK, 1.1);
        shape('M-2-14 Q-8-17 2-16 L14-14 5-12Z', '#b45b67');
      }
      break;
    case 'upperBack': case 'upper':
      shape('M-3.4 1 Q-3.5-2.5 0-2.7 Q3.6-2.7 3.6 1 L2.8 15 Q2 17-2.5 16Z', gradient(lit, cloth, dark, -4, 0, 4, 17));
      line('M-1.8 1-1.4 11', '#d0a783', 0.5);
      shape('M-2.8 12.8 3 12.8 2.7 16.5-2.6 16.5Z', leatherLight);
      line('M-1.5 13.8 1.7 13.8', '#dec5a0', 0.45);
      break;
    case 'foreBack': case 'fore':
      shape('M-2.5 0 Q-2.5-1.8 0-2 Q2.6-1.8 2.6 0 Q2.4 7 1.7 15.5 L-1.8 15.5 Q-2.3 8-2.5 0Z', gradient(skinLight, skin, skinDark, -3, 0, 3, 16));
      // Leather wrist wrap separates sleeve, forearm and fingers.
      shape('M-1.9 12.5 2 12.5 1.8 15.5-1.8 15.5Z', leather);
      line('M-0.8 13.5 1 13.5', leatherLight, 0.5);
      break;
    case 'handBack': case 'hand':
      shape('M-2-1.5 Q0-2.5 2-1.5 L3 0.5 Q3 2.7 1 3 L-1.5 2.5-2.5 0Z', gradient(skinLight, skin, skinDark, -3, -2, 3, 4));
      line('M0 0.6 1.8 0.6 M0 1.8 1.6 1.8', skinDark, 0.45);
      break;
    case 'previewGun':
      shape('M-2-4 4-4 1 5-4 4Z', leather);
      shape('M-4-11 20-11 21-5-4-5Z', gradient('#c9d2cc', '#748894', '#3b4b57', 0, -12, 0, -4));
      box(18, -10, 4, 4, INK, 0.4); line('M-2-10 15-10', '#e9ddbc');
      break;
  }
  ctx.restore();
}

export const COWBOY_ATLAS = { width: 240, height: 288, columns: 5, sample: 3, originX: 0.5, originY: 56 / 96 } as const;
export function cowboyArtKey(look: CharacterAppearance): string {
  return `cowboy-rig-v2-${look.hat}-${look.color}-${look.skin}`;
}
export function createCowboyAtlas(look: CharacterAppearance): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = COWBOY_ATLAS.width * COWBOY_ATLAS.columns;
  canvas.height = COWBOY_ATLAS.height * Math.ceil(COWBOY_PARTS.length / COWBOY_ATLAS.columns);
  const ctx = canvas.getContext('2d')!;
  COWBOY_PARTS.forEach((part, index) => {
    const x = index % COWBOY_ATLAS.columns * COWBOY_ATLAS.width;
    const y = Math.floor(index / COWBOY_ATLAS.columns) * COWBOY_ATLAS.height;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, COWBOY_ATLAS.width, COWBOY_ATLAS.height); ctx.clip();
    ctx.translate(x + COWBOY_ATLAS.width * COWBOY_ATLAS.originX, y + COWBOY_ATLAS.height * COWBOY_ATLAS.originY);
    ctx.scale(COWBOY_ATLAS.sample, COWBOY_ATLAS.sample);
    paintCowboyPart(ctx, look, part); ctx.restore();
  });
  return canvas;
}

/** Editor and battle use the very same parts and joint transforms. */
export function paintCowboy(ctx: Context, look: CharacterAppearance, pose: CowboyPose, withGun = true): void {
  for (const bone of pose.parts) {
    if (bone.part === 'previewGun' && !withGun) continue;
    ctx.save(); ctx.translate(bone.x, bone.y); ctx.rotate(bone.rotation); ctx.scale(1, bone.scaleY);
    paintCowboyPart(ctx, look, bone.part); ctx.restore();
  }
}

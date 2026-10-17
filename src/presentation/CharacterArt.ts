import type { CharacterAppearance } from '../game/core/types';

export const CHARACTER_FRAME = { width: 240, height: 288, scale: 3, feet: 88 / 96 } as const;
export interface CharacterPose { stride?: number; airborne?: boolean; recoil?: number; hurt?: boolean }
export const colorCss = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function shade(color: number, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const mix = (channel: number): number => Math.round(channel + (target - channel) * Math.abs(amount));
  return `rgb(${mix(color >> 16)},${mix((color >> 8) & 255)},${mix(color & 255)})`;
}

/** Shared artwork for the dressing-room canvas and the in-game sprite atlas. Coordinates are feet-centred. */
export function paintCharacter(ctx: CanvasRenderingContext2D, look: CharacterAppearance, pose: CharacterPose = {}, withGun = true): void {
  const line = '#17232c';
  const color = colorCss(look.color);
  const dark = shade(look.color, -0.42);
  const light = shade(look.color, 0.32);
  const skin = colorCss(look.skin);
  const skinShade = shade(look.skin, -0.2);
  const stride = pose.airborne ? 3 : pose.stride ?? 0;
  const recoil = pose.recoil ?? 0;
  const box = (x: number, y: number, w: number, h: number, fill: string | CanvasGradient, radius = 2, outline = true): void => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = line; ctx.lineWidth = 1.3; ctx.stroke(); }
  };
  const path = (points: number[], fill: string, outline = true): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = line; ctx.lineWidth = 1.2; ctx.stroke(); }
  };
  const stroke = (points: number[], color: string, width = 1): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient): void => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  };
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Back layers give each silhouette a distinct character, even at arena scale.
  if (look.outfit === 'knight') path([-12, -44, -19, -15, -9, -9, 6, -16, 9, -42], '#803e50');
  if (look.outfit === 'cowboy') {
    path([-13, -40, -18 - stride * 0.2, -11, -4, -17, 4, -39], dark);
    path([3, -40, 10, -11, 17, -16, 13, -38], color);
  }
  if (look.outfit === 'ronin') {
    stroke([-19, -11, 12, -54], line, 5);
    stroke([-18, -12, 10, -51], '#665550', 2.4);
    stroke([10, -50, 15, -57], '#c2a15d', 4);
  }
  if (look.outfit === 'astronaut') box(-22, -43, 12, 24, '#a2b8c3', 4);

  // Independently posed legs, cuffs and boots replace the original floating capsule.
  const bootColor = look.outfit === 'astronaut' ? '#c3d2db' : '#30303b';
  box(-10 - stride * 0.75, -23, 10, 18 + Math.min(0, stride * 0.4), dark, 3);
  box(3 + stride * 0.75, -23, 10, 18 - Math.max(0, stride * 0.4), dark, 3);
  box(-12 - stride, -10 + Math.min(0, stride * 0.5), 15, 10, bootColor, 3);
  box(1 + stride, -10 - Math.max(0, stride * 0.5), 17, 10, bootColor, 3);
  stroke([-10 - stride, -3 + Math.min(0, stride * 0.5), 0 - stride, -3 + Math.min(0, stride * 0.5)], '#7d8390', 1);
  stroke([4 + stride, -3 - Math.max(0, stride * 0.5), 15 + stride, -3 - Math.max(0, stride * 0.5)], '#7d8390', 1);
  ctx.save();
  ctx.translate(0, pose.airborne ? -1 : -Math.abs(stride) * 0.15);

  const coatGradient = ctx.createLinearGradient(-14, -38, 16, -21);
  coatGradient.addColorStop(0, light); coatGradient.addColorStop(0.46, color); coatGradient.addColorStop(1, dark);
  box(-13, -44, 28, 25, coatGradient, 5);
  if (look.outfit === 'cowboy') {
    path([-6, -42, 1, -31, 7, -43], '#e6d2a8');
    path([-12, -43, -5, -43, 0, -29, -9, -35], dark);
    path([7, -43, 13, -42, 9, -32, 2, -30], light);
    box(-13, -24, 28, 5, '#5c4034', 1);
    box(-1, -24, 7, 5, '#d5b86c', 1);
    ellipse(-7, -34, 3.3, 3.3, '#edcf83');
    stroke([-7, -38, -7, -30], '#edcf83', 1); stroke([-11, -34, -3, -34], '#edcf83', 1);
  } else if (look.outfit === 'ronin') {
    path([-11, -44, 3, -27, 11, -44, 6, -44, 2, -35, -5, -44], '#d6d2c7');
    box(-14, -27, 29, 7, '#4a3039', 1);
    stroke([-12, -24, 13, -24], '#c6906b', 1);
    path([-12, -22, -16, -12, -4, -14, 1, -21], dark);
  } else if (look.outfit === 'operative') {
    box(-10, -41, 22, 19, '#303d3f', 3);
    box(-8, -35, 7, 8, color, 1); box(3, -35, 7, 8, color, 1);
    stroke([-6, -39, 8, -39], '#aec4ae', 1.2);
    box(-14, -23, 29, 5, '#252d32', 1); box(1, -23, 6, 5, '#acb5a6', 1);
  } else if (look.outfit === 'astronaut') {
    box(-9, -39, 18, 12, '#e3ebea', 3);
    box(-6, -36, 8, 5, '#367d91', 1); box(4, -36, 3, 3, '#e8a65f', 1, false);
    stroke([-10, -23, 11, -23], '#506779', 3);
    stroke([-8, -21, 8, -21], '#a6c1cb', 1);
    box(-18, -43, 11, 12, light, 4); box(8, -43, 11, 12, light, 4);
  } else {
    path([-11, -41, 2, -45, 13, -40, 10, -25, 1, -21, -10, -26], '#a4b4bc');
    path([-8, -39, 1, -41, 1, -25, -7, -28], '#dce2de', false);
    box(-18, -44, 13, 11, '#a2b6bc', 3); box(8, -44, 13, 11, '#a2b6bc', 3);
    stroke([-16, -40, -7, -40], '#dbe4df', 1.5);
    box(-11, -25, 26, 5, '#514440', 1); box(-1, -25, 6, 5, '#d9b475', 1);
  }

  // Neck, scarf and expressive three-quarter face.
  box(-4, -49, 10, 9, skinShade, 3);
  box(-13, -66, 28, 23, skin, 9);
  ellipse(14, -54, 3.4, 4, skinShade);
  path([-11, -57, -12, -64, -7, -69, 7, -69, 13, -64, 10, -61, 2, -64, -5, -60], '#40343a');
  stroke([-10, -59, -10, -52], '#7a4f40', 2);
  box(-1, -57, 4.2, pose.hurt ? 1.4 : 5.2, '#17232c', 1, false);
  box(8, -57, 3.8, pose.hurt ? 1.4 : 5.2, '#17232c', 1, false);
  ellipse(0.2, -55.5, 0.7, 0.9, '#faf0d5'); ellipse(9.3, -55.5, 0.6, 0.9, '#faf0d5');
  stroke([-2, -60, 3, -59], '#40343a', 1.8); stroke([8, -59, 12, -60], '#40343a', 1.8);
  path([6, -53, 8, -49, 4, -49], skinShade, false);
  stroke([0, -47, 6, -47], '#7e5146', 1);
  if (look.outfit === 'cowboy') {
    path([-7, -46, 0, -43, 9, -45, 8, -41, -5, -41], '#6c5145', false);
    path([-8, -45, 1, -42, 11, -46, 11, -40, -6, -38, -10, -42], '#ae4850');
    path([-10, -42, -21, -37 - stride * 0.25, -14, -46], '#cf6260');
  }
  if (look.outfit === 'ronin') path([-10, -44, 8, -44, 9, -39, -9, -39], '#c0a184');
  if (look.outfit === 'operative') {
    box(-5, -59, 20, 7, '#253b44', 2); stroke([-3, -57, 12, -57], '#7fadb5', 1.3);
  }

  if (look.hat === 'cowboy') {
    box(-15, -80, 30, 17, '#986843', 5);
    path([-12, -78, -6, -81, 1, -76, 8, -80, 13, -77, 12, -66, -12, -66], '#bf9460');
    box(-15, -69, 30, 5, '#563d34', 1);
    ellipse(0, -65, 27, 4.5, '#3c3030'); ellipse(0, -66.8, 27, 4.1, '#ceab75');
    stroke([-24, -67, -12, -64, 14, -64, 24, -68], '#ead2a0', 1.1);
  } else if (look.hat === 'straw') {
    path([-28, -64, -4, -82, 29, -65, 12, -61, -15, -61], '#b8a074');
    for (let x = -22; x <= 23; x += 5) stroke([-4, -79, x, -64], '#7e7354', 0.6);
    stroke([-25, -64, 26, -64], '#ead7a4', 2);
  } else if (look.hat === 'beret') {
    path([-14, -65, -17, -70, -9, -78, 10, -79, 19, -72, 13, -66], '#3d5051');
    box(-12, -68, 26, 4, '#202c32', 1); ellipse(8, -71, 3, 3.5, '#c3ab65');
    stroke([-9, -74, 5, -76], '#6a7f78', 1);
  } else if (look.hat === 'space') {
    ctx.beginPath(); ctx.ellipse(1, -56, 20, 23, 0, 0, Math.PI * 2); ctx.strokeStyle = '#c7dbe2'; ctx.lineWidth = 4; ctx.stroke();
    const glass = ctx.createLinearGradient(-15, -73, 16, -43); glass.addColorStop(0, '#a0e1e342'); glass.addColorStop(1, '#193d6677');
    ellipse(1, -56, 17.5, 20, glass);
    stroke([-11, -62, -8, -68, -1, -71], '#e4f9ee', 2);
    box(-22, -60, 6, 14, '#829daa', 2); box(16, -60, 6, 14, '#829daa', 2);
    stroke([-12, -36, 13, -36], '#bcd1d8', 4);
  } else if (look.hat === 'knight') {
    box(-15, -77, 31, 24, '#a1b3bd', 11);
    path([-12, -73, -4, -78, 2, -77, 0, -57, -12, -57], '#d3deda', false);
    box(-13, -60, 30, 10, '#526776', 2);
    for (let x = -7; x <= 12; x += 5) stroke([x, -57, x, -52], '#192b37', 2);
    path([-3, -76, -8, -84, -4, -88, 13, -85, 17, -78, 8, -78, 3, -74], '#a44c5b');
  }

  // Front arm: the in-game weapon is a separate sprite layer so switching guns
  // never requires rebuilding the look atlas. Menus may pass withGun = true.
  box(7 - recoil * 2, -38, 12, 12, color, 4);
  box(13 - recoil * 3, -32, 9, 8, skinShade, 3);
  if (withGun) {
    ctx.save(); ctx.translate(-recoil * 3, 0); ctx.rotate(-recoil * 0.1);
    path([18, -35, 24, -34, 22, -23, 16, -24], '#4b3d38');
    box(17, -36, 19, 7, look.outfit === 'astronaut' ? '#cadce2' : '#94a6ad', 1.8);
    box(32, -35.5, 5, 6, '#263a46', 0.8); box(20, -34, 5, 5, '#485d68', 1);
    stroke([19, -35, 32, -35], '#e1e5d9', 1); box(29, -38, 2, 2, '#b7c6c8', 0.3);
    ctx.restore();
  }
  if (pose.hurt) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = '#ffb4a638'; ctx.fillRect(-30, -90, 70, 95); }
  ctx.restore(); ctx.restore();
}

export function characterKey(look: CharacterAppearance): string {
  return `look-${look.style}-${look.hat}-${look.outfit}-${look.color}-${look.skin}`;
}

export function createCharacterAtlas(look: CharacterAppearance): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CHARACTER_FRAME.width * 10; canvas.height = CHARACTER_FRAME.height;
  const ctx = canvas.getContext('2d')!;
  for (let frame = 0; frame < 10; frame++) {
    ctx.save(); ctx.translate(frame * CHARACTER_FRAME.width + CHARACTER_FRAME.width / 2, CHARACTER_FRAME.height * CHARACTER_FRAME.feet);
    ctx.scale(CHARACTER_FRAME.scale, CHARACTER_FRAME.scale);
    paintCharacter(ctx, look, { stride: frame >= 1 && frame <= 6 ? Math.sin((frame - 1) / 6 * Math.PI * 2) * 4 : 0, airborne: frame === 7, recoil: frame === 8 ? 1 : 0, hurt: frame === 9 }, false);
    ctx.restore();
  }
  return canvas;
}

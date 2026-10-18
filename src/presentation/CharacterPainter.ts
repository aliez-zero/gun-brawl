import type { CharacterAppearance } from '../game/core/types';
import type { CharacterPose } from './CharacterMotion';
import { CHARACTER_GRIP } from './CharacterMotion';

const LINE = '#152531';
export const colorCss = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

function shade(color: number, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const channel = (value: number): number => Math.round(value + (target - value) * Math.abs(amount));
  return `rgb(${channel(color >> 16)},${channel((color >> 8) & 255)},${channel(color & 255)})`;
}

/** Original 2D illustration. Common joints keep all hats/outfits interchangeable. */
export function paintCharacter(ctx: CanvasRenderingContext2D, look: CharacterAppearance, pose: CharacterPose = {}, withGun = true): void {
  const color = colorCss(look.color), dark = shade(look.color, -0.48), light = shade(look.color, 0.38);
  const skin = colorCss(look.skin), skinShade = shade(look.skin, -0.22);
  const metal = '#a3bbc5', steel = '#4c6677', cream = '#e3d5b1', leather = '#5a3a30';
  const stride = pose.stride ?? 0;
  const cycle = (pose.cycle ?? (stride === 0 ? 0 : 0.25)) * Math.PI * 2;
  const bounce = pose.airborne ? -1 : pose.landing ? 0 : -Math.abs(stride) * 0.13 - (pose.breath ?? 0) * 0.7;
  const wind = pose.airborne ? (pose.falling ? 4 : -3) : -stride * 0.45;
  const stroke = (points: number[], fill: string, width = 1): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.strokeStyle = fill; ctx.lineWidth = width; ctx.stroke();
  };
  const path = (points: number[], fill: string | CanvasGradient, outline = true): void => {
    ctx.beginPath(); ctx.moveTo(points[0]!, points[1]!);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i]!, points[i + 1]!);
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.stroke(); }
  };
  const box = (x: number, y: number, w: number, h: number, fill: string | CanvasGradient, radius = 2, outline = true): void => {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = LINE; ctx.lineWidth = 1.2; ctx.stroke(); }
  };
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string | CanvasGradient, outline = false): void => {
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (outline) { ctx.strokeStyle = LINE; ctx.lineWidth = 1.1; ctx.stroke(); }
  };
  const gradient = (x: number, y: number, w: number, h: number, a: string, b: string, c: string): CanvasGradient => {
    const fill = ctx.createLinearGradient(x, y, x + w, y + h);
    fill.addColorStop(0, a); fill.addColorStop(0.55, b); fill.addColorStop(1, c); return fill;
  };
  const rivet = (x: number, y: number): void => { ellipse(x, y, 0.9, 0.9, cream); };
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // Back accessories have broad shapes; tiny seams are reserved for large previews.
  if (look.outfit === 'knight') {
    path([-14, -44, -22 + wind, -12, -10 + wind, -7, 9, -18, 12, -43], '#763a53');
    path([-12, -40, -16 + wind, -14, -11 + wind, -11, -4, -40], '#b55f6c', false);
    stroke([-19 + wind, -13, -10 + wind, -9, 6, -20], '#d8af78', 1.1);
  }
  if (look.outfit === 'cowboy') {
    path([-13, -42, -20 + wind * 0.4, -8, -8, -13, -2, -31, 4, -11, 18, -15, 12, -43], dark);
    stroke([-15, -29, -17 + wind * 0.4, -13, -10, -16], '#c39463', 0.8);
  }
  if (look.outfit === 'ronin') {
    stroke([-19, -10, 8, -50], LINE, 5); stroke([-19, -10, 8, -50], '#5c4544', 2.7);
    stroke([8, -50, 13, -58], '#d6b373', 4);
    for (let i = 0; i < 4; i++) stroke([8 + i, -51 - i * 1.7, 11 + i, -50 - i * 1.7], '#493844', 0.7);
    stroke([6, -49, 12, -46], '#e4c98f', 2);
  }
  if (look.outfit === 'astronaut') {
    box(-23, -46, 15, 27, gradient(-23, -46, 15, 27, '#e4e9dd', '#8ca6b4', '#536a7c'), 5);
    box(-25, -39, 5, 17, steel, 2); stroke([-21, -42, -12, -42], '#e9b66b', 2);
  }

  // Each leg bends through hip/knee/ankle rather than translating a rectangle.
  const armored = look.outfit === 'knight', suited = look.outfit === 'astronaut';
  for (const side of [-1, 1] as const) {
    const back = side === -1;
    const hipX = back ? -6 : 7;
    let ankleX = hipX + stride * side * 1.15;
    let ankleY = -6 - Math.max(0, Math.sin(cycle) * side) * 3;
    let kneeX = hipX + stride * side * 0.5;
    let kneeY = -14;
    if (pose.airborne) {
      ankleX = hipX + (back ? -5 : 6);
      ankleY = pose.doubleJump ? (back ? -16 : -10) : pose.falling ? -5 : back ? -9 : -15;
      kneeX = hipX + (back ? -5 : 7); kneeY = pose.doubleJump ? -22 : -17;
    }
    if (pose.landing) { kneeX += side * 6; kneeY = -11; }
    const pants = back ? dark : color;
    stroke([hipX, -23, kneeX, kneeY, ankleX, ankleY], LINE, suited ? 12 : 10);
    stroke([hipX, -23, kneeX, kneeY, ankleX, ankleY], suited ? (back ? '#7f99a7' : light) : pants, suited ? 9 : 7);
    if (look.outfit === 'ronin') {
      path([hipX - 5, -24, hipX + 6, -24, kneeX + 8, -10, kneeX - 7, -9], pants);
      stroke([hipX, -22, kneeX + 1, -12], light, 0.9);
    }
    if (armored || look.outfit === 'operative') {
      box(kneeX - 4, kneeY - 4, 8, 7, armored ? metal : '#394b4e', 2);
      stroke([kneeX - 2, kneeY - 2, kneeX + 2, kneeY - 2], armored ? '#e5ece4' : '#8b9a89', 1);
    }
    const boot = suited ? '#bacbd0' : armored ? steel : '#2c303c';
    box(ankleX - 6, ankleY - 2, 14, 8, gradient(ankleX - 6, ankleY - 2, 14, 8, suited ? '#e8ece3' : '#68717c', boot, LINE), 2.5);
    stroke([ankleX - 4, ankleY + 4, ankleX + 6, ankleY + 4], suited ? steel : '#92969a', 1);
    if (look.outfit === 'cowboy') { box(ankleX - 4, ankleY - 6, 8, 7, leather, 1); rivet(ankleX - 1, ankleY - 3); }
  }

  ctx.save(); ctx.translate(0, bounce);
  // Rear sleeve, then the torso: distinct outer cuts, shared shoulder/neck sockets.
  const sleeve = suited ? light : armored ? steel : dark;
  stroke([-11, -40, -16, -32, -11, -27], LINE, 9);
  stroke([-11, -40, -16, -32, -11, -27], sleeve, 6);
  ellipse(-11, -27, 3.1, 3.5, suited || armored ? steel : skinShade, true);
  const cloth = gradient(-15, -44, 30, 28, light, color, dark);
  if (look.outfit === 'astronaut') box(-15, -46, 32, 28, cloth, 9);
  else if (look.outfit === 'operative') path([-12, -45, 11, -44, 16, -37, 10, -20, -9, -20, -16, -35], cloth);
  else if (look.outfit === 'knight') path([-14, -44, 12, -44, 16, -34, 11, -20, -10, -20, -16, -34], cloth);
  else path([-13, -45, 12, -44, 15, -24, 8, -18, -13, -21, -16, -34], cloth);

  if (look.outfit === 'cowboy') {
    path([-4, -44, 6, -43, 4, -27, -2, -26], cream);
    path([-12, -44, -5, -44, 0, -29, -8, -33, -10, -28], dark);
    path([7, -44, 12, -43, 8, -29, 3, -27], light);
    // Six-point brass badge, stitched pocket and a holster create the sheriff identity.
    const star: number[] = [];
    for (let i = 0; i < 12; i++) { const r = i % 2 ? 2 : 4; const a = i * Math.PI / 6 - Math.PI / 2; star.push(-9 + Math.cos(a) * r, -35 + Math.sin(a) * r); }
    path(star, '#dfbc6e'); ellipse(-9, -35, 1.1, 1.1, '#f7e1ab');
    stroke([5, -31, 10, -32, 10, -27], '#e1c092', 0.7);
    box(-13, -24, 27, 5, leather, 1); box(-1, -24, 7, 5, '#d8b369', 1);
    box(0, -23, 4, 3, '#6d5237', 0.5, false);
    path([11, -23, 18, -23, 16, -11, 10, -12], leather); rivet(14, -20);
  } else if (look.outfit === 'ronin') {
    path([-12, -45, -5, -45, 9, -29, 5, -25], '#e0d9c6');
    path([10, -44, 14, -40, 1, -28, -4, -31], dark);
    stroke([-6, -43, 6, -29], '#a5b1ac', 0.8);
    box(-14, -27, 29, 7, '#52343e', 1); stroke([-12, -25, 13, -25], '#d3a56c', 1);
    ellipse(9, -23, 2.7, 3, '#d2ad75');
    path([8, -22, 17 + wind, -14, 12 + wind, -13, 7, -20], '#c3a480');
    stroke([-11, -37, -6, -33], light, 0.8); stroke([-12, -34, -8, -31], light, 0.8);
  } else if (look.outfit === 'operative') {
    box(-11, -42, 25, 19, '#2b3c41', 3);
    stroke([-8, -43, -6, -25], '#859781', 3); stroke([10, -42, 9, -25], '#859781', 2);
    for (const x of [-7, 1, 8]) { box(x, -35, 5, 8, x === 8 ? light : color, 1); stroke([x + 1, -32, x + 4, -32], '#b5c1a3', 0.7); }
    box(-7, -40, 9, 3, '#a9b8a2', 0.4); stroke([-5, -39, 0, -39], LINE, 0.7);
    box(-14, -24, 28, 5, '#1c2d34', 1); box(1, -24, 6, 5, metal, 1);
    box(-16, -24, 6, 9, dark, 1); stroke([-13, -38, -16, -49], LINE, 1.5);
  } else if (look.outfit === 'astronaut') {
    box(-10, -42, 21, 15, '#dbe4df', 3);
    box(-7, -39, 10, 7, gradient(-7, -39, 10, 7, '#6fc9c6', '#347c92', '#214558'), 1);
    stroke([-5, -35, -3, -37, -1, -34, 1, -36], '#c7efe0', 0.7);
    for (let i = 0; i < 3; i++) ellipse(7, -38 + i * 3.5, 1.1, 1.1, i === 0 ? '#edba6b' : '#7e9da6');
    stroke([-12, -35, -17, -30, -12, -24, -6, -24], '#4e7784', 3);
    stroke([-12, -35, -17, -30, -12, -24, -6, -24], '#b4ced0', 1.2);
    box(-13, -23, 28, 5, steel, 2); box(-2, -23, 7, 4, '#dfbd76', 1);
    for (const x of [-17, 11]) box(x, -44, 9, 11, light, 4);
  } else {
    path([-12, -42, 0, -46, 13, -41, 11, -27, 2, -21, -11, -27], gradient(-12, -43, 25, 23, '#eef0e1', metal, steel));
    path([-8, -40, 0, -42, 0, -27, -7, -30], '#eff1df', false);
    stroke([2, -41, 3, -29, 10, -34], '#596f7d', 1.1);
    path([-18, -44, -8, -46, -5, -39, -16, -34, -20, -38], metal);
    path([9, -45, 18, -43, 21, -36, 12, -34, 7, -40], steel);
    stroke([-17, -42, -9, -43], '#f2edcf', 1.1); stroke([12, -42, 17, -40], metal, 1);
    for (const [x, y] of [[-15, -39], [15, -38], [-8, -29], [9, -29]]) rivet(x!, y!);
    box(-12, -24, 27, 5, leather, 1); box(-1, -24, 7, 5, '#d6ae69', 1);
  }

  // Faces follow style, independently of the mixed hat and outfit.
  const rugged = look.style === 'cowboy', calm = look.style === 'ronin', agent = look.style === 'operative';
  box(-4, -50, 11, 9, skinShade, 3);
  const face = gradient(-12, -69, 28, 26, shade(look.skin, 0.21), skin, skinShade);
  path([-12, -62, -10, -69, 1, -72, 12, -66, 15, -54, 10, -46, 0, -44, -10, -49], face);
  ellipse(-12, -55, 3, 4, skinShade, true); stroke([-12, -57, -11, -54], skin, 1);
  ellipse(11, -51, 2.4, 1.8, shade(look.skin, 0.15));
  if (calm) {
    ellipse(-10, -72, 5, 5, '#28313c', true);
    path([-12, -59, -13, -67, -4, -73, 8, -71, 13, -65, 8, -65, 1, -68, -5, -59], '#28313c');
    stroke([8, -59, 6, -50], '#915d58', 0.8);
  } else if (agent) {
    path([-12, -59, -12, -69, -4, -75, 8, -73, 13, -66, 7, -65, 2, -69, -7, -62], '#27333d');
    stroke([-11, -60, -11, -53], '#48505a', 2);
  } else if (rugged) {
    path([-12, -56, -13, -67, -5, -72, 8, -71, 13, -65, 8, -64, -2, -67, -7, -61, -8, -54], '#51403b');
  } else {
    path([-12, -59, -12, -67, -5, -73, 6, -72, 13, -67, 10, -62, 2, -67, -4, -62], look.style === 'knight' ? '#71513e' : '#384254');
  }
  const eyeY = agent ? -57 : -58;
  const squint = pose.hurt || calm;
  for (const x of [0, 10]) {
    box(x - 1.5, eyeY, 3.2, squint ? 1.5 : 4.3, LINE, 1, false);
    if (!squint) ellipse(x - 0.5, eyeY + 1.2, 0.65, 0.7, '#f8f0dc');
  }
  stroke([-3, eyeY - 3, 2, eyeY - (rugged ? 1.5 : 2.5)], '#423840', rugged ? 2 : 1.4);
  stroke([8, eyeY - 2, 13, eyeY - 3.5], '#423840', 1.4);
  path([6, -55, 8, -51, 4, -51], skinShade, false);
  stroke([1, -48, 6, -48.5], '#805449', 0.9);
  if (rugged) {
    path([-8, -51, -2, -49, 9, -50, 8, -46, 0, -44, -7, -47], '#725347', false);
    path([-2, -51, 2, -52, 8, -50, 5, -48, 1, -49, -2, -48], '#493b36', false);
    for (const x of [-7, -4, -1, 2, 5]) stroke([x, -47, x + 0.8, -46.4], '#af8b6d', 0.5);
  }
  if (look.outfit === 'cowboy') {
    path([-10, -46, -1, -43, 10, -46, 10, -39, 2, -36, -8, -39], '#a94653');
    path([-7, -43, -21 + wind, -37, -15 + wind, -46], '#cf6870');
    stroke([-5, -42, 3, -40, 8, -42], '#e2a085', 0.9);
  }
  if (look.outfit === 'ronin') { box(-9, -45, 18, 6, '#b9aa8d', 2); stroke([-6, -43, 7, -43], '#e3d4af', 0.8); }
  if (agent) {
    box(-5, -60, 21, 8, '#1c3543', 3);
    path([-3, -59, 5, -59, 1, -54, -3, -54], '#6caaa9', false);
    stroke([-2, -58, 12, -58], '#c4dbce', 0.8);
    ellipse(-12, -56, 3, 4, '#4f6470', true); stroke([-12, -54, -8, -49, -2, -49], '#273943', 1.2);
  }

  if (look.hat === 'cowboy') {
    path([-15, -66, -14, -79, -8, -82, 0, -77, 9, -82, 14, -79, 16, -65], gradient(-15, -81, 32, 18, '#d6b077', '#a77b4d', '#694c39'));
    path([-14, -70, 14, -70, 16, -65, -15, -65], '#573e34');
    path([-28, -68, -18, -65, 14, -65, 28, -71, 25, -65, 13, -61, -14, -62, -27, -65], gradient(-28, -70, 56, 9, '#ecd5a1', '#c29661', '#7d593c'));
    stroke([-25, -67, -14, -64, 12, -64, 25, -68], '#f1d9a1', 1);
    box(5, -70, 4, 4, '#d4b474', 0.7); rivet(7, -68);
  } else if (look.hat === 'straw') {
    path([-29, -65, -7, -82, 1, -80, 29, -65, 14, -60, -15, -61], gradient(-22, -79, 43, 19, '#ead6a1', '#bb9f6e', '#826b4b'));
    for (let x = -23; x < 25; x += 5) stroke([-6, -79, x, -64], '#817154', 0.6);
    stroke([-25, -64, 24, -64], '#f0ddb2', 1.5);
    stroke([-14, -63, -10, -48, -5, -45], '#8c6c50', 0.8);
    ellipse(-3, -72, 2.8, 1.5, '#827355');
  } else if (look.hat === 'beret') {
    path([-14, -65, -17, -72, -8, -79, 11, -79, 19, -73, 12, -66], gradient(-17, -79, 36, 15, '#7c9486', '#405954', '#243b40'));
    stroke([-11, -74, -4, -77, 8, -77], '#a2b49a', 0.9);
    box(-12, -68, 26, 4, '#22333d', 1); box(7, -74, 5, 7, '#c7b57c', 1);
    stroke([8, -70, 10, -72, 11, -70], '#485651', 0.8);
  } else if (look.hat === 'space') {
    const rim = gradient(-22, -80, 45, 49, '#e7efdf', '#b4cbd0', '#5b7e90');
    ctx.beginPath(); ctx.ellipse(1, -56, 21, 24, 0, 0, Math.PI * 2); ctx.strokeStyle = LINE; ctx.lineWidth = 6; ctx.stroke();
    ctx.strokeStyle = rim; ctx.lineWidth = 4; ctx.stroke();
    const glass = gradient(-16, -75, 35, 37, '#9edddd35', '#40658038', '#1a3a6288');
    ellipse(1, -56, 18, 21, glass);
    stroke([-12, -63, -9, -69, -3, -72], '#edfae9', 2.1); stroke([6, -73, 11, -70], '#c9efdfaa', 1);
    box(-23, -61, 6, 14, steel, 2); box(18, -60, 6, 13, steel, 2);
    stroke([-21, -58, -21, -51], '#dfb770', 1.3);
    path([-13, -39, -8, -33, 12, -33, 17, -40, 11, -37, -7, -37], rim);
  } else if (look.hat === 'knight') {
    path([-15, -59, -16, -70, -10, -78, 1, -81, 12, -76, 16, -68, 15, -57], gradient(-16, -80, 32, 23, '#e4e9db', metal, steel));
    path([-11, -70, -5, -77, 1, -78, 0, -58, -10, -58], '#dce6df', false);
    stroke([2, -78, 3, -61], '#5a7585', 1.2);
    path([-14, -61, 15, -62, 17, -53, 6, -48, -12, -51], steel);
    stroke([-11, -59, 12, -60], '#c6d6d4', 1.3);
    for (let x = -7; x <= 12; x += 4.5) stroke([x, -57, x + 0.4, -52.5], LINE, 1.4);
    path([-3, -78, -7, -83, -1, -85, 10, -84, 17, -81, 9, -81, 3, -77], '#b65768');
    stroke([-3, -83, 9, -83, 13, -81], '#dd8990', 1);
    rivet(-11, -55); rivet(13, -55);
  }
  ctx.restore();

  // The grip never moves away from WeaponLayer's pivot. Elbows and the support
  // hand articulate around it; a larger held weapon cannot detach from the wrist.
  const hand = suited ? '#c5d4d5' : armored ? metal : skin;
  const elbowY = -31 + (pose.hurt ? 1 : 0);
  stroke([11, -40 + bounce, 15, elbowY, CHARACTER_GRIP.x, CHARACTER_GRIP.y], LINE, suited || armored ? 11 : 10);
  stroke([11, -40 + bounce, 15, elbowY, CHARACTER_GRIP.x, CHARACTER_GRIP.y], suited ? light : armored ? steel : color, suited || armored ? 8 : 7);
  box(12, -29, 9, 8, hand, 3);
  if (armored) { stroke([13, -26, 19, -26], '#e5e8d7', 0.9); }
  else if (!suited) stroke([14, -25, 18, -25], skinShade, 0.8);
  if (pose.reload) {
    const reach = Math.sin(pose.reload * Math.PI);
    stroke([-11, -37, -10 + reach * 13, -24, 9 + reach * 3, -19], LINE, 7);
    stroke([-11, -37, -10 + reach * 13, -24, 9 + reach * 3, -19], dark, 4.8);
    ellipse(9 + reach * 3, -19, 3, 3, hand, true);
  }
  if (withGun) {
    ctx.save(); ctx.translate(CHARACTER_GRIP.x, CHARACTER_GRIP.y);
    ctx.rotate(-(pose.recoil ?? 0) * 0.08);
    path([-2, -5, 4, -5, 1, 4, -4, 3], leather);
    box(-3, -12, 21, 7, gradient(-3, -12, 22, 7, '#b6c8ca', '#6d8492', '#2f4555'), 1.5);
    box(15, -11, 5, 5, LINE, 0.6); stroke([-1, -11, 13, -11], '#e9d9ab', 0.8);
    ctx.restore();
  }
  // Tint only this actor's pixels, never neighboring atlas cells or other art.
  if (pose.hurt) {
    ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = '#ffa58338'; ctx.fillRect(-35, -90, 75, 96);
  }
  ctx.restore();
}

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
  pistol: 0.47, p1911: 0.45, deagle: 0.5,
  smg: 0.4, ump45: 0.4, vector: 0.38, uzi: 0.36,
  rifle: 0.48, m416: 0.48, akm: 0.49, 'scar-l': 0.5,
  shotgun: 0.48, s686: 0.46, s1897: 0.5, s12k: 0.45,
  sniper: 0.55, kar98k: 0.55, m24: 0.56, awm: 0.56,
  rocket: 0.52, rpg7: 0.52, at4: 0.54,
  gatling: 0.58, cannon: 0.6,
};

export function weaponDisplayScale(id: WeaponId): number {
  const scale = MODEL_SCALE[id];
  return scale === undefined ? WEAPON_ART.displayScale : scale / SAMPLE;
}

// Higher-contrast palette: the arenas are dark blue-grey, so gunmetal has to be
// noticeably lighter than the walls or the whole silhouette disappears.
const OUTLINE = '#0a1116';
const STEEL_DARK = '#3a4850';
const STEEL = '#77898f';
const STEEL_LIGHT = '#afbfc2';
const POLY_DARK = '#2f3b36';
const POLY = '#4c5c53';
const WOOD_DARK = '#5a3a21';
const WOOD = '#966034';
const WOOD_LIGHT = '#c0844c';
const GOLD = '#e8c56a';

type Ctx = CanvasRenderingContext2D;

function tint(hex: string, amount: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number): number => {
    const base = (value >> shift) & 255;
    return Math.round(amount >= 0 ? base + (255 - base) * amount : base * (1 + amount));
  };
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

/** Outlined, top-lit slab: every gun part shares this so the set reads as one kit. */
function slab(ctx: Ctx, x: number, y: number, width: number, height: number, fill: string, radius = 2): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (height > 4 && /^#[0-9a-f]{6}$/i.test(fill)) {
    const metal = ctx.createLinearGradient(0, y, 0, y + height);
    metal.addColorStop(0, tint(fill, 0.28));
    metal.addColorStop(0.34, tint(fill, 0.06));
    metal.addColorStop(1, tint(fill, -0.28));
    ctx.fillStyle = metal;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (height >= 6) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y + 1.1);
    ctx.lineTo(x + width - radius, y + 1.1);
    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function poly(ctx: Ctx, points: number[], fill: string): void {
  ctx.beginPath();
  ctx.moveTo(points[0]!, points[1]!);
  for (let index = 2; index < points.length; index += 2) ctx.lineTo(points[index]!, points[index + 1]!);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.4): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function circle(ctx: Ctx, x: number, y: number, radius: number, fill: string, outline = true): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (outline) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1.6; ctx.stroke(); }
}

/** Angled box used for grips, magazines and stocks. */
function wedge(ctx: Ctx, x: number, y: number, width: number, height: number, skew: number, fill: string): void {
  poly(ctx, [x + skew, y, x + width + skew, y, x + width, y + height, x, y + height], fill);
}

interface GunSpec {
  /** Muzzle tip in art units; the bore sits at `bore`. */
  tip: number;
  bore: number;
  /** Receiver: x, width, height. */
  rec: readonly [number, number, number];
  /** Barrel height and vertical centre offset from the bore. */
  barrel: readonly [number, number];
  stock: 'none' | 'wood' | 'poly' | 'skeleton' | 'thumbhole';
  mag: 'none' | 'box' | 'banana' | 'drum' | 'tube' | 'internal';
  /** Handguard covering most of the barrel: without it every rifle reads as a needle. */
  guard?: 'wood' | 'poly' | 'none';
  furniture: string;
  body: string;
  accent: string;
  scope?: readonly [number, number, number];
  pump?: readonly [number, number];
  double?: boolean;
  cone?: boolean;
  brake?: 'ring' | 'brake' | 'bell' | 'plain';
  bipod?: boolean;
  belt?: boolean;
}

const SPECS: Record<WeaponId, GunSpec> = {
  pistol: {
    tip: 72, bore: 27, rec: [22, 34, 23], barrel: [11, 0], stock: 'none', mag: 'internal',
    furniture: STEEL, body: STEEL, accent: GOLD, brake: 'plain',
  },
  p1911: {
    tip: 76, bore: 27, rec: [20, 40, 24], barrel: [11, 0], stock: 'none', mag: 'internal',
    furniture: WOOD, body: STEEL, accent: GOLD, brake: 'plain',
  },
  deagle: {
    tip: 84, bore: 26, rec: [18, 50, 29], barrel: [15, 0], stock: 'none', mag: 'internal',
    furniture: POLY_DARK, body: STEEL_LIGHT, accent: GOLD, brake: 'brake',
  },
  smg: {
    tip: 114, bore: 29, rec: [22, 58, 26], barrel: [12, 0], stock: 'poly', mag: 'box',
    furniture: POLY_DARK, body: POLY, accent: '#4fc3b1', brake: 'ring',
  },
  ump45: {
    tip: 112, bore: 29, rec: [22, 52, 26], barrel: [12, 0], stock: 'poly', mag: 'box',
    furniture: POLY_DARK, body: POLY, accent: '#4fc3b1', brake: 'ring',
  },
  vector: {
    tip: 104, bore: 28, rec: [24, 54, 29], barrel: [11, 0], stock: 'none', mag: 'box',
    furniture: POLY_DARK, body: '#95a2a4', accent: '#f0a23a', brake: 'plain',
  },
  uzi: {
    tip: 92, bore: 29, rec: [26, 48, 27], barrel: [10, 0], stock: 'skeleton', mag: 'internal',
    furniture: POLY_DARK, body: STEEL_DARK, accent: '#e05a4f', brake: 'plain',
  },
  rifle: {
    tip: 146, bore: 30, rec: [22, 62, 27], barrel: [10, 0], stock: 'poly', mag: 'banana',
    furniture: WOOD, body: '#9b8b68', accent: '#f0a23a', brake: 'ring',
  },
  m416: {
    tip: 146, bore: 30, rec: [22, 66, 27], barrel: [10, 0], stock: 'poly', mag: 'box',
    furniture: '#867a5a', body: '#b0a17a', accent: '#f0a23a', brake: 'ring',
  },
  akm: {
    tip: 144, bore: 30, rec: [20, 62, 27], barrel: [11, 0], stock: 'wood', mag: 'banana',
    furniture: WOOD, body: '#77745c', accent: '#e05a4f', brake: 'plain',
  },
  'scar-l': {
    tip: 148, bore: 30, rec: [20, 72, 27], barrel: [10, 0], stock: 'poly', mag: 'box',
    furniture: '#948a68', body: '#c2b088', accent: '#f0a23a', brake: 'ring',
  },
  shotgun: {
    tip: 148, bore: 30, rec: [24, 34, 25], barrel: [13, 0], stock: 'wood', mag: 'tube',
    furniture: WOOD, body: STEEL, accent: '#e05a4f', brake: 'ring', pump: [78, 96],
  },
  s686: {
    tip: 144, bore: 29, rec: [26, 30, 27], barrel: [22, 0], stock: 'wood', mag: 'none',
    furniture: WOOD, body: STEEL, accent: '#e05a4f', double: true, brake: 'ring',
  },
  s1897: {
    tip: 148, bore: 28, rec: [22, 34, 26], barrel: [13, 0], stock: 'wood', mag: 'tube',
    furniture: WOOD_DARK, body: '#6b797e', accent: '#e05a4f', pump: [80, 100], brake: 'ring',
  },
  s12k: {
    tip: 138, bore: 29, rec: [22, 54, 28], barrel: [14, 0], stock: 'poly', mag: 'box',
    furniture: POLY, body: '#87906d', accent: '#e05a4f', brake: 'brake',
  },
  sniper: {
    tip: 150, bore: 31, rec: [26, 34, 23], barrel: [9, 0], stock: 'wood', mag: 'internal',
    furniture: WOOD, body: '#7b8668', accent: '#b48ce0', brake: 'plain',
  },
  kar98k: {
    tip: 150, bore: 31, rec: [24, 34, 23], barrel: [9, 0], stock: 'wood', mag: 'internal',
    furniture: WOOD, body: '#767a58', accent: '#b48ce0', brake: 'plain',
  },
  m24: {
    tip: 148, bore: 31, rec: [26, 34, 24], barrel: [10, 0], stock: 'poly', mag: 'box',
    furniture: '#48544e', body: '#63716b', accent: '#b48ce0', scope: [34, 42, 14], brake: 'brake',
  },
  awm: {
    tip: 150, bore: 31, rec: [24, 38, 25], barrel: [11, 0], stock: 'poly', mag: 'box',
    furniture: '#515a48', body: '#68765f', accent: '#b48ce0', scope: [32, 46, 16], brake: 'brake',
  },
  rocket: {
    tip: 148, bore: 30, rec: [18, 74, 30], barrel: [22, 0], stock: 'none', mag: 'none',
    furniture: WOOD, body: '#7a8060', accent: '#f2c94c', cone: true, brake: 'bell',
  },
  rpg7: {
    tip: 148, bore: 30, rec: [16, 76, 30], barrel: [22, 0], stock: 'none', mag: 'none',
    furniture: WOOD, body: '#7c8160', accent: '#f2c94c', cone: true, brake: 'bell',
  },
  at4: {
    tip: 150, bore: 30, rec: [16, 78, 26], barrel: [20, 0], stock: 'none', mag: 'none',
    furniture: '#988f6c', body: '#a49c72', accent: '#f2c94c', cone: true, brake: 'bell',
  },
  gatling: {
    tip: 144, bore: 31, rec: [24, 56, 36], barrel: [24, 0], stock: 'none', mag: 'drum',
    furniture: POLY_DARK, body: STEEL_DARK, accent: '#f2a23a', belt: true, brake: 'ring',
  },
  cannon: {
    tip: 150, bore: 31, rec: [20, 46, 32], barrel: [18, 0], stock: 'thumbhole', mag: 'box',
    furniture: '#454851', body: '#55626d', accent: '#ff5d73', scope: [30, 46, 16], bipod: true, brake: 'brake',
  },
};

/** Stock sits behind the receiver; drawn first so the receiver overlaps it. */
/** Handguard material per model; pistols, double barrels and launchers have none. */
const GUARDS: Partial<Record<WeaponId, 'wood' | 'poly'>> = {
  rifle: 'poly', m416: 'poly', akm: 'wood', 'scar-l': 'poly',
  smg: 'poly', ump45: 'poly', s12k: 'poly',
  shotgun: 'wood', s1897: 'wood', sniper: 'wood', kar98k: 'wood',
  m24: 'poly', awm: 'poly', cannon: 'poly',
};

function drawStock(ctx: Ctx, spec: GunSpec, recX: number): void {
  const midY = spec.bore;
  switch (spec.stock) {
    case 'wood':
      // Comb + toe: a straight slab reads as a plank, the notch reads as a stock.
      poly(ctx, [2, midY - 2, 12, midY - 7, recX + 12, midY - 7, recX + 12, midY + 10, 10, midY + 18, 2, midY + 14], spec.furniture);
      line(ctx, 14, midY - 4, recX + 8, midY - 4, 'rgba(255,235,200,0.35)', 1.4);
      break;
    case 'poly':
      poly(ctx, [2, midY - 6, recX + 8, midY - 7, recX + 8, midY + 8, 4, midY + 12, 2, midY + 6], spec.furniture);
      break;
    case 'skeleton':
      line(ctx, 6, midY - 4, recX, midY - 4, STEEL_DARK, 3.4);
      line(ctx, 6, midY + 6, recX, midY + 2, STEEL_DARK, 3.4);
      line(ctx, 6, midY - 4, 6, midY + 6, STEEL_DARK, 3);
      break;
    case 'thumbhole':
      poly(ctx, [2, midY - 8, recX + 6, midY - 8, recX + 6, midY + 10, 10, midY + 18, 2, midY + 14], spec.furniture);
      circle(ctx, recX - 4, midY + 6, 4, OUTLINE, false);
      break;
    default:
      break;
  }
}

function drawMagazine(ctx: Ctx, spec: GunSpec, recX: number, recW: number): void {
  const top = spec.bore + spec.rec[2] / 2 - 1;
  switch (spec.mag) {
    case 'box':
      wedge(ctx, recX + recW * 0.5, top, 13, 22, -2, POLY_DARK);
      line(ctx, recX + recW * 0.5 + 1, top + 16, recX + recW * 0.5 + 12, top + 15, spec.accent, 1.6);
      break;
    case 'banana':
      poly(ctx, [
        recX + recW * 0.46, top,
        recX + recW * 0.46 + 16, top,
        recX + recW * 0.46 + 19, top + 16,
        recX + recW * 0.46 + 11, top + 27,
        recX + recW * 0.46 - 6, top + 25,
        recX + recW * 0.46 - 5, top + 9,
      ], '#5b452e');
      break;
    case 'drum':
      circle(ctx, recX + 18, top + 10, 13, POLY_DARK);
      circle(ctx, recX + 18, top + 10, 5, '#1d2529', false);
      break;
    case 'tube':
      slab(ctx, recX + 10, top - 1, 62, 7, '#5a676c', 3);
      break;
    case 'internal':
      break;
    default:
      break;
  }
}

function drawGrip(ctx: Ctx, spec: GunSpec, recX: number, recW: number): void {
  const top = spec.bore + spec.rec[2] / 2 - 2;
  const x = recX + recW * 0.34;
  wedge(ctx, x, top, 12, 20, -3, spec.furniture);
  line(ctx, x + 1, top + 5, x + 10, top + 5, 'rgba(0,0,0,0.45)', 1);
  line(ctx, x, top + 9, x + 10, top + 9, 'rgba(0,0,0,0.35)', 1);
  // trigger guard
  ctx.beginPath();
  ctx.arc(x + 11, top + 2, 6, 0.1, Math.PI - 0.1);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawScope(ctx: Ctx, spec: GunSpec): void {
  if (!spec.scope) return;
  const [x, width, height] = spec.scope;
  const y = spec.bore - spec.rec[2] / 2 - height + 3;
  slab(ctx, x + 4, y + height / 2 - 1.5, 4, 6, STEEL_DARK, 1);
  slab(ctx, x + width - 8, y + height / 2 - 1.5, 4, 6, STEEL_DARK, 1);
  slab(ctx, x, y, width, height, '#232d32', height / 2);
  const lens = ctx.createLinearGradient(x + 3, y + 2, x + 3, y + height - 2);
  lens.addColorStop(0, '#dff6ff');
  lens.addColorStop(0.5, '#6fa6c4');
  lens.addColorStop(1, '#1d2f3a');
  ctx.beginPath();
  ctx.ellipse(x + 5, y + height / 2, 3, height / 2 - 3, 0, 0, Math.PI * 2);
  ctx.fillStyle = lens;
  ctx.fill();
  line(ctx, x + 9, y + height / 2, x + width - 4, y + height / 2, 'rgba(255,255,255,0.18)', 1);
}

function drawMuzzle(ctx: Ctx, spec: GunSpec, tip: number, h: number): void {
  if (spec.cone) {
    // Rocket warhead: bright cone so the launcher reads at a glance.
    const coneY = spec.bore - spec.barrel[0] / 2;
    poly(ctx, [tip - 22, coneY - 2, tip, spec.bore, tip - 22, coneY + h + 2], '#8a8f68');
    line(ctx, tip - 20, spec.bore, tip - 2, spec.bore, spec.accent, 2);
    return;
  }
  switch (spec.brake) {
    case 'brake':
      slab(ctx, tip - 12, spec.bore - h / 2 - 2, 12, h + 4, STEEL_DARK, 2);
      line(ctx, tip - 9, spec.bore - h / 2 - 1, tip - 9, spec.bore + h / 2 + 1, 'rgba(0,0,0,0.5)', 1.4);
      line(ctx, tip - 5, spec.bore - h / 2 - 1, tip - 5, spec.bore + h / 2 + 1, 'rgba(0,0,0,0.5)', 1.4);
      break;
    case 'ring':
      circle(ctx, tip - 2, spec.bore, h / 2 + 1.6, STEEL_LIGHT, true);
      circle(ctx, tip - 2, spec.bore, h / 2 - 1, '#141c21', false);
      break;
    case 'bell':
      slab(ctx, tip - 12, spec.bore - h / 2 - 4, 12, h + 8, '#4d5a48', 3);
      break;
    default:
      break;
  }
  line(ctx, tip - 4, spec.bore - h / 2 + 1, tip - 4, spec.bore + h / 2 - 1, 'rgba(255,255,255,0.30)', 1);
}

function drawGun(ctx: Ctx, spec: GunSpec): void {
  const [recX, recW, recH] = spec.rec;
  const recTop = spec.bore - recH / 2;
  drawStock(ctx, spec, recX);

  if (spec.double) {
    const h = spec.barrel[0] / 2 - 1;
    slab(ctx, recX + recW, spec.bore - h - 1, spec.tip - recX - recW, h, spec.body, 2);
    slab(ctx, recX + recW, spec.bore + 1, spec.tip - recX - recW, h, spec.body, 2);
  } else if (spec.barrel[0] > 0) {
    const h = spec.barrel[0];
    const y = spec.bore - h / 2 + spec.barrel[1];
    slab(ctx, recX + recW - 2, y, spec.tip - recX - recW + 2, h, spec.body, h / 2.4);
  }

  if (spec.pump) {
    slab(ctx, spec.pump[0], spec.bore - 1, spec.pump[1] - spec.pump[0], 13, spec.furniture, 3);
    for (let x = spec.pump[0] + 4; x < spec.pump[1] - 3; x += 5) {
      line(ctx, x, spec.bore + 2, x + 1, spec.bore + 10, 'rgba(0,0,0,0.45)', 1.2);
    }
  }

  // Handguard: covers the rear 55% of the barrel so long guns read as rifles
  // rather than a receiver with a needle glued on.
  const barrelStart = recX + recW - 2;
  if (spec.guard && spec.guard !== 'none' && spec.barrel[0] > 0) {
    const guardEnd = barrelStart + (spec.tip - barrelStart) * 0.55;
    const fill = spec.guard === 'wood' ? spec.furniture : POLY;
    slab(ctx, barrelStart - 2, spec.bore - 9, guardEnd - barrelStart + 2, 18, fill, 3);
    if (spec.guard === 'poly') {
      for (let x = barrelStart + 6; x < guardEnd - 4; x += 7) {
        line(ctx, x, spec.bore - 4, x, spec.bore + 4, 'rgba(0,0,0,0.45)', 1.4);
      }
    } else {
      line(ctx, barrelStart + 4, spec.bore - 6, guardEnd - 4, spec.bore - 6, 'rgba(255,230,190,0.30)', 1.2);
      line(ctx, barrelStart + 4, spec.bore + 5, guardEnd - 4, spec.bore + 5, 'rgba(0,0,0,0.35)', 1.2);
    }
  }

  slab(ctx, recX, recTop, recW, recH, spec.body);
  // Ejection port + charging handle break the flat receiver.
  slab(ctx, recX + recW * 0.52, recTop + 3, recW * 0.3, Math.max(5, recH * 0.32), '#1e272c', 1.5);
  line(ctx, recX + recW * 0.55, recTop + 4.5, recX + recW * 0.78, recTop + 4.5, 'rgba(255,255,255,0.22)', 1);

  drawMagazine(ctx, spec, recX, recW);
  drawGrip(ctx, spec, recX, recW);
  drawScope(ctx, spec);

  if (spec.bipod) {
    line(ctx, spec.tip - 34, spec.bore + 8, spec.tip - 44, spec.bore + 26, STEEL_DARK, 3);
    line(ctx, spec.tip - 26, spec.bore + 8, spec.tip - 16, spec.bore + 26, STEEL_DARK, 3);
  }

  drawMuzzle(ctx, spec, spec.tip, spec.double ? spec.barrel[0] / 2 : Math.max(6, spec.barrel[0]));

  // Family accent: one short bar, never a full paint job.
  line(ctx, recX + recW * 0.2, recTop + recH - 4, recX + recW * 0.7, recTop + recH - 4, spec.accent, 2.4);
}

/** Per-model extras that change the silhouette beyond the shared skeleton. */
function drawModelDetail(ctx: Ctx, id: WeaponId, spec: GunSpec): void {
  const [recX, recW, recH] = spec.rec;
  const recTop = spec.bore - recH / 2;
  switch (id) {
    case 'pistol':
      line(ctx, recX + 4, recTop + 3, recX + recW - 4, recTop + 3, STEEL_LIGHT, 1.6);
      line(ctx, recX + 3, recTop + recH - 3, recX + recW - 6, recTop + recH - 3, 'rgba(0,0,0,0.35)', 1.2);
      break;
    case 'p1911':
      for (let x = recX + 4; x < recX + recW - 4; x += 4) line(ctx, x, recTop + 3, x, recTop + recH - 4, 'rgba(0,0,0,0.30)', 1.1);
      break;
    case 'deagle':
      poly(ctx, [recX + 2, recTop, recX + recW - 6, recTop, recX + recW, recTop + 6, recX + 2, recTop + 6], STEEL_LIGHT);
      line(ctx, recX + 6, recTop + 9, recX + recW - 8, recTop + 9, GOLD, 1.6);
      break;
    case 'ump45':
      slab(ctx, recX - 2, recTop + 2, 16, recH - 4, POLY, 2);
      break;
    case 'vector':
      poly(ctx, [recX + 6, recTop + recH - 4, recX + recW - 2, recTop + 2, recX + recW - 2, recTop + 8, recX + 8, recTop + recH + 1], '#c8d0cf');
      break;
    case 'uzi':
      slab(ctx, recX + recW * 0.66, recTop - 3, 12, 5, '#2a343a', 1);
      break;
    case 'm416':
      for (let x = recX + recW - 26; x < recX + recW; x += 5) line(ctx, x, spec.bore - 4, x, spec.bore + 4, 'rgba(0,0,0,0.35)', 1.2);
      break;
    case 'akm':
      slab(ctx, recX + recW * 0.55, recTop - 4, 22, 5, WOOD_DARK, 1.5);
      line(ctx, recX + 4, spec.bore + 2, recX + 26, spec.bore + 2, WOOD_LIGHT, 1.4);
      break;
    case 'scar-l':
      slab(ctx, recX + 6, recTop - 4, recW - 18, 5, '#6b6448', 1.5);
      break;
    case 's686':
      circle(ctx, recX + recW - 2, spec.bore + 4, 4, STEEL_DARK);
      break;
    case 's1897':
      slab(ctx, recX + recW + 6, spec.bore + 6, 60, 6, '#3d484c', 3);
      break;
    case 's12k':
      slab(ctx, recX + 8, recTop - 4, recW - 22, 5, '#4a5340', 1.5);
      break;
    case 'kar98k':
      // Bolt handle: the one detail that separates it from the scoped M24.
      line(ctx, recX + recW - 10, spec.bore, recX + recW - 2, spec.bore + 9, STEEL_LIGHT, 3);
      circle(ctx, recX + recW - 2, spec.bore + 9, 3.4, STEEL_LIGHT);
      break;
    case 'm24':
      line(ctx, recX + recW - 12, spec.bore + 2, recX + recW - 2, spec.bore + 2, STEEL_LIGHT, 2.4);
      break;
    case 'awm':
      line(ctx, recX + recW - 14, spec.bore + 1, recX + recW - 2, spec.bore + 1, STEEL_LIGHT, 2.6);
      break;
    case 'rpg7':
      slab(ctx, recX + 26, recTop - 2, 30, recH + 4, WOOD, 3);
      for (let x = recX + 30; x < recX + 52; x += 6) line(ctx, x, recTop + 2, x, recTop + recH - 2, 'rgba(0,0,0,0.35)', 1.1);
      break;
    case 'at4':
      slab(ctx, recX + 8, recTop - 3, 22, 5, '#6d6a4e', 1.5);
      break;
    case 'gatling':
      for (let index = 0; index < 6; index++) {
        const y = spec.bore - 9 + index * 3.6;
        line(ctx, recX + recW, y, spec.tip - 4, y, STEEL_LIGHT, 2.2);
      }
      for (let x = recX + recW + 12; x < spec.tip - 8; x += 20) circle(ctx, x, spec.bore, 6, STEEL_DARK);
      break;
    case 'cannon':
      for (let x = spec.tip - 16; x < spec.tip - 2; x += 5) line(ctx, x, spec.bore - 7, x, spec.bore + 7, '#0f181d', 1.6);
      break;
    default:
      break;
  }
}

function drawBelt(ctx: Ctx, spec: GunSpec): void {
  if (!spec.belt) return;
  const [recX, recW] = spec.rec;
  for (let index = 0; index < 5; index++) {
    circle(ctx, recX + recW - 4 + index * 4, spec.bore + 14 + index, 2.4, GOLD);
  }
}

export function weaponFamily(id: WeaponId): WeaponId {
  return getWeapon(id).family ?? id;
}

export function weaponAccentColor(id: WeaponId): string {
  return SPECS[id]?.accent ?? '#aab4b7';
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

/** Tight local-space content boxes for HUD / crate icons (no grip-origin margins). */
const ICON_BOUNDS: Partial<Record<WeaponId, { x: number; y: number; width: number; height: number }>> = {
  pistol: { x: 14, y: 14, width: 78, height: 54 },
  smg: { x: 2, y: 16, width: 122, height: 56 },
  rifle: { x: 0, y: 14, width: 156, height: 60 },
  shotgun: { x: 0, y: 14, width: 156, height: 60 },
  sniper: { x: 0, y: 6, width: 158, height: 70 },
  rocket: { x: 0, y: 12, width: 158, height: 60 },
  gatling: { x: 0, y: 10, width: 154, height: 66 },
  cannon: { x: 0, y: 4, width: 158, height: 72 },
};

export function createWeaponArtCanvas(id: WeaponId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SAMPLE;
  canvas.height = HEIGHT * SAMPLE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SAMPLE, SAMPLE);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const spec = SPECS[id] ?? SPECS.pistol;
  drawGun(ctx, { ...spec, guard: GUARDS[id] ?? 'none' });
  drawModelDetail(ctx, id, spec);
  drawBelt(ctx, spec);
  // A single top-lit volume pass keeps 17 flat-colour models from reading as
  // stickers. It is clipped to opaque pixels only, so the transparent margins
  // and HUD crop stay clean.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const volume = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  volume.addColorStop(0, 'rgba(255,246,218,0.14)');
  volume.addColorStop(0.35, 'rgba(255,255,255,0)');
  volume.addColorStop(1, 'rgba(4,12,16,0.26)');
  ctx.fillStyle = volume;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.restore();
  return canvas;
}

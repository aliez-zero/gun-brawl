import type { CharacterAppearance, Vec2 } from '../../game/core/types';
import type { HumanoidPart, HumanoidPose } from './HumanoidRig';
import { paintCowboyPart } from './CowboyArt';
import { LIMB_SKINS, SKIN_ROWS, skinStrip } from './LimbSkin';
import type { SkinStrip } from './LimbSkin';

// Small cropped strips only; never retain a second full-body atlas for the editor.
const textures = new Map<string, HTMLCanvasElement>();
function texture(look: CharacterAppearance, part: HumanoidPart, spec: SkinStrip): HTMLCanvasElement {
  const key = `${look.color}-${look.skin}-${part}`;
  let image = textures.get(key);
  if (!image) {
    image = document.createElement('canvas');
    image.width = Math.ceil((spec.right - spec.left) * 3); image.height = Math.ceil((spec.bottom - spec.top) * 3);
    const ctx = image.getContext('2d')!;
    ctx.scale(3, 3); ctx.translate(-spec.left, -spec.top); paintCowboyPart(ctx, look, part);
    textures.set(key, image);
    while (textures.size > 64) textures.delete(textures.keys().next().value!);
  }
  return image;
}

function triangle(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement, spec: SkinStrip, source: Vec2[], target: Vec2[]): void {
  const s = source[0]!, a = source[1]!, b = source[2]!;
  const d = target[0]!, e = target[1]!, f = target[2]!;
  const sx = a.x - s.x, sy = a.y - s.y, tx = b.x - s.x, ty = b.y - s.y;
  const det = sx * ty - sy * tx;
  const ax = ((e.x - d.x) * ty - (f.x - d.x) * sy) / det;
  const ay = ((e.y - d.y) * ty - (f.y - d.y) * sy) / det;
  const bx = (sx * (f.x - d.x) - tx * (e.x - d.x)) / det;
  const by = (sx * (f.y - d.y) - tx * (e.y - d.y)) / det;
  ctx.save(); ctx.beginPath();
  // Inflate the clip by half a device pixel, independently of preview scale.
  // Canvas antialiases clip edges; unexpanded shared edges create dark seams.
  const de = Math.hypot(e.x - d.x, e.y - d.y), ef = Math.hypot(f.x - e.x, f.y - e.y), fd = Math.hypot(d.x - f.x, d.y - f.y);
  const perimeter = de + ef + fd;
  const radius = Math.abs((e.x - d.x) * (f.y - d.y) - (e.y - d.y) * (f.x - d.x)) / perimeter;
  const center = { x: (ef * d.x + fd * e.x + de * f.x) / perimeter, y: (ef * d.y + fd * e.y + de * f.y) / perimeter };
  const transform = ctx.getTransform(), pixelScale = Math.hypot(transform.a, transform.b);
  const overlap = 0.5 / (Math.max(pixelScale, 0.001) * Math.max(radius, 0.001));
  target.forEach((p, index) => {
    const x = p.x + (p.x - center.x) * overlap, y = p.y + (p.y - center.y) * overlap;
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.clip();
  ctx.transform(ax, ay, bx, by, d.x - ax * s.x - bx * s.y, d.y - ay * s.x - by * s.y);
  ctx.drawImage(image, spec.left, spec.top, image.width / 3, image.height / 3); ctx.restore();
}

/** Returns false for slots that should retain their normal rigid attachment. */
export function paintCowboySkin(ctx: CanvasRenderingContext2D, look: CharacterAppearance, pose: HumanoidPose, part: HumanoidPart): boolean {
  const spec = LIMB_SKINS[part];
  if (!spec || !pose.limbs) return false;
  const vertices = skinStrip(pose.limbs[spec.chain], spec), image = texture(look, part, spec);
  for (let row = 0; row < SKIN_ROWS - 1; row++) {
    const y = spec.top + (spec.bottom - spec.top) * row / (SKIN_ROWS - 1);
    const next = spec.top + (spec.bottom - spec.top) * (row + 1) / (SKIN_ROWS - 1);
    const source = [{ x: spec.left, y }, { x: spec.right, y }, { x: spec.left, y: next }, { x: spec.right, y: next }];
    const point = (index: number): Vec2 => ({ x: vertices[row * 4 + index * 2]!, y: vertices[row * 4 + index * 2 + 1]! });
    triangle(ctx, image, spec, [source[0]!, source[1]!, source[2]!], [point(0), point(1), point(2)]);
    triangle(ctx, image, spec, [source[2]!, source[1]!, source[3]!], [point(2), point(1), point(3)]);
  }
  return true;
}

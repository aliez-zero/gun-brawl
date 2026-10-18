import type { CharacterAppearance } from '../../game/core/types';
import { createWeaponArtCanvas, WEAPON_ART, weaponDisplayScale } from '../WeaponArt';
import { artBrush } from './ArtBrush';
import { paintAstronaut } from './AstronautArt';
import { paintCharacterHead, paintHeadwear } from './CharacterHeads';
import { COWBOY_ATLAS, paintCowboyPart } from './CowboyArt';
import { HUMANOID_PARTS } from './HumanoidRig';
import type { HumanoidPart, HumanoidPose } from './HumanoidRig';
import { paintKnight } from './KnightArt';
import { paintOperative } from './OperativeArt';
import { paintRonin } from './RoninArt';

export const HUMANOID_ATLAS = COWBOY_ATLAS;
let previewPistol: HTMLCanvasElement | undefined;
export function humanoidArtKey(look: CharacterAppearance): string {
  return `humanoid-rig-v1-${look.style}-${look.outfit}-${look.hat}-${look.color}-${look.skin}`;
}

/** Faces follow style, clothes follow outfit, and helmets remain interchangeable. */
export function paintHumanoidPart(ctx: CanvasRenderingContext2D, look: CharacterAppearance, part: HumanoidPart): void {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (part === 'previewGun') {
    previewPistol ??= createWeaponArtCanvas('pistol');
    const scale = weaponDisplayScale('pistol');
    ctx.drawImage(previewPistol, -WEAPON_ART.gripX * 3 * scale, -WEAPON_ART.gripY * 3 * scale, previewPistol.width * scale, previewPistol.height * scale);
  } else if (part === 'head') paintCharacterHead(ctx, look);
  else if (part === 'hat') paintHeadwear(ctx, look);
  else if (look.outfit === 'cowboy') paintCowboyPart(ctx, look, part);
  else {
    const brush = artBrush(ctx, look);
    switch (look.outfit) {
      case 'ronin': paintRonin(part, brush); break;
      case 'operative': paintOperative(part, brush); break;
      case 'astronaut': paintAstronaut(part, brush); break;
      case 'knight': paintKnight(part, brush); break;
    }
  }
  ctx.restore();
}

export function createHumanoidAtlas(look: CharacterAppearance): HTMLCanvasElement {
  const a = HUMANOID_ATLAS, canvas = document.createElement('canvas');
  canvas.width = a.width * a.columns; canvas.height = a.height * Math.ceil(HUMANOID_PARTS.length / a.columns);
  const ctx = canvas.getContext('2d')!;
  HUMANOID_PARTS.forEach((part, index) => {
    const x = index % a.columns * a.width, y = Math.floor(index / a.columns) * a.height;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, a.width, a.height); ctx.clip();
    ctx.translate(x + a.width * a.originX, y + a.height * a.originY); ctx.scale(a.sample, a.sample);
    paintHumanoidPart(ctx, look, part); ctx.restore();
  });
  return canvas;
}

/** Editor, thumbnails and battle use identical shapes and joint transforms. */
export function paintHumanoid(ctx: CanvasRenderingContext2D, look: CharacterAppearance, pose: HumanoidPose, withGun = true): void {
  for (const part of pose.parts) {
    if (part.part === 'previewGun' && !withGun) continue;
    ctx.save(); ctx.translate(part.x, part.y); ctx.rotate(part.rotation); ctx.scale(1, part.scaleY);
    paintHumanoidPart(ctx, look, part.part); ctx.restore();
  }
}

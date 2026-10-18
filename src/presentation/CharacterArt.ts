import type { CharacterAppearance } from '../game/core/types';
import { CHARACTER_ANIMATION, characterPoseForFrame } from './CharacterMotion';
import { paintCharacter } from './CharacterPainter';

export { paintCharacter, colorCss } from './CharacterPainter';
export type { CharacterPose } from './CharacterMotion';
export const CHARACTER_FRAME = { width: 240, height: 288, scale: 3, feet: 88 / 96 } as const;

export function characterKey(look: CharacterAppearance): string {
  return `look-v5-${look.style}-${look.hat}-${look.outfit}-${look.color}-${look.skin}`;
}

/** A grid keeps the atlas below common GPU texture-size limits as poses grow. */
export function createCharacterAtlas(look: CharacterAppearance): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CHARACTER_FRAME.width * CHARACTER_ANIMATION.columns;
  canvas.height = CHARACTER_FRAME.height * Math.ceil(CHARACTER_ANIMATION.frames / CHARACTER_ANIMATION.columns);
  const ctx = canvas.getContext('2d')!;
  for (let frame = 0; frame < CHARACTER_ANIMATION.frames; frame++) {
    const x = frame % CHARACTER_ANIMATION.columns * CHARACTER_FRAME.width;
    const y = Math.floor(frame / CHARACTER_ANIMATION.columns) * CHARACTER_FRAME.height;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, CHARACTER_FRAME.width, CHARACTER_FRAME.height); ctx.clip();
    ctx.translate(x + CHARACTER_FRAME.width / 2, y + CHARACTER_FRAME.height * CHARACTER_FRAME.feet);
    ctx.scale(CHARACTER_FRAME.scale, CHARACTER_FRAME.scale);
    paintCharacter(ctx, look, characterPoseForFrame(frame), false);
    ctx.restore();
  }
  return canvas;
}

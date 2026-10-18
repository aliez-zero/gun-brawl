import type { CharacterAppearance } from '../game/core/types';
import type { CharacterPose } from './CharacterMotion';
import { paintHumanoid } from './characters/HumanoidArt';
import { previewHumanoidPose } from './characters/HumanoidRig';

export { colorCss } from './characters/ArtBrush';

/** One drawing path for all five identities and every freely mixed outfit. */
export function paintCharacter(ctx: CanvasRenderingContext2D, look: CharacterAppearance, pose: CharacterPose = {}, withGun = true): void {
  paintHumanoid(ctx, look, previewHumanoidPose(pose, look), withGun);
}

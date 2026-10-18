import Phaser from 'phaser';
import type { CharacterAppearance } from '../../game/core/types';
import { HUMANOID_ATLAS, humanoidArtKey, createHumanoidAtlas } from './HumanoidArt';
import { HUMANOID_PARTS, worldWeaponMount } from './HumanoidRig';
import type { HumanoidPart, HumanoidPose, WeaponMount } from './HumanoidRig';

/** One shared parts atlas per appearance; transforms change, textures do not. */
export class HumanoidView {
  readonly key: string;
  private readonly images = new Map<HumanoidPart, Phaser.GameObjects.Image>();

  constructor(scene: Phaser.Scene, look: CharacterAppearance) {
    this.key = humanoidArtKey(look);
    if (!scene.textures.exists(this.key)) {
      const texture = scene.textures.addCanvas(this.key, createHumanoidAtlas(look))!;
      scene.textures.addSpriteSheet(this.key, texture, { frameWidth: HUMANOID_ATLAS.width, frameHeight: HUMANOID_ATLAS.height });
    }
    HUMANOID_PARTS.forEach((part, index) => {
      this.images.set(part, scene.add.image(0, 0, this.key, index).setOrigin(HUMANOID_ATLAS.originX, HUMANOID_ATLAS.originY));
    });
  }

  draw(x: number, y: number, facing: -1 | 1, scale: number, pose: HumanoidPose, alpha: number, withGun = false, hurt = false): WeaponMount {
    for (const bone of pose.parts) {
      this.images.get(bone.part)!
        .setPosition(x + bone.x * facing * scale, y + bone.y * scale)
        .setScale(scale / HUMANOID_ATLAS.sample, scale * bone.scaleY / HUMANOID_ATLAS.sample)
        .setFlipX(facing < 0).setRotation(bone.rotation * facing).setDepth(bone.depth)
        .setAlpha(alpha).setTint(hurt ? 0xffc9b2 : 0xffffff)
        .setVisible(bone.part !== 'previewGun' || withGun);
    }
    return worldWeaponMount(pose, { x, y }, facing, scale);
  }

  setVisible(visible: boolean): void {
    for (const image of this.images.values()) image.setVisible(visible);
  }

  destroy(): void {
    for (const image of this.images.values()) image.destroy();
    this.images.clear();
  }
}

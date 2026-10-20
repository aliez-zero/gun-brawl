import Phaser from 'phaser';
import type { CharacterAppearance } from '../../game/core/types';
import { HUMANOID_ATLAS, humanoidArtKey, createHumanoidAtlas } from './HumanoidArt';
import { HUMANOID_PARTS, worldWeaponMount } from './HumanoidRig';
import type { HumanoidPart, HumanoidPose, WeaponMount } from './HumanoidRig';
import { LIMB_SKINS, SKIN_ROWS, skinStrip } from './LimbSkin';

/** One shared parts atlas per appearance; transforms change, textures do not. */
export class HumanoidView {
  readonly key: string;
  private readonly images = new Map<HumanoidPart, Phaser.GameObjects.Image>();
  private readonly meshes = new Map<HumanoidPart, Phaser.GameObjects.Rope>();

  constructor(scene: Phaser.Scene, look: CharacterAppearance) {
    this.key = humanoidArtKey(look);
    if (!scene.textures.exists(this.key)) {
      const texture = scene.textures.addCanvas(this.key, createHumanoidAtlas(look))!;
      scene.textures.addSpriteSheet(this.key, texture, { frameWidth: HUMANOID_ATLAS.width, frameHeight: HUMANOID_ATLAS.height });
    }
    HUMANOID_PARTS.forEach((part, index) => {
      const spec = look.outfit === 'cowboy' && scene.game.renderer.type === Phaser.WEBGL ? LIMB_SKINS[part] : undefined;
      if (!spec) {
        this.images.set(part, scene.add.image(0, 0, this.key, index).setOrigin(HUMANOID_ATLAS.originX, HUMANOID_ATLAS.originY));
        return;
      }
      const points = Array.from({ length: SKIN_ROWS }, (_, row) => ({ x: 0, y: row }));
      const mesh = scene.add.rope(0, 0, this.key, index, points, false), frame = mesh.frame;
      for (let row = 0; row < SKIN_ROWS; row++) {
        const y = spec.top + (spec.bottom - spec.top) * row / (SKIN_ROWS - 1);
        const v = frame.v0 + (frame.v1 - frame.v0) * (HUMANOID_ATLAS.originY + y * HUMANOID_ATLAS.sample / frame.height);
        mesh.uv[row * 4] = frame.u0 + (frame.u1 - frame.u0) * (HUMANOID_ATLAS.originX + spec.left * HUMANOID_ATLAS.sample / frame.width);
        mesh.uv[row * 4 + 1] = v;
        mesh.uv[row * 4 + 2] = frame.u0 + (frame.u1 - frame.u0) * (HUMANOID_ATLAS.originX + spec.right * HUMANOID_ATLAS.sample / frame.width);
        mesh.uv[row * 4 + 3] = v;
      }
      this.meshes.set(part, mesh);
    });
  }

  draw(x: number, y: number, facing: -1 | 1, scale: number, pose: HumanoidPose, alpha: number, withGun = false, hurt = false): WeaponMount {
    for (const bone of pose.parts) {
      const mesh = this.meshes.get(bone.part);
      if (mesh) {
        const spec = LIMB_SKINS[bone.part]!;
        skinStrip(pose.limbs![spec.chain], spec, mesh.vertices);
        mesh.dirty = false;
        mesh.colors.fill(hurt ? 0xffc9b2 : 0xffffff);
        mesh.setPosition(x, y).setScale(scale * facing, scale).setDepth(bone.depth).setAlpha(alpha).setVisible(true);
        continue;
      }
      const image = this.images.get(bone.part)!;
      image
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
    for (const mesh of this.meshes.values()) mesh.setVisible(visible);
  }

  destroy(): void {
    for (const image of this.images.values()) image.destroy();
    for (const mesh of this.meshes.values()) mesh.destroy();
    this.images.clear();
    this.meshes.clear();
  }
}

import Phaser from 'phaser';
import type { MatchState } from '../game/core/types';
import { createWeaponArtCanvas, WEAPON_ART, weaponArtKey } from './WeaponArt';

/**
 * Independent weapon sprites. The character atlas deliberately contains no gun,
 * so a pickup only swaps this texture instead of rebuilding look atlases.
 */
export class WeaponLayer {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly ownedTextures = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  draw(state: Readonly<MatchState> | null, alpha: number): void {
    if (!state) {
      for (const sprite of this.sprites.values()) sprite.setVisible(false);
      return;
    }
    const visible = new Set<string>();
    for (const actor of state.actors) {
      if (actor.status !== 'alive') continue;
      visible.add(actor.config.id);
      const definition = actor.weapon.definition;
      const key = weaponArtKey(definition.id);
      if (!this.scene.textures.exists(key)) {
        this.scene.textures.addCanvas(key, createWeaponArtCanvas(definition.id));
        this.ownedTextures.add(key);
      }

      let sprite = this.sprites.get(actor.config.id);
      if (!sprite) {
        sprite = this.scene.add.image(0, 0, key)
          .setOrigin(WEAPON_ART.gripX / WEAPON_ART.width, WEAPON_ART.gripY / WEAPON_ART.height)
          .setScale(WEAPON_ART.displayScale)
          .setDepth(3);
        this.sprites.set(actor.config.id, sprite);
      }
      const interpolate = state.phase === 'playing';
      const x = interpolate ? Phaser.Math.Linear(actor.previous.x, actor.position.x, alpha) : actor.position.x;
      const y = interpolate ? Phaser.Math.Linear(actor.previous.y, actor.position.y, alpha) : actor.position.y;
      sprite
        .setTexture(key)
        .setPosition(x + actor.facing * WEAPON_ART.handX, y - WEAPON_ART.handY)
        .setFlipX(actor.facing < 0)
        .setVisible(true);
    }
    for (const [id, sprite] of this.sprites) if (!visible.has(id)) sprite.setVisible(false);
  }

  reset(): void {
    for (const sprite of this.sprites.values()) sprite.setVisible(false);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    for (const key of this.ownedTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.ownedTextures.clear();
  }
}

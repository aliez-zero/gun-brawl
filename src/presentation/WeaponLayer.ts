import Phaser from 'phaser';
import type { MatchState } from '../game/core/types';
import { createWeaponArtCanvas, WEAPON_ART, weaponArtKey, weaponDisplayScale } from './WeaponArt';
import { CHARACTER_GRIP, weaponPose } from './CharacterMotion';
import { createSupportHandCanvas, supportGrip, supportHandKey } from './WeaponSupport';

/**
 * Independent weapon sprites. The character atlas deliberately contains no gun,
 * so a pickup only swaps this texture instead of rebuilding look atlases.
 */
export class WeaponLayer {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly hands = new Map<string, Phaser.GameObjects.Image>();
  private readonly ownedTextures = new Set<string>();
  private readonly ownedHandTextures = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  draw(state: Readonly<MatchState> | null, alpha: number): void {
    if (!state) {
      for (const sprite of this.sprites.values()) sprite.setVisible(false);
      for (const hand of this.hands.values()) hand.setVisible(false);
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
          .setScale(weaponDisplayScale(definition.id))
          .setDepth(3);
        this.sprites.set(actor.config.id, sprite);
      }
      const interpolate = state.phase === 'playing';
      const x = interpolate ? Phaser.Math.Linear(actor.previous.x, actor.position.x, alpha) : actor.position.x;
      const y = interpolate ? Phaser.Math.Linear(actor.previous.y, actor.position.y, alpha) : actor.position.y;
      const pose = weaponPose(actor);
      sprite
        .setTexture(key)
        .setScale(weaponDisplayScale(definition.id))
        .setPosition(x + actor.facing * (CHARACTER_GRIP.x + pose.x), y + CHARACTER_GRIP.y + pose.y)
        .setFlipX(actor.facing < 0)
        .setRotation(pose.rotation)
        .setAlpha(pose.alpha)
        .setVisible(true);

      const attachment = supportGrip(definition.id);
      let hand = this.hands.get(actor.config.id);
      if (!attachment) {
        hand?.setVisible(false);
        continue;
      }
      const skin = actor.config.appearance?.skin ?? 0xe2b58e;
      const handKey = supportHandKey(skin);
      if (!this.scene.textures.exists(handKey)) {
        this.scene.textures.addCanvas(handKey, createSupportHandCanvas(skin));
        this.ownedHandTextures.add(handKey);
      }
      if (!hand) {
        hand = this.scene.add.image(0, 0, handKey)
          .setOrigin(9 / 20, 8 / 16)
          .setScale(0.55)
          .setDepth(3.2);
        this.hands.set(actor.config.id, hand);
      }
      const scale = weaponDisplayScale(definition.id);
      const dx = (attachment.x - WEAPON_ART.gripX) * scale * (actor.facing < 0 ? -1 : 1);
      const dy = (attachment.y - WEAPON_ART.gripY) * scale;
      const cos = Math.cos(pose.rotation);
      const sin = Math.sin(pose.rotation);
      hand
        .setTexture(handKey)
        .setPosition(sprite.x + dx * cos - dy * sin, sprite.y + dx * sin + dy * cos)
        .setFlipX(actor.facing < 0)
        .setRotation(pose.rotation)
        .setAlpha(pose.alpha)
        .setVisible(true);
    }
    for (const [id, sprite] of this.sprites) if (!visible.has(id)) sprite.setVisible(false);
    for (const [id, hand] of this.hands) if (!visible.has(id)) hand.setVisible(false);
  }

  reset(): void {
    for (const sprite of this.sprites.values()) sprite.setVisible(false);
    for (const hand of this.hands.values()) hand.setVisible(false);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    for (const hand of this.hands.values()) hand.destroy();
    this.sprites.clear();
    this.hands.clear();
    for (const key of this.ownedTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    for (const key of this.ownedHandTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.ownedTextures.clear();
    this.ownedHandTextures.clear();
  }
}

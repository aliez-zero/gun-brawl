import Phaser from 'phaser';
import type { MatchState } from '../game/core/types';
import { createWeaponArtCanvas, WEAPON_ART, weaponArtKey, weaponDisplayScale } from './WeaponArt';
import { CHARACTER_GRIP, weaponPose } from './CharacterMotion';
import { createGripHandCanvas, createSupportHandCanvas, gripHandKey, supportGrip, supportHandKey } from './WeaponSupport';

const OUTLINE = 0x152531;

/** Sleeve colour follows the outfit; the atlas arm is hidden behind the gun. */
function sleeveColor(appearance: { outfit: string; color: number } | undefined): number {
  switch (appearance?.outfit) {
    case 'astronaut': return 0xb8c9ce;
    case 'knight': return 0x5c7784;
    case 'operative': return 0x3c4a52;
    default: return 0x5a3a2e;
  }
}

/**
 * Independent weapon sprites. The character atlas deliberately contains no gun,
 * so a pickup only swaps this texture instead of rebuilding look atlases.
 */
export class WeaponLayer {
  private readonly sprites = new Map<string, Phaser.GameObjects.Image>();
  private readonly hands = new Map<string, Phaser.GameObjects.Image>();
  private readonly gripHands = new Map<string, Phaser.GameObjects.Image>();
  private readonly arms = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly supportArms = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly ownedTextures = new Set<string>();
  private readonly ownedHandTextures = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {}

  draw(state: Readonly<MatchState> | null, alpha: number): void {
    if (!state) {
      for (const sprite of this.sprites.values()) sprite.setVisible(false);
      for (const hand of this.hands.values()) hand.setVisible(false);
      for (const grip of this.gripHands.values()) grip.setVisible(false);
      for (const arm of this.arms.values()) arm.setVisible(false);
      for (const arm of this.supportArms.values()) arm.setVisible(false);
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
          // In front of the body so the silhouette is identical left/right; the
          // foreground grip hand keeps it from looking like a floating prop.
          .setDepth(3);
        this.sprites.set(actor.config.id, sprite);
      }
      const interpolate = state.phase === 'playing';
      const x = interpolate ? Phaser.Math.Linear(actor.previous.x, actor.position.x, alpha) : actor.position.x;
      const y = interpolate ? Phaser.Math.Linear(actor.previous.y, actor.position.y, alpha) : actor.position.y;
      const pose = weaponPose(actor);
      // Phaser mirrors the texture around the frame centre, not the grip origin.
      // Mirror the origin as well so the grip stays under the hand when facing
      // left; otherwise the stock jumps across the body and it reads as a new gun.
      const gripOriginX = WEAPON_ART.gripX / WEAPON_ART.width;
      const originX = actor.facing < 0 ? 1 - gripOriginX : gripOriginX;
      sprite
        .setTexture(key)
        .setOrigin(originX, WEAPON_ART.gripY / WEAPON_ART.height)
        .setScale(weaponDisplayScale(definition.id))
        .setPosition(x + actor.facing * (CHARACTER_GRIP.x + pose.x), y + CHARACTER_GRIP.y + pose.y)
        .setFlipX(actor.facing < 0)
        .setRotation(pose.rotation)
        .setAlpha(pose.alpha)
        .setVisible(true);

      const skin = actor.config.appearance?.skin ?? 0xe2b58e;
      const sleeve = sleeveColor(actor.config.appearance);
      let arm = this.arms.get(actor.config.id);
      if (!arm) {
        arm = this.scene.add.graphics().setDepth(3.35);
        this.arms.set(actor.config.id, arm);
      }
      const shoulder = { x: x + actor.facing * 11, y: y - 40 };
      const elbow = { x: x + actor.facing * 18, y: y - 27 };
      arm.clear();
      arm.lineStyle(11, OUTLINE, 1).beginPath();
      arm.moveTo(shoulder.x, shoulder.y); arm.lineTo(elbow.x, elbow.y); arm.lineTo(sprite.x, sprite.y);
      arm.strokePath();
      // Sleeve to the elbow, bare forearm to the wrist: the hold reads at game scale.
      arm.lineStyle(7, sleeve, 1).beginPath();
      arm.moveTo(shoulder.x, shoulder.y); arm.lineTo(elbow.x, elbow.y); arm.strokePath();
      arm.lineStyle(6, skin, 1).beginPath();
      arm.moveTo(elbow.x, elbow.y); arm.lineTo(sprite.x, sprite.y); arm.strokePath();
      arm.fillStyle(OUTLINE, 1).fillCircle(shoulder.x, shoulder.y, 5).fillCircle(elbow.x, elbow.y, 4.5);
      arm.fillStyle(sleeve, 1).fillCircle(shoulder.x, shoulder.y, 3.5);
      arm.fillStyle(skin, 1).fillCircle(elbow.x, elbow.y, 3);
      arm.setAlpha(pose.alpha).setVisible(true);

      const gripKey = gripHandKey(skin);
      if (!this.scene.textures.exists(gripKey)) {
        this.scene.textures.addCanvas(gripKey, createGripHandCanvas(skin));
        this.ownedHandTextures.add(gripKey);
      }
      let grip = this.gripHands.get(actor.config.id);
      if (!grip) {
        grip = this.scene.add.image(0, 0, gripKey).setOrigin(0.5).setScale(0.55).setDepth(3.4);
        this.gripHands.set(actor.config.id, grip);
      }
      grip
        .setTexture(gripKey)
        .setPosition(sprite.x, sprite.y + 1)
        .setFlipX(actor.facing < 0)
        .setRotation(pose.rotation)
        .setAlpha(pose.alpha)
        .setVisible(true);

      const attachment = supportGrip(definition.id);
      let hand = this.hands.get(actor.config.id);
      if (!attachment) {
        hand?.setVisible(false);
        this.supportArms.get(actor.config.id)?.setVisible(false);
        continue;
      }
      const handKey = supportHandKey(skin);
      if (!this.scene.textures.exists(handKey)) {
        this.scene.textures.addCanvas(handKey, createSupportHandCanvas(skin));
        this.ownedHandTextures.add(handKey);
      }
      if (!hand) {
        hand = this.scene.add.image(0, 0, handKey)
          .setOrigin(9 / 20, 8 / 16)
          .setScale(0.64)
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

      let supportArm = this.supportArms.get(actor.config.id);
      if (!supportArm) {
        supportArm = this.scene.add.graphics().setDepth(3.15);
        this.supportArms.set(actor.config.id, supportArm);
      }
      const chest = { x: x - actor.facing * 5, y: y - 36 };
      const supportElbow = { x: (chest.x + hand.x) / 2, y: Math.min(chest.y, hand.y) + 4 };
      supportArm.clear();
      supportArm.lineStyle(9, OUTLINE, 1).beginPath();
      supportArm.moveTo(chest.x, chest.y); supportArm.lineTo(supportElbow.x, supportElbow.y); supportArm.lineTo(hand.x, hand.y);
      supportArm.strokePath();
      supportArm.lineStyle(5, sleeve, 1).beginPath();
      supportArm.moveTo(chest.x, chest.y); supportArm.lineTo(supportElbow.x, supportElbow.y); supportArm.strokePath();
      supportArm.lineStyle(4, skin, 1).beginPath();
      supportArm.moveTo(supportElbow.x, supportElbow.y); supportArm.lineTo(hand.x, hand.y); supportArm.strokePath();
      supportArm.fillStyle(OUTLINE, 1).fillCircle(chest.x, chest.y, 4);
      supportArm.fillStyle(sleeve, 1).fillCircle(chest.x, chest.y, 2.8);
      supportArm.setAlpha(pose.alpha).setVisible(true);
    }
    for (const [id, sprite] of this.sprites) if (!visible.has(id)) sprite.setVisible(false);
    for (const [id, hand] of this.hands) if (!visible.has(id)) hand.setVisible(false);
    for (const [id, grip] of this.gripHands) if (!visible.has(id)) grip.setVisible(false);
    for (const [id, arm] of this.arms) if (!visible.has(id)) arm.setVisible(false);
    for (const [id, arm] of this.supportArms) if (!visible.has(id)) arm.setVisible(false);
  }

  reset(): void {
    for (const sprite of this.sprites.values()) sprite.setVisible(false);
    for (const hand of this.hands.values()) hand.setVisible(false);
    for (const grip of this.gripHands.values()) grip.setVisible(false);
    for (const arm of this.arms.values()) arm.setVisible(false);
    for (const arm of this.supportArms.values()) arm.setVisible(false);
  }

  destroy(): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    for (const hand of this.hands.values()) hand.destroy();
    for (const grip of this.gripHands.values()) grip.destroy();
    for (const arm of this.arms.values()) arm.destroy();
    for (const arm of this.supportArms.values()) arm.destroy();
    this.sprites.clear();
    this.hands.clear();
    this.gripHands.clear();
    this.arms.clear();
    this.supportArms.clear();
    for (const key of this.ownedTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    for (const key of this.ownedHandTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.ownedTextures.clear();
    this.ownedHandTextures.clear();
  }
}

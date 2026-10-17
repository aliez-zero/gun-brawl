import Phaser from 'phaser';
import { presetAppearance } from '../content/appearances';
import { TRAINING_ARENA } from '../content/maps';
import type { BattleEvent, CharacterAppearance, HumanSlot, MapDefinition, MatchState, Vec2 } from '../game/core/types';
import { CHARACTER_FRAME, characterKey, colorCss, createCharacterAtlas } from './CharacterArt';
import { paintWorld } from './WorldArt';

interface Effect extends Vec2 { life: number; kind: 'hit' | 'shot' | 'respawn' }
interface CharacterView { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text }

export class ArenaRenderer {
  private readonly background: Phaser.GameObjects.Image;
  private readonly shadows: Phaser.GameObjects.Graphics;
  private readonly effectsView: Phaser.GameObjects.Graphics;
  private readonly views = new Map<string, CharacterView>();
  private readonly ownedTextures = new Set<string>();
  private readonly appearanceKeys = new Set<string>();
  private readonly shotAt = new Map<string, number>();
  private readonly hitAt = new Map<string, number>();
  private effects: Effect[] = [];
  private clock = 0;
  private previewLooks: Record<HumanSlot, CharacterAppearance> = { 1: presetAppearance('cowboy'), 2: presetAppearance('ronin') };
  reducedMotion = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.background = scene.add.image(0, 0, '__WHITE').setOrigin(0).setDepth(-20);
    this.shadows = scene.add.graphics().setDepth(0);
    this.effectsView = scene.add.graphics().setDepth(4);
    this.setMap(TRAINING_ARENA);
  }

  setMap(map: MapDefinition): void {
    const key = `world-${map.id}`;
    if (!this.scene.textures.exists(key)) {
      const canvas = document.createElement('canvas');
      canvas.width = map.width; canvas.height = map.height;
      paintWorld(canvas.getContext('2d')!, map);
      this.scene.textures.addCanvas(key, canvas);
      this.ownedTextures.add(key);
    }
    this.background.setTexture(key);
  }

  setMenuPreview(map: MapDefinition, looks: Record<HumanSlot, CharacterAppearance>): void {
    this.setMap(map);
    this.previewLooks = { 1: { ...looks[1] }, 2: { ...looks[2] } };
  }

  reset(): void {
    this.effects = [];
    this.shotAt.clear(); this.hitAt.clear(); this.clock = 0;
    for (const view of this.views.values()) { view.sprite.destroy(); view.label.destroy(); }
    this.views.clear(); this.shadows.clear(); this.effectsView.clear();
    this.scene.cameras.main.resetFX();
    this.trimAtlases();
  }

  handle(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'hit' || event.type === 'shot' || event.type === 'respawn') this.effects.push({ ...event.position, life: 0.2, kind: event.type });
      if (event.type === 'shot') this.shotAt.set(event.actorId, this.clock);
      if (event.type === 'hit') this.hitAt.set(event.actorId, this.clock);
      if (event.type === 'ringout' && !this.reducedMotion) this.scene.cameras.main.shake(110, 0.002);
    }
    this.effects = this.effects.slice(-40);
  }

  draw(state: Readonly<MatchState> | null, alpha: number, seconds: number): void {
    const g = this.effectsView;
    g.clear(); this.shadows.clear();
    if (!state) {
      this.character('preview-2', this.previewLooks[2], 807, 623, 1, 1.85, 0, 1, '', 0x82d5e3);
      this.character('preview-1', this.previewLooks[1], 1045, 631, -1, 3.15, 0, 1, '', 0xc4f56b);
      return;
    }
    const frozen = state.phase !== 'playing';
    if (!frozen) this.clock += Math.min(seconds, 0.1);
    for (const actor of state.actors) {
      const id = actor.config.id;
      if (actor.status !== 'alive') {
        this.views.get(id)?.sprite.setVisible(false);
        this.views.get(id)?.label.setVisible(false);
        continue;
      }
      const x = frozen ? actor.position.x : Phaser.Math.Linear(actor.previous.x, actor.position.x, alpha);
      const y = frozen ? actor.position.y : Phaser.Math.Linear(actor.previous.y, actor.position.y, alpha);
      let frame = actor.groundedOn === null ? 7 : Math.abs(actor.moveVelocity) > 15 ? 1 + Math.floor(this.clock * 12) % 6 : 0;
      if (this.clock - (this.shotAt.get(id) ?? -1) < 0.1) frame = 8;
      if (this.clock - (this.hitAt.get(id) ?? -1) < 0.12) frame = 9;
      this.character(id, actor.config.appearance ?? presetAppearance('cowboy'), x, y, actor.facing, 1, frame,
        actor.protectionRemaining > 0 ? 0.78 : 1, actor.config.name, actor.config.color);
      if (actor.protectionRemaining > 0) {
        g.lineStyle(2, actor.config.color, 0.65);
        g.strokeEllipse(x, y - 40, 65, 98);
      }
    }
    for (const projectile of state.projectiles) {
      const x = frozen ? projectile.position.x : Phaser.Math.Linear(projectile.previous.x, projectile.position.x, alpha);
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      const dx = speed > 1e-8 ? projectile.velocity.x / speed : projectile.direction;
      const dy = speed > 1e-8 ? projectile.velocity.y / speed : 0;
      g.lineStyle(7, 0xffd38a, 0.18);
      g.lineBetween(x - dx * 16, projectile.position.y - dy * 16, x + dx * 3, projectile.position.y + dy * 3);
      g.lineStyle(2.5, 0xffefbf, 1);
      g.lineBetween(x - dx * 12, projectile.position.y - dy * 12, x + dx * 4, projectile.position.y + dy * 4);
    }
    for (const effect of this.effects) {
      if (!frozen) effect.life -= seconds;
      const opacity = Math.max(0, effect.life / 0.2);
      const radius = (1 - opacity) * (effect.kind === 'respawn' ? 45 : 20) + 3;
      g.lineStyle(2, effect.kind === 'hit' ? 0xffb595 : 0xffe7a3, opacity);
      if (effect.kind === 'shot') {
        for (let i = 0; i < 4; i++) {
          const angle = i * Math.PI / 2 + 0.3;
          g.lineBetween(effect.x + Math.cos(angle) * 3, effect.y + Math.sin(angle) * 3,
            effect.x + Math.cos(angle) * radius, effect.y + Math.sin(angle) * radius);
        }
      } else g.strokeCircle(effect.x, effect.y, radius);
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  private character(id: string, look: CharacterAppearance, x: number, y: number, facing: -1 | 1, scale: number, frame: number, alpha: number, name: string, identity: number): void {
    const key = characterKey(look);
    if (!this.scene.textures.exists(key)) {
      const texture = this.scene.textures.addCanvas(key, createCharacterAtlas(look))!;
      this.scene.textures.addSpriteSheet(key, texture, { frameWidth: CHARACTER_FRAME.width, frameHeight: CHARACTER_FRAME.height });
      this.ownedTextures.add(key); this.appearanceKeys.add(key);
    }
    let view = this.views.get(id);
    if (!view) {
      view = {
        sprite: this.scene.add.sprite(x, y, key).setOrigin(0.5, CHARACTER_FRAME.feet).setDepth(2),
        label: this.scene.add.text(0, 0, '', { fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif', fontSize: '13px', fontStyle: 'bold', stroke: '#14202a', strokeThickness: 4 }).setOrigin(0.5, 1).setDepth(8),
      };
      this.views.set(id, view);
    }
    view.sprite.setTexture(key, frame).setVisible(true).setPosition(x, y).setScale(scale / CHARACTER_FRAME.scale).setFlipX(facing < 0).setAlpha(alpha);
    this.shadows.fillStyle(0x091723, 0.3 * alpha);
    this.shadows.fillEllipse(x, y + 3, 44 * scale, 8 * scale);
    const offscreen = x < 22 || x > 1258 || y < 85 || y > 710;
    const direction = x < 22 ? '←' : x > 1258 ? '→' : y < 85 ? '↑' : '↓';
    view.label.setVisible(Boolean(name)).setColor(colorCss(identity)).setPosition(Phaser.Math.Clamp(x, 44, 1236), Phaser.Math.Clamp(y - 92, 110, 674))
      .setText(offscreen ? `${direction} ${name}` : name);
    this.trimAtlases();
  }

  private trimAtlases(): void {
    if (this.appearanceKeys.size <= 12) return;
    const active = new Set([...this.views.values()].map((view) => view.sprite.texture.key));
    for (const key of this.appearanceKeys) {
      if (active.has(key)) continue;
      this.scene.textures.remove(key); this.appearanceKeys.delete(key); this.ownedTextures.delete(key);
      if (this.appearanceKeys.size <= 12) break;
    }
  }

  destroy(): void {
    this.reset(); this.background.destroy(); this.shadows.destroy(); this.effectsView.destroy();
    for (const key of this.ownedTextures) this.scene.textures.remove(key);
    this.ownedTextures.clear(); this.appearanceKeys.clear();
  }
}

import Phaser from 'phaser';
import { presetAppearance } from '../content/appearances';
import { TRAINING_ARENA } from '../content/maps';
import { getWeapon, weaponBurstImpulse } from '../content/weapons';
import type { BattleEvent, CharacterAppearance, HumanSlot, MapDefinition, MatchState, Vec2, WeaponId } from '../game/core/types';
import { CHARACTER_FRAME, characterKey, colorCss, createCharacterAtlas } from './CharacterArt';
import { characterFrame } from './CharacterMotion';
import { paintWorld } from './WorldArt';

interface Effect extends Vec2 { life: number; kind: 'hit' | 'shot' | 'respawn'; weaponId?: WeaponId }
interface CharacterView { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text }

interface TrailStyle { width: number; length: number; color: number; glow: number; glowWidth: number; glowAlpha: number }

const TRAIL_STYLES: Record<string, TrailStyle> = {
  pistol: { width: 1.5, length: 7, color: 0xfff1c4, glow: 0xffcf78, glowWidth: 4, glowAlpha: 0.13 },
  smg: { width: 1.8, length: 9, color: 0xffe39a, glow: 0xffc45c, glowWidth: 5, glowAlpha: 0.15 },
  rifle: { width: 2.4, length: 15, color: 0xffc766, glow: 0xff9a3d, glowWidth: 7, glowAlpha: 0.18 },
  shotgun: { width: 1.7, length: 8, color: 0xffb56d, glow: 0xff7d3d, glowWidth: 5, glowAlpha: 0.16 },
  sniper: { width: 3.2, length: 28, color: 0xd8f6ff, glow: 0x8fd9ff, glowWidth: 9, glowAlpha: 0.2 },
  rocket: { width: 2.4, length: 18, color: 0xffd28a, glow: 0xff6a2d, glowWidth: 10, glowAlpha: 0.2 },
  gatling: { width: 1.8, length: 10, color: 0xffdf8a, glow: 0xffb347, glowWidth: 5, glowAlpha: 0.14 },
  cannon: { width: 4.6, length: 38, color: 0xfff4ef, glow: 0xff4f68, glowWidth: 12, glowAlpha: 0.24 },
};

function trailStyle(id: WeaponId): TrailStyle {
  const weapon = getWeapon(id);
  const family = weapon.family ?? id;
  const base = TRAIL_STYLES[family] ?? TRAIL_STYLES.rifle!;
  // Bigger single-shot guns get a slightly heavier tracer; shotgun pellets stay small.
  const boost = family === 'shotgun'
    ? 1
    : Math.max(0.8, Math.min(1.6, Math.sqrt(weaponBurstImpulse(weapon) / 500)));
  return {
    ...base,
    width: base.width * boost,
    length: base.length * boost,
    glowWidth: base.glowWidth * boost,
  };
}

export class ArenaRenderer {
  private readonly background: Phaser.GameObjects.Image;
  private readonly shadows: Phaser.GameObjects.Graphics;
  private readonly effectsView: Phaser.GameObjects.Graphics;
  private readonly views = new Map<string, CharacterView>();
  private readonly ownedTextures = new Set<string>();
  private readonly appearanceKeys = new Set<string>();
  private readonly hitAt = new Map<string, number>();
  private readonly landedAt = new Map<string, number>();
  private readonly wasAirborne = new Set<string>();
  private effects: Effect[] = [];
  private clock = 0;
  private previewLooks: Record<HumanSlot, CharacterAppearance> = { 1: presetAppearance('cowboy'), 2: presetAppearance('ronin') };
  private previewFeet: Record<HumanSlot, Vec2> = { 1: { x: 1035, y: 620 }, 2: { x: 807, y: 620 } };
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
    const landing = (x: number, preferredY: number): Vec2 => {
      const safeX = (p: MapDefinition['platforms'][number]): number => Math.max(p.x + 35, Math.min(x, p.x + p.width - 35));
      const distance = (p: MapDefinition['platforms'][number]): number => Math.abs(safeX(p) - x) + Math.abs(p.y - preferredY) * 0.3;
      const platform = map.platforms.filter((p) => p.width >= 70 && p.y >= 480)
        .sort((a, b) => distance(a) - distance(b))[0];
      return platform ? { x: safeX(platform), y: platform.y } : { ...map.spawns.at(-1)! };
    };
    this.previewFeet = { 1: landing(1055, 610), 2: landing(807, 540) };
  }

  reset(): void {
    this.effects = [];
    this.hitAt.clear(); this.landedAt.clear(); this.wasAirborne.clear(); this.clock = 0;
    for (const view of this.views.values()) { view.sprite.destroy(); view.label.destroy(); }
    this.views.clear(); this.shadows.clear(); this.effectsView.clear();
    this.scene.cameras.main.resetFX();
    this.trimAtlases();
  }

  handle(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'hit' || event.type === 'shot' || event.type === 'respawn') {
        this.effects.push({ ...event.position, life: 0.2, kind: event.type, ...(event.type === 'shot' ? { weaponId: event.weaponId } : {}) });
      }
      if (event.type === 'hit') this.hitAt.set(event.actorId, this.clock);
      if (event.type === 'respawn') { this.wasAirborne.delete(event.actorId); this.landedAt.delete(event.actorId); this.hitAt.delete(event.actorId); }
      if (event.type === 'ringout' && !this.reducedMotion) this.scene.cameras.main.shake(110, 0.002);
    }
    this.effects = this.effects.slice(-40);
  }

  draw(state: Readonly<MatchState> | null, alpha: number, seconds: number): void {
    const g = this.effectsView;
    g.clear(); this.shadows.clear();
    if (!state) {
      this.character('preview-2', this.previewLooks[2], this.previewFeet[2].x, this.previewFeet[2].y, 1, 1.85, 0, 1, '', 0x82d5e3);
      this.character('preview-1', this.previewLooks[1], this.previewFeet[1].x, this.previewFeet[1].y, -1, 3.15, 0, 1, '', 0xc4f56b);
      return;
    }
    const frozen = state.phase !== 'playing';
    if (!frozen) this.clock += Math.min(seconds, 0.1);
    for (const actor of state.actors) {
      const id = actor.config.id;
      if (actor.status !== 'alive') {
        this.views.get(id)?.sprite.setVisible(false);
        this.views.get(id)?.label.setVisible(false);
        this.wasAirborne.delete(id); this.landedAt.delete(id);
        continue;
      }
      const x = frozen ? actor.position.x : Phaser.Math.Linear(actor.previous.x, actor.position.x, alpha);
      const y = frozen ? actor.position.y : Phaser.Math.Linear(actor.previous.y, actor.position.y, alpha);
      if (!frozen) {
        if (actor.groundedOn === null) this.wasAirborne.add(id);
        else if (this.wasAirborne.delete(id)) this.landedAt.set(id, this.clock);
      }
      const frame = characterFrame(actor, this.clock, this.clock - (this.hitAt.get(id) ?? -10), this.clock - (this.landedAt.get(id) ?? -10));
      this.character(id, actor.config.appearance ?? presetAppearance('cowboy'), x, y, actor.facing, 1, frame,
        actor.protectionRemaining > 0 ? 0.78 : 1, actor.config.name, actor.config.color);
      if (actor.protectionRemaining > 0) {
        g.lineStyle(2, actor.config.color, 0.65);
        g.strokeEllipse(x, y - 40, 65, 98);
      }
    }
    for (const projectile of state.projectiles) {
      const x = frozen ? projectile.position.x : Phaser.Math.Linear(projectile.previous.x, projectile.position.x, alpha);
      const y = frozen ? projectile.position.y : Phaser.Math.Linear(projectile.previous.y, projectile.position.y, alpha);
      const speed = Math.hypot(projectile.velocity.x, projectile.velocity.y);
      const dx = speed > 1e-8 ? projectile.velocity.x / speed : projectile.direction;
      const dy = speed > 1e-8 ? projectile.velocity.y / speed : 0;
      const style = trailStyle(projectile.weaponId);
      const family = getWeapon(projectile.weaponId).family ?? projectile.weaponId;
      // Never draw the trail behind the muzzle on the first frame after firing.
      const origin = projectile.origin ?? projectile.position;
      const travel = Math.hypot(x - origin.x, y - origin.y);
      const back = Math.min(style.length, travel);
      if (family === 'rocket') {
        g.lineStyle(style.glowWidth, 0xff5b2a, style.glowAlpha);
        g.lineBetween(x - dx * back, y - dy * back, x - dx * 2, y - dy * 2);
        g.lineStyle(style.width, 0xffb347, 0.95);
        g.lineBetween(x - dx * Math.min(15, back), y - dy * Math.min(15, back), x + dx * 2, y + dy * 2);
        g.fillStyle(0x273036, 1).fillCircle(x + dx * 3, y + dy * 3, 4);
        g.lineStyle(1.2, 0xffdf9a, 1).lineBetween(x - dx * 2, y - dy * 2, x + dx * 7, y + dy * 7);
        continue;
      }
      g.lineStyle(style.glowWidth, style.glow, style.glowAlpha);
      g.lineBetween(x - dx * back, y - dy * back, x + dx * 3, y + dy * 3);
      g.lineStyle(style.width, style.color, 1);
      g.lineBetween(x - dx * back * 0.72, y - dy * back * 0.72, x + dx * 4, y + dy * 4);
    }
    for (const effect of this.effects) {
      if (!frozen) effect.life -= seconds;
      const opacity = Math.max(0, effect.life / 0.2);
      const radius = (1 - opacity) * (effect.kind === 'respawn' ? 45 : 20) + 3;
      g.lineStyle(2, effect.kind === 'hit' ? 0xffb595 : 0xffe7a3, opacity);
      if (effect.kind === 'shot') this.drawMuzzle(g, effect, opacity, radius);
      else g.strokeCircle(effect.x, effect.y, radius);
    }
    this.effects = this.effects.filter((effect) => effect.life > 0);
  }

  private drawMuzzle(g: Phaser.GameObjects.Graphics, effect: Effect, opacity: number, radius: number): void {
    const weapon = getWeapon(effect.weaponId ?? 'pistol');
    const family = weapon.family ?? effect.weaponId ?? 'pistol';
    const flashBoost = family === 'shotgun'
      ? 1.2
      : Math.max(0.85, Math.min(1.8, Math.sqrt(weaponBurstImpulse(weapon) / 500)));
    radius *= flashBoost;
    const color = effect.weaponId === 'cannon' ? 0xff7d8f : family === 'rocket' ? 0xffc45c : 0xffe7a3;
    g.lineStyle(2, color, opacity);
    if (family === 'shotgun') {
      for (let i = -2; i <= 2; i++) g.lineBetween(effect.x, effect.y, effect.x + radius * 1.3, effect.y + i * radius * 0.3);
      return;
    }
    if (family === 'sniper') {
      g.lineBetween(effect.x - radius * 2, effect.y, effect.x + radius * 1.6, effect.y);
      g.lineStyle(1, color, opacity * 0.6);
      g.lineBetween(effect.x, effect.y - radius * 0.5, effect.x + radius, effect.y + radius * 0.4);
      return;
    }
    if (family === 'rocket') {
      g.lineStyle(3, 0xffb84f, opacity * 0.8);
      g.strokeCircle(effect.x - radius * 0.5, effect.y + radius * 0.4, radius * 0.8);
      g.lineBetween(effect.x - radius * 1.8, effect.y + radius * 0.7, effect.x - radius * 0.2, effect.y);
      return;
    }
    if (family === 'gatling' || family === 'cannon') {
      g.lineStyle(3, color, opacity);
      g.strokeCircle(effect.x, effect.y, radius * 1.1);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3;
        g.lineBetween(effect.x, effect.y, effect.x + Math.cos(angle) * radius * 1.8, effect.y + Math.sin(angle) * radius * 1.8);
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const angle = i * Math.PI / 2 + 0.3;
      g.lineBetween(effect.x + Math.cos(angle) * 3, effect.y + Math.sin(angle) * 3,
        effect.x + Math.cos(angle) * radius, effect.y + Math.sin(angle) * radius);
    }
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
    if (this.appearanceKeys.size <= 8) return;
    const active = new Set([...this.views.values()].map((view) => view.sprite.texture.key));
    for (const key of this.appearanceKeys) {
      if (active.has(key)) continue;
      this.scene.textures.remove(key); this.appearanceKeys.delete(key); this.ownedTextures.delete(key);
      if (this.appearanceKeys.size <= 8) break;
    }
  }

  destroy(): void {
    this.reset(); this.background.destroy(); this.shadows.destroy(); this.effectsView.destroy();
    for (const key of this.ownedTextures) this.scene.textures.remove(key);
    this.ownedTextures.clear(); this.appearanceKeys.clear();
  }
}

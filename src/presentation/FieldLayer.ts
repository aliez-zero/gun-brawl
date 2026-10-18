import Phaser from 'phaser';
import type { BattleEvent, MatchState, WeaponId } from '../game/core/types';
import { createWeaponIconCanvas, weaponIconKey } from './WeaponArt';

const ACCENT: Record<WeaponId, number> = {
  pistol: 0xaab4b7, smg: 0x4fc3b1, rifle: 0xf0a23a,
  shotgun: 0xe05a4f, sniper: 0xb48ce0, rocket: 0xf2c94c,
};

interface Burst { x: number; y: number; radius: number; age: number }

/**
 * T10 field layer for boxes and bombs. It lives outside ArenaRenderer so the
 * parallel map session can keep owning terrain rendering.
 */
export class FieldLayer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly icons = new Map<number, Phaser.GameObjects.Image>();
  private readonly ownedTextures = new Set<string>();
  private bursts: Burst[] = [];
  private clock = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(4.1);
  }

  handle(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'explosion') this.bursts.push({ x: event.position.x, y: event.position.y, radius: event.radius, age: 0 });
    }
  }

  draw(state: Readonly<MatchState> | null, alpha: number, dt: number): void {
    this.clock += dt;
    this.graphics.clear();
    if (!state) {
      for (const icon of this.icons.values()) icon.setVisible(false);
      this.bursts = [];
      return;
    }
    const interpolate = state.phase === 'playing';
    const visibleIcons = new Set<number>();
    for (const drop of state.drops) {
      const accent = ACCENT[drop.weaponId];
      const x = drop.position.x;
      if (drop.state === 'incoming') {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 10);
        this.graphics.lineStyle(2, accent, 0.35 + pulse * 0.4);
        this.graphics.lineBetween(x, drop.position.y - 78, x, drop.position.y - 8);
        this.graphics.lineStyle(2, accent, 0.8);
        this.graphics.strokeCircle(x, drop.position.y - 8, 12 + pulse * 5);
        this.graphics.fillStyle(accent, 0.22 + pulse * 0.18);
        this.graphics.fillCircle(x, drop.position.y - 8, 8);
        continue;
      }

      visibleIcons.add(drop.id);
      const bob = Math.sin(this.clock * 3 + drop.id) * 1.8;
      const y = drop.position.y - 20 + bob;
      const alphaBox = drop.warning ? 0.55 + 0.45 * Math.sin(this.clock * 14) : 1;
      this.graphics.fillStyle(0x101a21, 0.92 * alphaBox);
      this.graphics.lineStyle(3, accent, alphaBox);
      this.graphics.fillRoundedRect(x - 25, y - 18, 50, 36, 6);
      this.graphics.strokeRoundedRect(x - 25, y - 18, 50, 36, 6);
      this.graphics.fillStyle(accent, 0.26 * alphaBox);
      this.graphics.fillRoundedRect(x - 21, y - 14, 42, 9, 3);
      this.graphics.fillStyle(0xe8eef2, 0.1 * alphaBox);
      this.graphics.fillCircle(x, y + 2, 15);
      this.graphics.lineStyle(1, 0xe8eef2, 0.5 * alphaBox);
      this.graphics.lineBetween(x - 21, y + 13, x + 21, y + 13);
      for (const side of [-1, 1]) {
        this.graphics.fillStyle(accent, 0.9 * alphaBox);
        this.graphics.fillCircle(x + side * 19, y - 12, 1.8);
        this.graphics.fillCircle(x + side * 19, y + 12, 1.8);
      }

      let icon = this.icons.get(drop.id);
      if (!icon) {
        icon = this.scene.add.image(x, y, this.ensureTexture(drop.weaponId)).setDepth(4.2).setScale(0.32);
        this.icons.set(drop.id, icon);
      }
      icon.setTexture(this.ensureTexture(drop.weaponId)).setPosition(x, y + 2).setAlpha(alphaBox).setVisible(true);
    }
    for (const [id, icon] of this.icons) if (!visibleIcons.has(id)) icon.setVisible(false);

    for (const bomb of state.bombs) {
      const x = interpolate ? Phaser.Math.Linear(bomb.previous.x, bomb.position.x, alpha) : bomb.position.x;
      const y = interpolate ? Phaser.Math.Linear(bomb.previous.y, bomb.position.y, alpha) : bomb.position.y;
      const urgent = bomb.fuseRemaining < 0.75;
      const blink = urgent ? 0.55 + 0.45 * Math.sin(this.clock * 24) : 1;
      this.graphics.fillStyle(0x000000, 0.25);
      this.graphics.fillEllipse(x, y + 12, 22, 6);
      this.graphics.fillStyle(0x26333a, 1);
      this.graphics.lineStyle(2, urgent ? 0xe05a4f : 0xf2c94c, blink);
      this.graphics.fillCircle(x, y, 11);
      this.graphics.strokeCircle(x, y, 11);
      this.graphics.fillStyle(0x6b7a80, 0.85);
      this.graphics.fillCircle(x - 3, y - 4, 3);
      this.graphics.lineStyle(1, 0xf2c94c, 0.8);
      this.graphics.lineBetween(x - 7, y + 2, x + 7, y + 2);
      this.graphics.lineStyle(2, 0xd8c28a, 0.9);
      this.graphics.beginPath();
      this.graphics.moveTo(x + 3, y - 10);
      this.graphics.lineTo(x + 9, y - 16);
      this.graphics.lineTo(x + 5, y - 20);
      this.graphics.strokePath();
      this.graphics.fillStyle(urgent ? 0xffd166 : 0xe05a4f, blink);
      this.graphics.fillCircle(x + 5, y - 20, urgent ? 3.2 : 2.2);
    }

    for (const burst of this.bursts) {
      burst.age += dt;
      const t = Math.min(1, burst.age / 0.36);
      const radius = burst.radius * (0.35 + 0.65 * t);
      this.graphics.lineStyle(4 * (1 - t) + 1, 0xffd166, 0.85 * (1 - t));
      this.graphics.strokeCircle(burst.x, burst.y, radius);
      this.graphics.fillStyle(0xf2c94c, 0.14 * (1 - t));
      this.graphics.fillCircle(burst.x, burst.y, radius * 0.8);
    }
    this.bursts = this.bursts.filter((burst) => burst.age < 0.36);
  }

  reset(): void {
    this.graphics.clear();
    for (const icon of this.icons.values()) icon.setVisible(false);
    this.bursts = [];
    this.clock = 0;
  }

  destroy(): void {
    this.graphics.destroy();
    for (const icon of this.icons.values()) icon.destroy();
    this.icons.clear();
    for (const key of this.ownedTextures) if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    this.ownedTextures.clear();
  }

  private ensureTexture(id: WeaponId): string {
    const key = weaponIconKey(id);
    if (!this.scene.textures.exists(key)) {
      this.scene.textures.addCanvas(key, createWeaponIconCanvas(id));
      this.ownedTextures.add(key);
    }
    return key;
  }
}

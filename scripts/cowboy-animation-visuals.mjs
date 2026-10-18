import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const baseline = process.argv.includes('--baseline');
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1020 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/cowboy-animation-study', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><canvas width="1600" height="1020"></canvas><style>body{margin:0;background:#17242c}canvas{display:block}</style>' }));
  await page.goto(`${baseURL}/cowboy-animation-study`);
  await page.evaluate(async (before) => {
    const { sampleHumanoid } = await import('/src/presentation/characters/HumanoidRig.ts');
    const { paintHumanoid } = await import('/src/presentation/characters/HumanoidArt.ts');
    const { presetAppearance } = await import('/src/content/appearances.ts');
    const { createWeaponArtCanvas, WEAPON_ART, weaponDisplayScale } = await import('/src/presentation/WeaponArt.ts');
    const ctx = document.querySelector('canvas').getContext('2d');
    const look = presetAppearance('cowboy');
    const input = { outfit: 'cowboy', time: 0, cycle: 0, run: 0, airborne: false, falling: false, doubleJump: false, landing: 0, hurt: 0, reload: 0, recoil: 0, weaponId: 'pistol' };
    const cases = [
      ['自然站姿', {}], ['跑动 · 落脚', { run: 1, cycle: 0 }], ['跑动 · 下压', { run: 1, cycle: 0.125 }], ['跑动 · 通过', { run: 1, cycle: 0.25 }], ['跑动 · 抬腿', { run: 1, cycle: 0.375 }],
      ['长枪站姿', { weaponId: 'awm' }], ['长枪跑动', { weaponId: 'awm', run: 1, cycle: 0.65 }], ['反向持枪', { weaponId: 'awm', facing: -1 }], ['起跳', { airborne: true }], ['二段跳', { airborne: true, doubleJump: true }],
      ['下落', { airborne: true, falling: true }], ['落地缓冲', { landing: 1 }], ['换弹 · 伸手', { weaponId: 'm416', reload: 0.3 }], ['换弹 · 回收', { weaponId: 'm416', reload: 0.7 }], ['受击与持枪', { weaponId: 'awm', hurt: 1 }],
    ];
    ctx.fillStyle = '#17242c'; ctx.fillRect(0, 0, 1600, 1020);
    ctx.fillStyle = '#f0ead8'; ctx.font = 'bold 24px Microsoft YaHei'; ctx.fillText(`COWBOY / ${before ? '改动前' : '免费动画样板'} · 关节、步态与持枪`, 30, 42);
    const art = new Map();
    const draw = (pose, options, x, y, scale) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(scale * (options.facing ?? 1), scale);
      const id = options.weaponId ?? 'pistol';
      if (!art.has(id)) art.set(id, createWeaponArtCanvas(id));
      // The same slot order and weighted skin as the game, including the actual gun.
      for (const part of pose.parts) {
        if (part.part === 'previewGun') {
          const s = weaponDisplayScale(id), gun = art.get(id);
          ctx.save(); ctx.translate(pose.weapon.x, pose.weapon.y); ctx.rotate(pose.weapon.rotation);
          ctx.drawImage(gun, -WEAPON_ART.gripX * 3 * s, -WEAPON_ART.gripY * 3 * s, gun.width * s, gun.height * s); ctx.restore();
        } else paintHumanoid(ctx, look, { ...pose, parts: [part] }, false);
      }
      ctx.restore();
    };
    cases.forEach(([label, options], index) => {
      const x = index % 5 * 320, y = 68 + Math.floor(index / 5) * 310;
      ctx.fillStyle = '#293b44'; ctx.fillRect(x + 10, y, 300, 292);
      ctx.fillStyle = '#c7d5cf'; ctx.font = '14px Microsoft YaHei'; ctx.fillText(label, x + 24, y + 25);
      ctx.strokeStyle = '#718578'; ctx.beginPath(); ctx.moveTo(x + 22, y + 265); ctx.lineTo(x + 296, y + 265); ctx.stroke();
      const pose = sampleHumanoid({ ...input, ...options });
      draw(pose, options, x + (options.facing === -1 ? 210 : 115), y + 264, 2.45);
      draw(pose, options, x + 255, y + 263, 1);
    });
  }, baseline);
  assert.deepEqual(errors, []);
  const path = `artifacts/cowboy-animation-${baseline ? 'before' : 'after'}.png`;
  await page.screenshot({ path });
  console.log(`Cowboy animation contact sheet: ${path}; 15 poses and game-scale comparisons.`);
} finally { await browser.close(); }

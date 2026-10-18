import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1300, height: 1260 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/character-anatomy-study', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#19232b}canvas{display:block}</style><canvas width="1300" height="1260"></canvas>' }));
  await page.goto(`${baseURL}/character-anatomy-study`);
  await page.evaluate(async () => {
    const { sampleCowboy } = await import('/src/presentation/characters/CowboyRig.ts');
    const { paintCowboy } = await import('/src/presentation/characters/CowboyArt.ts');
    const { presetAppearance } = await import('/src/content/appearances.ts');
    const { createWeaponArtCanvas, WEAPON_ART, weaponDisplayScale } = await import('/src/presentation/WeaponArt.ts');
    const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
    const look = presetAppearance('cowboy');
    const normal = { time: 0, cycle: 0, run: 0, airborne: false, falling: false, doubleJump: false, landing: 0, hurt: 0, reload: 0, recoil: 0, weaponId: 'pistol' };
    const cases = [
      ['自然站姿', {}], ['跑动 1', { run: 1, cycle: 0 }], ['跑动 2', { run: 1, cycle: 0.25 }], ['跑动 3', { run: 1, cycle: 0.5 }], ['跑动 4', { run: 1, cycle: 0.75 }],
      ['持长枪', { weaponId: 'awm' }], ['长枪跑动 1', { weaponId: 'awm', run: 1, cycle: 0.1 }], ['长枪跑动 2', { weaponId: 'awm', run: 1, cycle: 0.6 }], ['向左持枪', { weaponId: 'awm', facing: -1 }], ['火箭筒', { weaponId: 'rpg7' }],
      ['起跳', { airborne: true }], ['下落', { airborne: true, falling: true }], ['二段跳', { airborne: true, doubleJump: true }], ['落地缓冲', { landing: 1 }], ['受击', { hurt: 1 }],
      ['换弹 25%', { weaponId: 'awm', reload: 0.25 }], ['换弹 50%', { weaponId: 'awm', reload: 0.5 }], ['换弹 75%', { weaponId: 'awm', reload: 0.75 }], ['无帽检查', { hat: 'none' }], ['实战尺寸', { small: true }],
    ];
    ctx.fillStyle = '#19232b'; ctx.fillRect(0, 0, 1300, 1260);
    ctx.fillStyle = '#e3e8dd'; ctx.font = 'bold 21px Microsoft YaHei'; ctx.fillText('CHARACTER / 姿态与人体比例检查', 26, 37);
    for (let index = 0; index < cases.length; index++) {
      const [label, overrides] = cases[index], x = index % 5 * 260, y = 64 + Math.floor(index / 5) * 298;
      ctx.fillStyle = '#27343d'; ctx.fillRect(x + 8, y + 6, 244, 280);
      ctx.fillStyle = '#c4d3c8'; ctx.font = '13px Microsoft YaHei'; ctx.fillText(label, x + 22, y + 29);
      ctx.strokeStyle = '#627668'; ctx.beginPath(); ctx.moveTo(x + 20, y + 265); ctx.lineTo(x + 240, y + 265); ctx.stroke();
      const pose = sampleCowboy({ ...normal, ...overrides });
      const scale = overrides.small ? 1 : 2.35, facing = overrides.facing ?? 1;
      ctx.save(); ctx.translate(x + (facing < 0 ? 165 : 96), y + 264); ctx.scale(scale * facing, scale);
      const art = createWeaponArtCanvas(overrides.weaponId ?? 'pistol'), weaponScale = weaponDisplayScale(overrides.weaponId ?? 'pistol');
      // Draw the same depth order as the scene, with its actual held weapon texture.
      for (const part of pose.parts) {
        if (part.part === 'previewGun') {
          ctx.save(); ctx.translate(pose.weapon.x, pose.weapon.y); ctx.rotate(pose.weapon.rotation);
          ctx.drawImage(art, -WEAPON_ART.gripX * 3 * weaponScale, -WEAPON_ART.gripY * 3 * weaponScale, art.width * weaponScale, art.height * weaponScale); ctx.restore();
        } else paintCowboy(ctx, { ...look, ...(overrides.hat ? { hat: overrides.hat } : {}) }, { ...pose, parts: [part] }, false);
      }
      ctx.restore();
    }
  });
  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'artifacts/character-anatomy.png' });
  console.log('Character anatomy contact sheet: artifacts/character-anatomy.png (20 standing/running/weapon/jump/reload views).');
} finally { await browser.close(); }

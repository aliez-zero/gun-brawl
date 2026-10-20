import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5199';
const out = process.env.WEAPON_VISUAL_OUT ?? 'artifacts/weapons-in-hand.png';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1680, height: 1180 }, deviceScaleFactor: 1 });
  await page.route('**/weapon-visual-check', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' }));
  await page.goto(`${baseURL}/weapon-visual-check`);
  const info = await page.evaluate(async () => {
    const { createWeaponArtCanvas, WEAPON_ART, weaponDisplayScale } = await import('/src/presentation/WeaponArt.ts');
    const { ARMORY_WEAPONS, getWeapon, weaponBurstImpulse, weaponSustainedImpulse } = await import('/src/content/weapons.ts');
    const roster = [...ARMORY_WEAPONS, getWeapon('gatling'), getWeapon('cannon')];
    const body = document.body;
    body.style.cssText = 'margin:0;background:#1b2730;color:#e8ecdf;font:13px "Microsoft YaHei",sans-serif';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:10px;padding:16px';
    body.append(grid);
    const sizes = [];
    for (const weapon of roster) {
      const card = document.createElement('div');
      card.style.cssText = 'background:#243038;border:1px solid #3b4a54;padding:8px';
      // Game-scale strip on a map-like backdrop, then a 3x zoom of the same art.
      const live = document.createElement('canvas');
      live.width = 300; live.height = 58;
      const lc = live.getContext('2d');
      const grad = lc.createLinearGradient(0, 0, 0, 58);
      grad.addColorStop(0, '#3c4a5c'); grad.addColorStop(1, '#232b38');
      lc.fillStyle = grad; lc.fillRect(0, 0, 300, 58);
      const art = createWeaponArtCanvas(weapon.id);
      const scale = weaponDisplayScale(weapon.id);
      lc.imageSmoothingQuality = 'high';
      lc.drawImage(art, 16, (58 - art.height * scale) / 2, art.width * scale, art.height * scale);
      const zoom = document.createElement('canvas');
      zoom.width = 300; zoom.height = 96;
      const zc = zoom.getContext('2d');
      zc.fillStyle = '#1a232b'; zc.fillRect(0, 0, 300, 96);
      const zs = 96 / art.height;
      zc.imageSmoothingQuality = 'high';
      zc.drawImage(art, 4, 0, art.width * zs, 96);
      const title = document.createElement('div');
      title.textContent = `${weapon.name} · ${weapon.id}`;
      title.style.cssText = 'font-size:13px;margin:2px 0 4px';
      const stats = document.createElement('div');
      stats.textContent = `单发 ${Math.round(weaponBurstImpulse(weapon))} · 持续 ${weaponSustainedImpulse(weapon)}/s · 手内 ${(art.width * scale).toFixed(0)}×${(art.height * scale).toFixed(0)}px`;
      stats.style.cssText = 'font-size:10px;color:#9fb3b8;margin-top:3px';
      card.append(title, live, zoom, stats);
      grid.append(card);
      sizes.push({ id: weapon.id, width: Number((art.width * scale).toFixed(1)), height: Number((art.height * scale).toFixed(1)) });
    }
    return { sizes, art: { width: WEAPON_ART.width, height: WEAPON_ART.height } };
  });
  await page.screenshot({ path: out, fullPage: true });
  console.log(`weapon visuals -> ${out} (${info.sizes.length} models, art grid ${info.art.width}x${info.art.height})`);
  console.log(info.sizes.map((s) => `${s.id.padEnd(9)} ${s.width}x${s.height}`).join('\n'));
} finally { await browser.close(); }

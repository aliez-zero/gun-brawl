import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 2 });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入战场' }).waitFor({ state: 'visible' });
  await page.locator('[data-mode="training"]').click();
  await page.getByRole('button', { name: '进入战场' }).click();
  // Software WebGL can take a while to boot; poll instead of a hard locator wait.
  for (let attempt = 0; attempt < 60; attempt++) {
    if (!(await page.locator('.countdown').isVisible().catch(() => false))) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);
  // First-visit tutorial card sits over the player in the lower-left corner.
  const dismiss = page.getByRole('button', { name: '知道了' });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(260);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(500);
  const canvas = page.locator('#game-canvas canvas');
  const box = await canvas.boundingBox();
  for (const slot of ['1', '2', '3', '4', '5', '6', '7', '8']) {
    await page.keyboard.press(slot);
    await page.waitForTimeout(450);
    await canvas.screenshot({ path: `artifacts/weapon-slot-${slot}.png` });
    // Tight crop around the spawn point so the held silhouette can be judged.
    if (box) {
      await page.screenshot({
        path: `artifacts/weapon-held-${slot}.png`,
        clip: { x: box.x + 300, y: box.y + 500, width: 380, height: 200 },
      });
    }
  }
  await page.screenshot({ path: 'artifacts/weapon-in-game.png', fullPage: true });
  // Muzzle alignment: the tracer must leave the drawn barrel, not the chest.
  await page.keyboard.press('3');
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyJ');
  await page.waitForTimeout(130);
  await page.keyboard.up('KeyJ');
  await page.waitForTimeout(60);
  await canvas.screenshot({ path: 'artifacts/weapon-firing-rifle.png' });
  console.log('weapon in-game shots written: artifacts/weapon-slot-1..8.png, artifacts/weapon-in-game.png');
} finally { await browser.close(); }

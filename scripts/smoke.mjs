import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const systemBrowsers = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
const executablePath = systemBrowsers.find((candidate) => existsSync(candidate));
const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const errors = [];
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入战场' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '进入战场' }).isEnabled(), true);
  assert.equal(await page.locator('canvas').count(), 1);
  assert.match(await page.locator('#control-guide').textContent(), /W \/ 空格/);
  assert.match(await page.locator('#control-guide').textContent(), /J.*开火/);
  await page.getByRole('button', { name: '操作说明' }).click();
  assert.match(await page.getByRole('dialog').textContent(), /W \/ 空格/);
  assert.match(await page.getByRole('dialog').textContent(), /Enter \/ 小键盘 0/);
  await page.getByRole('button', { name: '明白了' }).click();
  await page.screenshot({ path: 'artifacts/menu.png', fullPage: true });

  await page.locator('[data-mode="training"]').click();
  await page.getByRole('button', { name: '进入战场' }).click();
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12_000 });
  assert.equal(await page.locator('#round-time').textContent(), '∞');
  await page.waitForTimeout(1700);
  const before = await page.locator('canvas').screenshot();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(200);
  const after = await page.locator('canvas').screenshot();
  assert.equal(before.equals(after), false, 'Keyboard input must change the rendered battle');
  await page.keyboard.press('Space');
  await page.keyboard.down('KeyJ');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyJ');
  await page.screenshot({ path: 'artifacts/battle.png', fullPage: true });

  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').textContent(), /喘口气/);
  await page.getByRole('button', { name: '设置', exact: true }).last().click();
  await page.locator('#volume').evaluate((input) => { input.value = '68'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#reduced-motion').check();
  await page.keyboard.press('Escape');
  assert.match(await page.getByRole('dialog').textContent(), /喘口气/);
  await page.getByRole('button', { name: '继续对战' }).click();
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').textContent(), /喘口气/);
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();

  await page.locator('[data-mode="local-duel"]').click();
  await page.getByRole('button', { name: '进入战场' }).click();
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12_000 });
  assert.equal(await page.locator('#actor-status-p2').count(), 1);
  assert.match(await page.locator('#control-guide').textContent(), /P1.*J.*P2.*Enter/);
  await page.screenshot({ path: 'artifacts/local-duel.png', fullPage: true });
  await page.keyboard.down('KeyD');
  await page.keyboard.down('KeyJ');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('Enter');
  await page.waitForTimeout(250);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyJ');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Enter');
  await page.keyboard.down('Numpad0');
  await page.waitForTimeout(300);
  await page.keyboard.up('Numpad0');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  assert.equal(await page.locator('canvas').count(), 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入战场' }).waitFor();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.locator('#volume').inputValue(), '68');
  assert.equal(await page.locator('#reduced-motion').isChecked(), true);

  const isolated = await browser.newContext({ viewport: { width: 1280, height: 960 } });
  await isolated.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  const blockedPage = await isolated.newPage();
  blockedPage.on('pageerror', (error) => errors.push(error.message));
  await blockedPage.goto(baseURL, { waitUntil: 'networkidle' });
  await blockedPage.getByRole('button', { name: '进入战场' }).waitFor();
  assert.equal(await blockedPage.getByRole('button', { name: '进入战场' }).isEnabled(), true);
  await blockedPage.locator('.toast').waitFor({ state: 'visible' });
  assert.match(await blockedPage.locator('.toast').textContent(), /本地保存不可用/);
  await isolated.close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Browser smoke passed: menu, canvas, keyboard, training, pause/resume, blur, settings, dual-player, restart, persistence, blocked storage.');
  console.log('Screenshots: artifacts/menu.png, artifacts/battle.png');
} finally {
  await browser.close();
}

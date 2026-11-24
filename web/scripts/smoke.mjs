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
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const errors = [];
const latencyReading = /^延迟 \d+ ms · 抖动 \d+ ms$/;
const waitForLatency = (page) => page.locator('#net-status').filter({ hasText: latencyReading }).waitFor({ timeout: 10_000 });
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  let privateStarts = 0;
  let matchEnds = 0;
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname !== '/ws') return;
    socket.on('framereceived', ({ payload }) => {
      if (Buffer.isBuffer(payload) && payload[0] === 3) matchEnds++;
    });
    socket.on('framesent', ({ payload }) => {
      if (Buffer.isBuffer(payload) && payload[0] === 10) privateStarts++;
    });
  });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入战场' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '进入战场' }).isEnabled(), true);
  assert.equal(await page.locator('#game-canvas canvas').count(), 1);
  assert.match(await page.locator('#control-guide').textContent(), /W \/ 空格/);
  assert.match(await page.locator('#control-guide').textContent(), /J.*开火/);
  await page.getByRole('button', { name: '操作说明' }).click();
  assert.match(await page.getByRole('dialog').textContent(), /W \/ 空格/);
  assert.match(await page.getByRole('dialog').textContent(), /Enter \/ 小键盘 0/);
  await page.getByRole('button', { name: '明白了' }).click();
  await page.screenshot({ path: 'artifacts/menu.png', fullPage: true });

  await page.locator('[data-mode="training"]').click();
  await page.getByRole('button', { name: '进入战场' }).click();
  await page.locator('#round-time').waitFor();
  await waitForLatency(page);
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12_000 });
  assert.equal(await page.locator('#round-time').textContent(), '∞');
  await page.waitForTimeout(1700);
  const before = await page.locator('#game-canvas canvas').screenshot();
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyD');
  await page.waitForTimeout(200);
  const after = await page.locator('#game-canvas canvas').screenshot();
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
  assert.match(await page.locator('#net-status').textContent(), latencyReading);
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12_000 });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').textContent(), /喘口气/);
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();

  await page.locator('[data-mode="local-duel"]').click();
  await page.getByRole('button', { name: '进入战场' }).click();
  await page.locator('#round-time').waitFor();
  await waitForLatency(page);
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
  await page.locator('#round-time').waitFor();
  assert.equal(await page.locator('#game-canvas canvas').count(), 1);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  for (const mode of ['duel-ai', 'campaign', 'custom']) {
    await page.locator('[data-mode="' + mode + '"]').click();
    await page.locator('[data-action="start"]').click();
    if (mode === 'campaign') await page.locator('[data-level="level-1"]').click();
    if (mode === 'custom') {
      await page.locator('[data-custom-slot="1"]').selectOption('human');
      await page.locator('[data-custom-slot="2"]').selectOption('bot');
      await page.locator('[data-custom-slot="3"]').selectOption('bot');
      await page.locator('[data-action="start-custom"]').click();
    }
    await page.locator('#round-time').waitFor();
    assert.equal(await page.locator('.actor-card').count(), mode === 'custom' ? 4 : 2);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  }
  // Finish an actual one-stock round with P2's keyboard, then verify its result survives a reload.
  const readSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('gun-brawl:save:v1')));
  const beforeRound = await readSave();
  const endsBeforeRound = matchEnds;
  await page.locator('[data-mode="custom"]').click();
  await page.locator('[data-action="start"]').click();
  await page.locator('#custom-map').selectOption('training-deck');
  await page.locator('#custom-stocks').fill('1');
  await page.locator('#custom-drop').selectOption('none');
  await page.locator('[data-custom-slot="1"]').selectOption('human');
  await page.locator('[data-custom-slot="2"]').selectOption('empty');
  await page.locator('[data-custom-slot="3"]').selectOption('empty');
  await page.locator('[data-action="start-custom"]').click();
  await page.locator('#card-p2').waitFor();
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12000 });
  await page.keyboard.down('ArrowRight');
  try { await page.locator('.result-table').waitFor({ timeout: 12000 }); }
  finally { await page.keyboard.up('ArrowRight'); }
  assert.equal(matchEnds, endsBeforeRound + 1);
  assert.equal(await page.locator('.winner-row strong').textContent(), '玩家 1');
  const playerTwo = page.locator('.result-row').filter({ hasText: '玩家 2' });
  assert.deepEqual(await playerTwo.locator('span').allTextContents(), ['0', '0', '1']);
  const afterRound = await readSave();
  assert.equal(afterRound.stats.completed, beforeRound.stats.completed + 1);
  assert.equal(afterRound.stats.p1Wins, beforeRound.stats.p1Wins + 1);
  assert.equal(afterRound.stats.p2Wins, beforeRound.stats.p2Wins);
  assert.equal(afterRound.recentResults[0], afterRound.lastResultId);
  assert.ok(afterRound.lastResultId && afterRound.lastResultId !== beforeRound.lastResultId);
  assert.equal(privateStarts, 7, 'every game and the rematch must start a private server match');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-action="start"]:not([disabled])').waitFor();
  const reloadedSave = await readSave();
  assert.deepEqual(reloadedSave.stats, afterRound.stats);
  assert.deepEqual(reloadedSave.recentResults, afterRound.recentResults);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.locator('#volume').inputValue(), '68');
  assert.equal(await page.locator('#reduced-motion').isChecked(), true);
  await page.close();

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

  const disconnected = await browser.newPage();
  disconnected.on('pageerror', (error) => errors.push(error.message));
  let activeSocket;
  let serverSocket;
  let rejectStart = false;
  await disconnected.routeWebSocket('**/ws', (route) => {
    if (rejectStart) { route.close({ code: 1000, reason: 'unavailable' }); return; }
    activeSocket = route;
    serverSocket = route.connectToServer();
  });
  await disconnected.goto(baseURL, { waitUntil: 'networkidle' });
  await disconnected.locator('[data-mode="duel-ai"]').click();
  await disconnected.locator('[data-action="start"]').click();
  await disconnected.locator('#round-time').waitFor();
  activeSocket.close();
  serverSocket.close();
  await disconnected.locator('[data-action="start"]:not([disabled])').waitFor();
  await disconnected.locator('.toast').filter({ hasText: /服务器|连接/ }).waitFor();
  rejectStart = true;
  await disconnected.locator('[data-action="start"]').click();
  await disconnected.locator('[data-action="start"]:not([disabled])').waitFor();
  assert.equal(await disconnected.locator('#round-time').count(), 0);
  await disconnected.close();
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log('Browser smoke passed: menu, canvas, all five server modes, two keyboard players, one-stock settlement and win history, pause/resume, restart, connection loss, failed start and persistence.');
  console.log('Screenshots: artifacts/menu.png, artifacts/battle.png');
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// All action/session requests are intercepted: this check never calls a paid model.
const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => p && existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
let debugPage;
const requests = [];
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
  debugPage = page;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('gun-brawl:save:v1', JSON.stringify({ version: 2, selectedMapId: 'training-deck', lastMode: 'duel-ai' })));
  const health = await (await page.request.get(baseURL + '/api/deepseek/status')).json();
  assert.equal(typeof health.configured, 'boolean');
  assert.ok(health.contextTokens >= 4096 && health.contextTokens <= 512000);
  assert.equal(Object.hasOwn(health, 'apiKey'), false);
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('[data-action="deepseek"]').waitFor();
  await page.locator('[data-action="deepseek"]').click();
  if (!health.configured) {
    await page.getByText('尚未配置 DeepSeek 密钥', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-action="start-deepseek"]').isEnabled(), false);
    await page.screenshot({ path: 'artifacts/deepseek-unconfigured.png', fullPage: true });
  }
  await page.getByRole('dialog').getByRole('button', { name: '返回', exact: true }).click();

  let sessions = 0, closed = 0, mode = 'normal';
  await page.route('**/api/deepseek/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (json, status = 200) => route.fulfill({ status, json }).catch(() => {});
    const info = { configured: true, model: 'deepseek-flash', maxRequests: 180, requestIntervalMs: 500, timeoutMs: 5000, contextTokens: 512000 };
    if (path.endsWith('/status')) { await reply(info); return; }
    const body = route.request().postDataJSON();
    if (path.endsWith('/session')) {
      if (body.close) { closed++; await reply({ closed: true }); }
      else { sessions++; await reply({ ...info, sessionId: `mock-session-${sessions}` }); }
      return;
    }
    requests.push(body);
    const currentMode = mode;
    if (currentMode === 'delayed') await new Promise((resolve) => setTimeout(resolve, 800));
    if (currentMode === 'budget') { await reply({ error: 'BUDGET', message: '本局 AI 请求预算已用完' }, 429); return; }
    await reply({
      sequence: body.sequence, epoch: body.epoch, observationTick: body.observation.tick,
      action: { moveX: -1, jumpPressed: body.sequence === 1, dropPressed: false, shootHeld: true, bombPressed: body.sequence === 1, reloadPressed: false, holdFrames: 30 },
      usage: { requests: body.sequence, promptTokens: 120 * body.sequence, completionTokens: 40 * body.sequence },
    });
  });
  await page.locator('[data-action="deepseek"]').click();
  await page.getByText('DeepSeek 已配置', { exact: true }).waitFor();
  await page.getByText('单次请求上下文上限 512K token', { exact: true }).waitFor();
  await page.screenshot({ path: 'artifacts/deepseek-ready-mock.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-action="start-deepseek"]').scrollIntoViewIfNeeded();
  const startBounds = await page.locator('[data-action="start-deepseek"]').boundingBox();
  assert.ok(startBounds && startBounds.y >= 0 && startBounds.y + startBounds.height <= 800, 'DeepSeek setup start button should remain reachable at 1280x800');
  await page.screenshot({ path: 'artifacts/deepseek-ready-compact-mock.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.locator('[data-action="start-deepseek"]').click();
  await page.locator('#card-deepseek').waitFor();
  await page.waitForFunction(() => document.querySelector('#deepseek-status')?.textContent.includes('已接收 2 次操作'), null, { timeout: 12000 });
  assert.ok(requests.length >= 2);
  assert.equal(requests[0].observation.self.id, 'deepseek');
  assert.equal(Object.hasOwn(requests[0].observation, 'seed'), false);
  assert.ok(requests[1].observation.self.x < requests[0].observation.self.x, 'model input must move the real actor');
  await page.screenshot({ path: 'artifacts/deepseek-battle-mock.png', fullPage: true });

  mode = 'delayed';
  const beforePending = requests.length;
  await page.waitForFunction(() => document.querySelector('#deepseek-status')?.textContent.includes('正在决策'));
  // If the previous update was already thinking, wait for the next observed request.
  for (let i = 0; requests.length === beforePending && i < 60; i++) await page.waitForTimeout(50);
  const pausedCount = requests.length;
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor();
  await page.waitForTimeout(1000);
  assert.equal(requests.length, pausedCount, 'paused matches must not request decisions');
  mode = 'budget';
  await page.getByRole('button', { name: '继续对战' }).click();
  await page.waitForFunction(() => document.querySelector('#deepseek-status')?.textContent.includes('预算已用完'), null, { timeout: 12000 });
  const budgetCount = requests.length;
  await page.waitForTimeout(1300);
  assert.equal(requests.length, budgetCount, 'budget exhaustion must stop calls');

  mode = 'normal';
  const oldEpisode = requests[0].observation.episodeId;
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '重新开始', exact: true }).click();
  await page.locator('#card-deepseek').waitFor();
  await page.waitForFunction(() => document.querySelector('#deepseek-status')?.textContent.includes('已接收 1 次操作'), null, { timeout: 12000 });
  assert.equal(sessions, 2);
  assert.notEqual(requests.at(-1).observation.episodeId, oldEpisode);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(closed >= 2, 'restart and menu should close old sessions');
  assert.equal(await page.locator('#deepseek-status').isVisible(), false);
  const afterMenu = requests.length;
  await page.waitForTimeout(1100);
  assert.equal(requests.length, afterMenu);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: 'artifacts/deepseek-menu.png', fullPage: true });
  const entry = await page.locator('[data-action="deepseek"]').boundingBox();
  const arena = await page.locator('.arena-shell').boundingBox();
  assert.ok(entry && arena && entry.y >= arena.y && entry.y + entry.height <= arena.y + arena.height, 'entry should fit inside the arena menu');
  assert.deepEqual(errors, []);
  console.log('DeepSeek browser check passed (mock responses only): real gateway health, setup, model inputs move actor, pause/late response, budget stop, restart/new session, menu cleanup, 1280px menu.');
} catch (error) {
  if (debugPage) {
    console.error('DeepSeek mock browser diagnostics:', { requests: requests.length, errors, status: await debugPage.locator('#deepseek-status').textContent(), dialog: await debugPage.locator('[role="dialog"]').allTextContents() });
    await debugPage.screenshot({ path: 'artifacts/deepseek-failure.png', fullPage: true });
  }
  throw error;
} finally { await browser.close(); }

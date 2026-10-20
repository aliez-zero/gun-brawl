import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5177';
const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    const probe = { contexts: 0, sources: 0, decoded: 0 };
    (window).musicProbe = probe;
    const AudioContextClass = window.AudioContext;
    if (!AudioContextClass) return;
    const originalSource = AudioContextClass.prototype.createBufferSource;
    const originalDecode = AudioContextClass.prototype.decodeAudioData;
    AudioContextClass.prototype.createBufferSource = function (...args) {
      probe.sources++;
      return originalSource.apply(this, args);
    };
    AudioContextClass.prototype.decodeAudioData = function (...args) {
      probe.decoded++;
      return originalDecode.apply(this, args);
    };
    window.AudioContext = new Proxy(AudioContextClass, {
      construct(target, args) {
        probe.contexts++;
        return Reflect.construct(target, args);
      },
    });
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const audioRequests = [];
  page.on('response', (response) => { if (response.url().includes('/audio/')) audioRequests.push(response); });
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '进入战场' }).waitFor();
  assert.deepEqual(await page.evaluate(() => (window).musicProbe), { contexts: 0, sources: 0, decoded: 0 });

  await page.locator('.music-toggle').click();
  assert.equal(await page.locator('[role="dialog"]').count(), 0, 'music toggle must not open a dialog');
  assert.equal(await page.locator('.music-toggle').getAttribute('aria-pressed'), 'false');
  await page.locator('.music-toggle').click();
  assert.equal(await page.locator('.music-toggle').getAttribute('aria-pressed'), 'true');

  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('#music-status').waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#music-status').getAttribute('data-state'), 'playing');
  const probe = await page.evaluate(() => (window).musicProbe);
  assert.equal(probe.contexts, 1);
  assert.ok(probe.sources >= 1, 'a looping source should be created after the first gesture');
  assert.ok(probe.decoded >= 1, 'a local audio file should be decoded');
  assert.ok(audioRequests.some((response) => response.ok()), 'a local music asset should load');

  await page.locator('#music-enabled').uncheck();
  await page.waitForTimeout(80);
  assert.equal(await page.locator('#music-status').getAttribute('data-state'), 'muted');
  await page.locator('#music-enabled').check();
  await page.locator('#music-track').selectOption('space');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('#music-track').inputValue(), 'space');
  assert.equal(await page.locator('#music-status').getAttribute('data-track'), 'space');

  await page.locator('.dialog-panel button[data-action="close"]').click();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '设置', exact: true }).click();
  assert.equal(await page.locator('#music-track').inputValue(), 'space');
  assert.equal(await page.locator('#music-enabled').isChecked(), true);
  assert.deepEqual(errors, [], 'No uncaught browser errors');
  console.log(`Music smoke passed: gesture gate, local decode, looping source, mute, selection and persistence (${audioRequests.length} audio responses).`);
} finally {
  await browser.close();
}

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const executablePath = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);
const browser = await chromium.launch({ executablePath, headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const baseURL = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:5173';
const errors = [];
const save = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('gun-brawl:save:v1')));
const openAppearance = (page) => page.locator('.site-header [data-action="appearance"]').click();
const close = (page) => page.locator('[data-action="close"]').click();
try {
  await mkdir('artifacts', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await page.locator('[data-action="start"]:not([disabled])').waitFor();
  await openAppearance(page);
  assert.equal(await page.locator('.style-preset').count(), 5);
  assert.equal(await page.locator('.hat-chips button').count(), 6);
  assert.equal(await page.locator('[data-field="outfit"]').count(), 5);
  assert.equal(await page.locator('.studio-panel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true);
  await page.screenshot({ path: 'artifacts/appearance-studio.png', fullPage: true });
  const original = await page.locator('.character-preview').screenshot();
  await page.locator('[data-action="look-preset"][data-value="operative"]').click();
  await page.locator('[data-field="hat"][data-value="cowboy"]').click();
  await page.locator('[data-field="outfit"][data-value="ronin"]').click();
  await page.locator('[data-field="color"][data-value="9324125"]').click();
  await page.locator('[data-field="skin"][data-value="8738628"]').click();
  const p1 = (await save(page)).appearances['1'];
  assert.deepEqual(p1, { style: 'operative', hat: 'cowboy', outfit: 'ronin', color: 9324125, skin: 8738628 });
  assert.equal(original.equals(await page.locator('.character-preview').screenshot()), false);
  await page.locator('[data-action="appearance-slot"][data-slot="2"]').click();
  await page.locator('[data-action="look-preset"][data-value="knight"]').click();
  const p2 = (await save(page)).appearances['2'];
  assert.equal(p2.style, 'knight');
  assert.deepEqual((await save(page)).appearances['1'], p1);
  await close(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('[data-action="start"]:not([disabled])').waitFor();
  await openAppearance(page);
  assert.equal(await page.locator('[data-field="outfit"][data-value="ronin"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-field="hat"][data-value="cowboy"]').getAttribute('aria-pressed'), 'true');
  await close(page);
  await page.locator('[data-action="maps"]').click();
  assert.equal(await page.locator('.map-card').count(), 4);
  await page.screenshot({ path: 'artifacts/map-picker.png', fullPage: true });
  await close(page);

  // Every selected scene is used by a real running match, then reset through the menu.
  for (const [id, name, style] of [['sky-citadel', '云上古城', 'cowboy'], ['neon-city', '霓虹天际', 'operative'], ['alien-starship', '星际方舟', 'astronaut'], ['training-deck', '训练台', 'ronin']]) {
    await openAppearance(page);
    await page.locator(`[data-action="look-preset"][data-value="${style}"]`).click();
    await close(page);
    await page.locator('[data-action="maps"]').click();
    await page.locator(`[data-map="${id}"]`).click();
    assert.equal((await save(page)).selectedMapId, id);
    await close(page);
    await page.locator('[data-mode="local-duel"]').click();
    await page.locator('[data-action="start"]').click();
    await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12000 });
    assert.match(await page.locator('#match-status').textContent(), new RegExp(name));
    assert.match(await page.locator('#current-map-label').textContent(), new RegExp(name));
    assert.equal(await page.locator('canvas').count(), 1);
    await page.screenshot({ path: `artifacts/map-${id}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    if (id === 'alien-starship') {
      const frozen = await page.locator('#game-canvas canvas').screenshot({ style: '#game-overlay { visibility: hidden !important; }' });
      await page.getByRole('button', { name: '更换地图', exact: true }).click();
      assert.match(await page.locator('.saved-note').textContent(), /下局生效/);
      await page.locator('[data-map="neon-city"]').click();
      await close(page);
      assert.equal(frozen.equals(await page.locator('#game-canvas canvas').screenshot({ style: '#game-overlay { visibility: hidden !important; }' })), true, 'map changes during pause must not replace the current battlefield');
      await page.getByRole('button', { name: '角色外观', exact: true }).last().click();
      assert.match(await page.locator('.saved-note').textContent(), /下局生效/);
      await page.locator('[data-action="look-preset"][data-value="cowboy"]').click();
      await close(page);
      assert.equal(frozen.equals(await page.locator('#game-canvas canvas').screenshot({ style: '#game-overlay { visibility: hidden !important; }' })), true, 'appearance changes during pause must apply next round');
      await page.getByRole('button', { name: '重新开始', exact: true }).click();
      assert.match(await page.locator('#match-status').textContent(), /霓虹天际/);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '返回主菜单', exact: true }).click();
  }

  // Both editors remain operable on a compact desktop and a narrow viewport.
  for (const width of [1024, 720, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await openAppearance(page);
    await page.locator('[data-action="appearance-slot"][data-slot="2"]').click();
    await page.locator('[data-action="look-preset"][data-value="astronaut"]').click();
    assert.equal(await page.locator('.studio-panel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true, `studio horizontal overflow at ${width}`);
    if (width === 1024) await page.screenshot({ path: 'artifacts/appearance-compact.png', fullPage: true });
    if (width === 390) await page.screenshot({ path: 'artifacts/appearance-narrow.png', fullPage: true });
    await close(page);
    await page.locator('[data-action="maps"]').click();
    await page.locator('[data-map="alien-starship"]').click();
    assert.equal(await page.locator('.map-picker-panel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true);
    await close(page);
  }
  assert.deepEqual(errors, []);
  console.log('Appearance/maps passed: five styles, mixed clothes/colors/skin, independent P1/P2, saved reload, four running maps, next-round pause changes, restart, 1024/720/390px layouts.');
} finally { await browser.close(); }

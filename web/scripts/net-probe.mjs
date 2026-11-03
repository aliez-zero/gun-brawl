import { chromium } from 'playwright';

const base = 'https://chizaodeijin.icu/';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-proxy-server', '--start-maximized'],
});
const page = await browser.newPage({ viewport: null });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor({ timeout: 20000 });
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('NetProbe');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });
await page.waitForTimeout(1500);

const readStats = () => page.evaluate(() => window.__gunbrawlDebug?.netStats() ?? null);

const before = await readStats();
const t0 = Date.now();

// Play like a human: run both ways, jump regularly, hold fire.
const startedAt = Date.now();
let direction = 'KeyD';
await page.keyboard.down(direction);
await page.keyboard.down('KeyJ');
while (Date.now() - startedAt < 12000) {
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(400);
  await page.waitForTimeout(160);
}
await page.keyboard.up(direction);
await page.keyboard.up('KeyJ');

const after = await readStats();
const seconds = (Date.now() - t0) / 1000;
const delta = {};
for (const key of Object.keys(after)) {
  if (key === 'lastErrorPx' || key === 'gapAvgMs' || key === 'gapMaxMs') continue;
  delta[key] = after[key] - before[key];
}
const rates = Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, +(v / seconds).toFixed(1)]));

console.log('window:', seconds.toFixed(1), 's');
console.log('rates per second:', JSON.stringify(rates));
console.log('snapshot gap avg/max ms:', after.gapAvgMs, '/', after.gapMaxMs);
console.log('last prediction error px:', after.lastErrorPx);
console.log('errors:', errors.join(' | ') || 'none');
await browser.close();

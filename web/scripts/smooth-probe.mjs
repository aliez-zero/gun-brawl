import { chromium } from 'playwright';

const base = 'https://chizaodeijin.icu/';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-proxy-server', '--start-maximized'],
});
const page = await browser.newPage({ viewport: null });
await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor({ timeout: 20000 });
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('SmoothProbe');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });
await page.waitForTimeout(2000);

const stats = () => page.evaluate(() => window.__gunbrawlDebug.netStats());
const before = await stats();
const started = Date.now();

await page.keyboard.down('KeyD');
await page.keyboard.down('KeyJ');
for (let i = 0; i < 16; i++) {
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(300);
  // Quick second tap = double jump attempt.
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(300);
}
await page.keyboard.up('KeyJ');
await page.keyboard.up('KeyD');

const seconds = (Date.now() - started) / 1000;
const after = await stats();
const rate = (key) => +((after[key] - before[key]) / seconds).toFixed(1);

console.log('window', seconds.toFixed(1), 's');
console.log('server ticks/s :', rate('serverTicks'), '(this room; 60 nominal)');
console.log('client steps/s :', rate('steps'));
console.log('client frames/s:', rate('frames'));
console.log('snapshots/s    :', rate('snapshots'));
console.log('inputs/s       :', rate('inputFrames'));
console.log('reconciles/s   :', rate('reconciles'));
console.log('vel adopt/s    :', rate('velocityAdoptions'));
console.log('buffered edges :', after.bufferedEdges - before.bufferedEdges);
console.log('error max px   :', after.errorMaxPx);
console.log('gap avg/max ms :', after.gapAvgMs, '/', after.gapMaxMs);
await browser.close();

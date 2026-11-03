import { chromium } from 'playwright';

const base = 'https://chizaodeijin.icu/';
const metric = async (name) => {
  const text = await (await fetch(`${base}metrics`)).text();
  return Number(text.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1] ?? -1);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: false,
  args: ['--no-proxy-server', '--start-maximized'],
});
const page = await browser.newPage({ viewport: null });
await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor({ timeout: 20000 });
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('TickProbe');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });
await page.waitForTimeout(2500);

const stats = () => page.evaluate(() => window.__gunbrawlDebug.netStats());
const before = await stats();
const ticksBefore = await metric('gunbrawl_simulation_ticks_total');
const snapsBefore = await metric('gunbrawl_snapshots_sent_total');
const t0 = Date.now();

await page.keyboard.down('KeyD');
await page.keyboard.down('KeyJ');
for (let i = 0; i < 20; i++) {
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyJ');
await page.keyboard.up('KeyD');

const seconds = (Date.now() - t0) / 1000;
const after = await stats();
const ticksAfter = await metric('gunbrawl_simulation_ticks_total');
const snapsAfter = await metric('gunbrawl_snapshots_sent_total');

console.log('window', seconds.toFixed(1), 's');
console.log('server ticks/s :', ((ticksAfter - ticksBefore) / seconds).toFixed(1), '(60 = nominal)');
console.log('server snaps/s :', ((snapsAfter - snapsBefore) / seconds).toFixed(1), '(30 = nominal)');
console.log('client frames/s:', ((after.frames - before.frames) / seconds).toFixed(1));
console.log('client steps/s :', ((after.steps - before.steps) / seconds).toFixed(1), '(should match server ticks)');
console.log('client inputs/s:', ((after.inputFrames - before.inputFrames) / seconds).toFixed(1));
console.log('client snaps/s :', ((after.snapshots - before.snapshots) / seconds).toFixed(1));
console.log('reconciles/s   :', ((after.reconciles - before.reconciles) / seconds).toFixed(2));
console.log('vel adopt/s    :', ((after.velocityAdoptions - before.velocityAdoptions) / seconds).toFixed(2));
console.log('buffered edges :', after.bufferedEdges - before.bufferedEdges);
console.log('gap avg/max ms :', after.gapAvgMs, '/', after.gapMaxMs);
console.log('error px       :', after.lastErrorPx);
await browser.close();

import { chromium } from 'playwright';

const base = process.env.GAME_TEST_URL ?? 'http://124.220.135.89/';
const metric = async (name) => {
  const text = await (await fetch(`${base}metrics`)).text();
  return Number(text.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1] ?? -1);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor();
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('IdleFinish');
await page.locator('#online-stocks').selectOption('2');
// Shortest match so a passive player loses to the bot quickly.
await page.locator('#online-duration').selectOption('120');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
const code = (await page.locator('.online-code').textContent()).trim();
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });

const before = await metric('gunbrawl_matches_finished_total');
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });
console.log(`room ${code} started, waiting for the bot to end it…`);

let after = before;
for (let i = 0; i < 50; i++) {
  await sleep(6000);
  after = await metric('gunbrawl_matches_finished_total');
  if (after > before) break;
}
const settled = await metric('gunbrawl_matches_finished_total');
const ticksAtSettle = await metric('gunbrawl_simulation_ticks_total');
await sleep(15000);
const later = await metric('gunbrawl_matches_finished_total');
const ticksLater = await metric('gunbrawl_simulation_ticks_total');

console.log(`matches_finished_total: ${before} -> ${settled}`);
console.log(`15 s later: matches=${later} (delta ${later - settled}), ticks delta ${ticksLater - ticksAtSettle}`);
console.log(later === settled ? 'PASS: settled exactly once' : 'FAIL: counter kept climbing');
await browser.close();

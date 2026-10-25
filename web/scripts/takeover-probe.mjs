import { chromium } from 'playwright';

const base = process.env.GAME_TEST_URL ?? 'http://124.220.135.89/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const metric = async (name) => {
  const text = await (await fetch(`${base}metrics`)).text();
  return Number(text.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1] ?? -1);
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor();
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('Dropper');
await page.locator('#online-stocks').selectOption('2');
await page.locator('#online-duration').selectOption('180');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
const code = (await page.locator('.online-code').textContent()).trim();
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });

const before = await metric('gunbrawl_matches_finished_total');
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });
await sleep(3000);
await browser.close();
console.log(`room ${code}: browser killed right after kickoff, no human left`);

// With takeover the seat plays itself, so the 2-bot match must still reach a result.
for (let i = 1; i <= 12; i++) {
  await sleep(15000);
  const finished = await metric('gunbrawl_matches_finished_total');
  const rooms = await metric('gunbrawl_rooms_active');
  console.log(`+${i * 15}s matches=${finished} rooms=${rooms}`);
  if (finished > before) {
    console.log('PASS: the match finished with nobody connected');
    process.exit(0);
  }
}
console.log('FAIL: the match never finished after the disconnect');
process.exit(1);

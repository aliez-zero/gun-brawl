import { chromium } from 'playwright';

const base = process.env.GAME_TEST_URL ?? 'http://124.220.135.89/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[page error]', msg.text());
});

await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '进入战场' }).waitFor();
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('BotProbe');
await page.locator('#online-stocks').selectOption('3');
await page.locator('#online-duration').selectOption('180');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
const code = (await page.locator('.online-code').textContent()).trim();
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.locator('[data-action="online-start"]:enabled').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 20000 });

const started = Date.now();
console.log(`room ${code}: 3 stocks, one normal bot, player stands still`);

// Read the HUD stocks readout every few seconds; the bot has to land 3 ringouts.
for (let i = 0; i < 40; i++) {
  await sleep(5000);
  const elapsed = Math.round((Date.now() - started) / 1000);
  const body = await page.locator('body').innerText();
  const stocks = (body.match(/(\d+)\s*\/\s*3/g) ?? []).join(' ');
  const finished = /再来一局|对局结束/.test(body);
  console.log(`+${elapsed}s finished=${finished} stocks=${stocks || 'n/a'}`);
  if (finished) {
    const summary = body.split('\n').filter((line) => /胜|平局|击出|出界/.test(line)).slice(0, 6).join(' | ');
    console.log('result:', summary);
    break;
  }
}
await page.screenshot({ path: 'artifacts/bot-probe.png', fullPage: true });
await browser.close();

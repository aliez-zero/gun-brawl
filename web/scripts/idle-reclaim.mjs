import { chromium } from 'playwright';

const base = process.env.GAME_TEST_URL ?? 'http://124.220.135.89/';

async function metrics() {
  const text = await (await fetch(`${base}metrics`)).text();
  const n = (k) => Number(text.match(new RegExp(`^${k} (\\d+)$`, 'm'))?.[1] ?? -1);
  return { rooms: n('gunbrawl_rooms_active'), players: n('gunbrawl_players_connected') };
}

// Phase 1: create a room with a bot and start a match, then walk away.
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '杩涘叆鎴樺満' }).waitFor();
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('Abandon');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
const code = (await page.locator('.online-code').textContent()).trim();
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.waitForTimeout(300);
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 15000 });
await page.waitForTimeout(2000);
console.log(`[${new Date().toISOString()}] room ${code} running with a bot, metrics:`, await metrics());

await browser.close();
console.log(`[${new Date().toISOString()}] browser closed (player disconnected, slot held 60 s)`);

// Phase 2: wait for the reclaim. Grace 60 s + idle 300 s 鈮?6 min.
const started = Date.now();
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 30000));
  const m = await metrics();
  const elapsed = Math.round((Date.now() - started) / 1000);
  console.log(`[+${elapsed}s] rooms=${m.rooms} players=${m.players}`);
  if (m.rooms === 0) {
    console.log(`room ${code} reclaimed after ~${elapsed}s`);
    process.exit(0);
  }
}
console.log('room was NOT reclaimed within 10 minutes');
process.exit(1);

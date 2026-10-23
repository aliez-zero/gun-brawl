import { chromium } from 'playwright';

const base = process.env.GAME_TEST_URL ?? 'http://124.220.135.89/';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

let sent = 0;
let received = 0;
page.on('websocket', (ws) => {
  ws.on('framesent', () => { sent += 1; });
  ws.on('framereceived', () => { received += 1; });
});

await page.goto(base, { waitUntil: 'load' });
await page.getByRole('button', { name: '杩涘叆鎴樺満' }).waitFor();
await page.locator('[data-action="online"]').click();
await page.locator('#online-name').fill('RateTest');
await page.locator('[data-action="online-create"]').click();
await page.locator('.online-code').waitFor({ timeout: 15000 });
await page.locator('[data-action="online-bot"][data-slot="1"]').click();
await page.waitForTimeout(400);
await page.locator('[data-action="online-start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 15000 });

// Count traffic over a clean 3 s window while holding move + fire.
sent = 0;
received = 0;
await page.keyboard.down('KeyD');
await page.keyboard.down('KeyJ');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyJ');
await page.keyboard.up('KeyD');

console.log('client->server frames in 3 s :', sent, `(~${(sent / 3).toFixed(0)}/s)`);
console.log('server->client frames in 3 s :', received, `(~${(received / 3).toFixed(0)}/s)`);
await browser.close();

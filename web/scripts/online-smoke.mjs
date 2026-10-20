import { chromium } from 'playwright';

/**
 * Online smoke: two browser contexts create/join a room over the real Rust
 * server, start the match and receive snapshots.
 *
 * Run against a built server:
 *   GUNBRAWL_WEB_DIR=web/dist gunbrawl-server
 *   node scripts/online-smoke.mjs
 */
const url = process.env.GAME_TEST_URL ?? 'http://127.0.0.1:8080/';
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  else console.log('ok  ' + message);
};

try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  host.on('pageerror', (error) => failures.push('host pageerror: ' + error.message));
  guest.on('pageerror', (error) => failures.push('guest pageerror: ' + error.message));

  await host.goto(url, { waitUntil: 'networkidle' });
  await guest.goto(url, { waitUntil: 'networkidle' });

  // Host creates a room.
  await host.locator('[data-action="online"]').click();
  await host.locator('#online-name').fill('Host');
  await host.locator('[data-action="online-create"]').click();
  await host.locator('.online-code').waitFor({ timeout: 10000 });
  const code = (await host.locator('.online-code').textContent()).trim();
  check(/^[2-9A-HJKMNP-TV-Z]{6}$/.test(code), `room code issued: ${code}`);

  // Guest joins by code.
  await guest.locator('[data-action="online"]').click();
  await guest.locator('#online-name').fill('Guest');
  await guest.locator('#online-code').fill(code);
  await guest.locator('[data-action="online-join"]').click();
  await guest.locator('.online-slots li').nth(1).waitFor({ timeout: 10000 });
  check((await guest.locator('.online-slots li').count()) === 4, 'guest sees four slots');

  // Host sees the guest and can start.
  await host.locator('[data-action="online-start"]:not([disabled])').waitFor({ timeout: 10000 });
  check(true, 'host start enabled with two players');

  await host.locator('[data-action="online-start"]').click();

  // Both clients enter the match overlay and receive snapshots.
  await host.locator('.match-overlay').waitFor({ timeout: 10000 });
  await guest.locator('.match-overlay').waitFor({ timeout: 10000 });
  check(await host.locator('#card-p0').count() > 0, 'host HUD shows snapshot actors');
  check(await guest.locator('#card-p1').count() > 0, 'guest HUD shows own actor card');

  // Ping is measured and displayed.
  await host.waitForFunction(() => {
    const element = document.querySelector('#net-status');
    return Boolean(element && element.textContent && element.textContent.includes('PING'));
  }, { timeout: 12000 });
  const status = await host.locator('#net-status').textContent();
  check(Boolean(status && status.includes('PING')), `latency HUD: ${status}`);

  await host.screenshot({ path: 'artifacts/online-host.png', fullPage: true });
  await guest.screenshot({ path: 'artifacts/online-guest.png', fullPage: true });
} finally {
  await browser.close();
}

if (failures.length) {
  console.error('\nFAILED:\\n' + failures.join('\\n'));
  process.exit(1);
}
console.log('\nonline smoke passed');

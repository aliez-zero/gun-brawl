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
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-proxy-server'],
});

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  else console.log('ok  ' + message);
};

const latencyReading = /^延迟 \d+ ms · 抖动 \d+ ms$/;
const pongTag = 4;

function gameSocket(page) {
  return page.waitForEvent('websocket', {
    predicate: (socket) => new URL(socket.url()).pathname === '/ws',
    timeout: 10000,
  });
}

function waitForPong(socket) {
  return socket.waitForEvent('framereceived', {
    predicate: ({ payload }) => Buffer.isBuffer(payload) && payload[0] === pongTag,
    timeout: 10000,
  });
}

async function expectLatency(page, selector, label) {
  const status = page.locator(selector).filter({ hasText: latencyReading });
  await status.waitFor({ state: 'visible', timeout: 12000 });
  check(true, `${label}: ${await status.textContent()}`);
}

try {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  host.on('pageerror', (error) => failures.push('host pageerror: ' + error.message));
  guest.on('pageerror', (error) => failures.push('guest pageerror: ' + error.message));

  await host.goto(url, { waitUntil: 'networkidle' });
  await guest.goto(url, { waitUntil: 'networkidle' });
  await host.waitForFunction(() => document.body.dataset.predictor === 'ready', null, { timeout: 10000 });
  check(true, 'wasm predictor loaded');

  // Host creates a room.
  await host.locator('[data-action="online"]').click();
  await host.locator('#online-name').fill('Host');
  await host.locator('[data-action="online-create"]').click();
  await host.locator('.online-code').waitFor({ timeout: 10000 });
  const code = (await host.locator('.online-code').textContent()).trim();
  check(/^[2-9A-HJKMNP-TV-Z]{6}$/.test(code), `room code issued: ${code}`);
  await expectLatency(host, '#online-latency', 'host waiting room latency');

  // Guest joins by code.
  const [guestSocket] = await Promise.all([
    gameSocket(guest),
    guest.locator('[data-action="online"]').click(),
  ]);
  const guestName = guest.locator('#online-name');
  const guestCode = guest.locator('#online-code');
  await guestName.fill('Guest');
  await guestCode.fill(code);
  await waitForPong(guestSocket);
  await waitForPong(guestSocket);
  await expectLatency(guest, '#online-latency', 'guest lobby latency');
  check(await guestName.inputValue() === 'Guest' && await guestCode.inputValue() === code,
    'lobby latency updates preserve the nickname and room code');
  await guest.locator('[data-action="online-join"]').click();
  await guest.locator('.online-slots li').nth(1).waitFor({ timeout: 10000 });
  check((await guest.locator('.online-slots li').count()) === 4, 'guest sees four slots');
  await expectLatency(guest, '#online-latency', 'guest waiting room latency');

  // Host sees the guest and can start.
  await host.locator('[data-action="online-start"]:not([disabled])').waitFor({ timeout: 10000 });
  check(true, 'host start enabled with two players');

  await host.locator('[data-action="online-start"]').click();

  // Both clients enter the match overlay and receive snapshots.
  await host.locator('.match-overlay').waitFor({ timeout: 10000 });
  await guest.locator('.match-overlay').waitFor({ timeout: 10000 });
  check(await host.locator('#card-p0').count() > 0, 'host HUD shows snapshot actors');
  check(await guest.locator('#card-p1').count() > 0, 'guest HUD shows own actor card');

  await expectLatency(host, '#net-status', 'host latency HUD');
  await expectLatency(guest, '#net-status', 'guest latency HUD');

  // Force a socket drop: the client reconnects and the token resumes the room.
  const reconnecting = host.locator('#net-status').filter({ hasText: /^正在重连…$/ });
  const reconnectedSocket = gameSocket(host);
  await Promise.all([
    reconnecting.waitFor({ state: 'visible', timeout: 8000 }),
    host.waitForFunction(() => document.body.dataset.net === 'closed', null, { timeout: 8000 }),
    host.evaluate(() => window.__gunbrawlDebug.dropConnection()),
  ]);
  check(true, 'latency HUD shows reconnecting after the socket closes');
  const snapshotsBefore = await host.evaluate(() => window.__gunbrawlDebug.netStats().snapshots);
  await waitForPong(await reconnectedSocket);
  await host.waitForFunction(() => document.body.dataset.net === 'open', null, { timeout: 20000 });
  check(true, 'reconnected and resumed the room');
  await expectLatency(host, '#net-status', 'latency HUD after the new socket receives pong');
  await host.waitForFunction((before) => window.__gunbrawlDebug.netStats().snapshots > before,
    snapshotsBefore, { timeout: 10000 });
  check(true, 'snapshots resume after reconnect');

  const metrics = await (await fetch(new URL('/metrics', url))).text();
  const gauge = (name) => Number(metrics.match(new RegExp(`^${name} (\\d+)$`, 'm'))?.[1] ?? 0);
  // Other rooms may be live on a shared server, so only the floor matters here.
  check(gauge('gunbrawl_rooms_active') >= 1, 'metrics expose the active room');
  check(gauge('gunbrawl_players_connected') >= 2, 'metrics expose two connected players');
  check(/gunbrawl_snapshots_sent_total \d+/.test(metrics), 'metrics count snapshots');

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

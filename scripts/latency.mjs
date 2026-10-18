import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const started = performance.now();
await page.goto(process.env.GAME_TEST_URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: '进入战场' }).waitFor({ state: 'visible' });
const coldLoadMs = Math.round(performance.now() - started);
const navigation = await page.evaluate(() => {
  const entry = performance.getEntriesByType('navigation')[0];
  return entry ? {
    domContentLoadedMs: Math.round(entry.domContentLoadedEventEnd),
    loadMs: Math.round(entry.loadEventEnd),
  } : null;
});

await page.locator('[data-action="mode"][data-mode="training"]').click();
await page.locator('[data-action="start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12000 });
await page.keyboard.press('Digit2');
await page.waitForFunction(() => document.querySelector('#actor-status-p1')?.textContent?.includes('冲锋枪'));

const latency = await page.evaluate(async () => {
  const status = document.querySelector('#actor-status-p1');
  if (!status) return { ms: null, before: null, after: null };
  const before = status.textContent;
  const shotAt = performance.now();
  const result = await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (status.textContent !== before) {
        observer.disconnect();
        resolve({ ms: Number((performance.now() - shotAt).toFixed(2)), after: status.textContent });
      }
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', bubbles: true }));
    setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ', key: 'j', bubbles: true })), 80);
    setTimeout(() => { observer.disconnect(); resolve({ ms: null, after: status.textContent }); }, 1200);
  });
  return { ...result, before };
});

console.log(JSON.stringify({ coldLoadMs, navigation, inputLatencyMs: latency.ms, before: latency.before, after: latency.after }));
await browser.close();

import { chromium } from 'playwright';

// Headless software-WebGL harness. This measures JS / RAF cadence and heap in the
// current environment; it is not a reference-GPU acceptance result.
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on('pageerror', (error) => console.error('PAGE', error.message));
await page.goto(process.env.GAME_TEST_URL ?? 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.locator('[data-action="mode"][data-mode="local-duel"]').click();
await page.locator('[data-action="start"]').click();
await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12000 });
const sample = await page.evaluate(async () => {
  const intervals = [];
  let last = performance.now();
  const started = last;
  await new Promise((resolve) => {
    const frame = (now) => {
      intervals.push(now - last);
      last = now;
      if (now - started >= 6000) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const sorted = intervals.slice(2).sort((a, b) => a - b);
  const average = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const memory = performance.memory;
  return {
    frames: sorted.length,
    averageMs: Number(average.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    fps: Number((1000 / average).toFixed(1)),
    heapMb: memory ? Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1)) : null,
    canvas: document.querySelector('#game-canvas canvas')?.getAttribute('width') + 'x'
      + document.querySelector('#game-canvas canvas')?.getAttribute('height'),
  };
});
console.log(JSON.stringify({ scene: 'local-duel', seconds: 6, ...sample }));
await browser.close();

import { chromium } from 'playwright';

// Headless software-WebGL harness. This measures JS / RAF cadence and heap in the
// current environment; it is not a reference-GPU acceptance result.
const software = process.env.PERF_SOFTWARE !== '0';
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: software
    ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    : ['--enable-gpu', '--ignore-gpu-blocklist'],
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
  const canvas = document.querySelector('#game-canvas canvas');
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const debug = gl?.getExtension('WEBGL_debug_renderer_info');
  const renderer = debug && gl ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null;
  return {
    frames: sorted.length,
    averageMs: Number(average.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    fps: Number((1000 / average).toFixed(1)),
    heapMb: memory ? Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1)) : null,
    canvas: canvas?.getAttribute('width') + 'x' + canvas?.getAttribute('height'),
    renderer,
  };
});
const heap = async () => page.evaluate(() => {
  const memory = performance.memory;
  return memory ? Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1)) : null;
});
const heapStart = await heap();
const heaps = [heapStart];
for (let match = 1; match <= 20; match++) {
  await page.keyboard.press('Escape');
  const restart = page.locator('[data-action="restart"]');
  await restart.waitFor({ state: 'visible', timeout: 5000 });
  await restart.click();
  await page.locator('.countdown').waitFor({ state: 'hidden', timeout: 12000 });
  await page.waitForTimeout(120);
  if (match % 4 === 0) heaps.push(await heap());
}
await page.screenshot({ path: 'artifacts/perf-20-matches.png', fullPage: true });
console.log(JSON.stringify({
  scene: 'local-duel', seconds: 6, software, ...sample, matches: 20,
  heapStart, heapEnd: heaps.at(-1), heapSamples: heaps,
}));
await browser.close();

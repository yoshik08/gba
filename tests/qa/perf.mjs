// Performance: the emulator must hold 60 fps while UI motion runs, even on a slow CPU,
// and the library must scroll without long frames.
import { launch, romId, BASE } from './lib.mjs';
const rate = Number(process.env.CPU || 4);
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const { browser } = await launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
const id = await romId(context);

await page.goto(`${BASE}/gba/play?id=${id}`);
await page.waitForFunction(() => window.__gba?.phase() === 'ready', null, { timeout: 60000 });
await page.keyboard.press('KeyZ');
await page.waitForTimeout(1500);

const measure = (ms) => page.evaluate((dur) => new Promise((resolve) => {
  const f0 = window.__gba.frameEvents(); const t0 = performance.now();
  let long = 0; let worst = 0;
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => { long += 1; worst = Math.max(worst, e.duration); }));
  try { po.observe({ type: 'longtask' }); } catch { /* */ }
  setTimeout(() => { po.disconnect(); resolve({ fps: (window.__gba.frameEvents() - f0) / ((performance.now() - t0) / 1000), long, worst }); }, dur);
}), ms);

const idle = await measure(3000);
check(`emulator holds 60 fps at ${rate}× CPU slowdown`, idle.fps > 57, `${idle.fps.toFixed(1)} fps, long tasks ${idle.long}`);

// fire UI motion while the game runs at 2×: save-state flash + toast, touch presses with sound
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
const busy = measure(3000);
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(400);
const a = await page.locator('.fb-a').boundingBox();
for (let i = 0; i < 8; i += 1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2, id: 9 }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(60);
}
const b = await busy;
check('emulator unaffected by UI motion + input feedback (2× FF on)', b.fps > 110, `${b.fps.toFixed(1)} emulated fps during the burst, long tasks ${b.long}${b.long ? `, worst ${b.worst.toFixed(0)} ms` : ''}`);
await page.keyboard.press('KeyF');

// input latency: time from touchstart to the core receiving the press (same task)
const lat = await page.evaluate(() => new Promise((resolve) => {
  const zone = document.querySelector('[data-zone="face"]');
  const btn = document.querySelector('.fb-a').getBoundingClientRect();
  const t0 = performance.now();
  const ev = new PointerEvent('pointerdown', { pointerId: 77, pointerType: 'touch', clientX: btn.left + btn.width / 2, clientY: btn.top + btn.height / 2, bubbles: true, isPrimary: true });
  zone.dispatchEvent(ev);
  const held = window.__gba.held().includes('A');
  const t1 = performance.now();
  zone.dispatchEvent(new PointerEvent('pointerup', { pointerId: 77, pointerType: 'touch', bubbles: true }));
  resolve({ held, ms: t1 - t0 });
}));
check('touch press reaches the core in the same event (< 1 ms budget at 1×)', lat.held && lat.ms / rate < 1, `${lat.ms.toFixed(2)} ms at ${rate}× slowdown ≈ ${(lat.ms / rate).toFixed(2)} ms on a fast device`);

// library scroll on a mid-range phone (2× slowdown), once the first screen has loaded
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 2 });
await page.goto(`${BASE}/gba`);
await page.waitForTimeout(4000);
const scroll = await page.evaluate(() => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); let y = 0;
  const max = document.documentElement.scrollHeight - innerHeight;
  const step = (t) => {
    deltas.push(t - last); last = t;
    y = Math.min(max, y + 18); window.scrollTo(0, y);
    if (y < max && deltas.length < 400) requestAnimationFrame(step);
    else resolve(deltas.slice(3));
  };
  requestAnimationFrame(step);
}));
const sorted = [...scroll].sort((x, y2) => x - y2);
const p95 = sorted[Math.floor(sorted.length * 0.95)];
const janky = scroll.filter((d) => d > 50).length;
check('library scroll smooth at 2× slowdown', janky <= 3, `p95 frame ${p95.toFixed(1)} ms, ${janky} frames over 50 ms of ${scroll.length}`);
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);

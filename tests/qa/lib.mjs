// Shared helpers for the headless QA runs (game-qa). Reads the GBA frame from a real screenshot,
// because the WebGL canvas can't be read back with drawImage.
import { chromium } from 'playwright';

export const BASE = process.env.BASE || 'http://localhost:5173';

export async function launch(opts = {}) {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHANNEL || 'chromium',
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  return { browser, context };
}

export async function romId(context, title = 'Input Test') {
  const roms = await (await context.request.get(`${BASE}/gba/api/roms`)).json();
  return roms.find((r) => r.title === title).id;
}

// Decode the test ROM's frame counter + square from a screenshot of the canvas element.
export async function readFrame(page, selector = 'canvas') {
  const png = await page.locator(selector).first().screenshot({ animations: 'allow' });
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(240, 160);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(bmp, 0, 0, 240, 160);
    const d = g.getImageData(0, 0, 240, 160).data;
    let frame = 0;
    for (let i = 0; i < 24; i += 1) {
      const p = (2 * 240 + i * 10 + 5) * 4;
      if (d[p] > 128) frame |= (1 << i);
    }
    let square = null;
    for (let y = 8; y < 160 && !square; y += 1) {
      for (let x = 0; x < 240; x += 1) {
        const p = (y * 240 + x) * 4;
        if (d[p] > 150 || d[p + 1] > 150) { square = { x, y, rgb: [d[p], d[p + 1], d[p + 2]] }; break; }
      }
    }
    return { frame, square };
  }, png.toString('base64'));
}

export function color(rgb) {
  if (!rgb) return 'none';
  const [r, g, b] = rgb;
  if (r > 150 && g > 150 && b > 150) return 'white';
  if (r > 150 && g > 150) return 'yellow';
  if (r > 150) return 'red';
  if (g > 150) return 'green';
  return 'other';
}

export function collectLogs(page) {
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return logs;
}

// Real tab switch: open another tab and bring it to front, then come back.
export async function switchTabs(context, page, ms = 2000) {
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  const hidden = await page.evaluate(() => document.visibilityState);
  await other.waitForTimeout(ms);
  await page.bringToFront();
  await other.close();
  return hidden;
}

export async function audioState(page) {
  return page.evaluate(() => window.__gba?.audioState?.() ?? null);
}

export async function installHiddenSim(context) {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('./hidden-sim.js', import.meta.url), 'utf8');
  await context.addInitScript({ content: src });
}

// Hide the tab for `ms`, optionally suspending audio like iOS/Safari does, then show it again.
export async function simulateTabSwitch(page, ms = 2000, { suspendAudio = false } = {}) {
  await page.evaluate(async (suspend) => {
    window.__setHidden(true);
    if (suspend) {
      const ctxs = [window.__gba?.audioContext?.()].filter(Boolean);
      await Promise.all(ctxs.map((c) => c.suspend()));
    }
  }, suspendAudio);
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__setHidden(false));
}

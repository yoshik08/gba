// PWA: installable manifest, service worker, and a game that keeps working with the network off.
import { launch, romId, collectLogs, BASE } from './lib.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const { browser } = await launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const logs = collectLogs(page);
const id = await romId(context);

await page.goto(`${BASE}/gba/`);
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel=manifest]').href;
  const m = await (await fetch(href)).json();
  return { href, ...m };
});
check('manifest linked and valid', manifest.start_url === '/gba/' && manifest.icons.length === 3, manifest.href);
const iconOk = await page.evaluate(async (h) => (await fetch(new URL('icons/icon-512.png', h))).ok, manifest.href);
check('manifest icons resolve', iconOk);
await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), null, { timeout: 15000 });
await page.waitForTimeout(1500);

// play once online so the ROM lands in IndexedDB and the play shell is cached
await page.goto(`${BASE}/gba/play?id=${id}`);
await page.waitForFunction(() => window.__gba?.phase() === 'ready', null, { timeout: 30000 });
await page.waitForTimeout(2500); // let the worker warm its cache
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const all = [];
  for (const k of keys) { const c = await caches.open(k); (await c.keys()).forEach((r) => all.push(new URL(r.url).pathname)); }
  return all;
});
check('worker cached the emulator core', cached.includes('/gba/mgba/mgba.wasm') && cached.includes('/gba/mgba/mgba.js'));
check('worker cached the app shell', cached.includes('/gba/') && cached.includes('/gba/play'), cached.filter((p) => !p.includes('/assets/')).join(', '));
check('worker cached hashed assets', cached.some((p) => p.startsWith('/gba/assets/')));

await context.setOffline(true);
await page.goto(`${BASE}/gba/`);
await page.waitForSelector('#signed-in:not([hidden])', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(1500);
check('library opens offline', await page.isVisible('#signed-in'));
const syncText = await page.textContent('#sync-label');
check('library says it is offline', /offline/i.test(syncText), syncText);
check('downloaded game marked offline-ready', (await page.locator(`.game[data-id="${id}"] .badge.offline`).count()) > 0);

await page.goto(`${BASE}/gba/play?id=${id}`);
await page.waitForFunction(() => window.__gba?.phase() === 'ready', null, { timeout: 30000 }).catch(() => {});
check('game boots offline', (await page.evaluate(() => window.__gba?.phase())) === 'ready');
await page.keyboard.press('KeyZ');
await page.waitForTimeout(800);
check('game runs offline', await page.evaluate(() => window.__gba?.running()));
await page.keyboard.down('Enter'); await page.waitForTimeout(100); await page.keyboard.up('Enter');
await page.waitForTimeout(6500);
const meta = await page.evaluate((rid) => JSON.parse(localStorage.getItem('gba:meta:v1')).roms[rid], id);
check('offline in-game save queued for sync', meta?.sramPending === true, JSON.stringify(meta));

await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(2500);
const meta2 = await page.evaluate((rid) => JSON.parse(localStorage.getItem('gba:meta:v1')).roms[rid], id);
check('queued save syncs when back online', meta2?.sramPending === false && !!meta2?.sramSyncedAt);

const errs = logs.filter((l) => !/ScriptProcessorNode|status of 404|ERR_INTERNET_DISCONNECTED|Failed to fetch|net::ERR/.test(l));
check('no unexpected errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);

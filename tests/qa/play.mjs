// Gameplay QA against the local mock server and the generated test ROM.
//   node tests/qa/play.mjs            (server must be running: npm run dev:local)
// Checks input (keyboard, multi-touch slides, gamepad-free), 2× fast-forward, tab switching
// (including an iOS-style refused audio resume), save states, SRAM sync and frame pacing.
import { launch, romId, readFrame, collectLogs, installHiddenSim, simulateTabSwitch, color, BASE } from './lib.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const { browser } = await launch();
const context = await browser.newContext({
  viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 800) },
  hasTouch: true,
  isMobile: process.env.MOBILE === '1',
  deviceScaleFactor: 1,
});
await installHiddenSim(context);
const page = await context.newPage();
const logs = collectLogs(page);
const cdp = await context.newCDPSession(page);
const id = await romId(context);

// clean slate for this ROM's save data in the mock + browser
await page.goto(`${BASE}/gba`);
await page.evaluate(() => { localStorage.clear(); return new Promise((r) => { const q = indexedDB.deleteDatabase('gba-cache'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });

await page.goto(`${BASE}/gba/play?id=${id}`);
await page.waitForFunction(() => window.__gba?.phase() === 'ready', null, { timeout: 30000 });
check('boots to "press any button"', await page.isVisible('#start'));

const gba = (expr) => page.evaluate(`window.__gba.${expr}`);
const sleep = (ms) => page.waitForTimeout(ms);

// emulated frames per second, counted by the core's own frame callback
async function fps(ms = 2000) {
  return page.evaluate((dur) => new Promise((resolve) => {
    const f0 = window.__gba.frameEvents(); const t0 = performance.now();
    setTimeout(() => resolve((window.__gba.frameEvents() - f0) / ((performance.now() - t0) / 1000)), dur);
  }), ms);
}

// ---------- start: the first key powers on and is not forwarded
await page.keyboard.press('KeyZ');
await page.waitForFunction(() => window.__gba.running(), null, { timeout: 5000 });
check('first key starts the game', await gba('running()'));
check('start key not forwarded to the game', (await gba('held()')).length === 0);
await sleep(600);
check('audio context running after start', (await gba('audioState()')) === 'running', await gba('audioState()'));

const base = await fps();
check('runs at ~60 fps', base > 50 && base < 70, `${base.toFixed(1)} fps`);

// ---------- keyboard
let f0 = await readFrame(page);
await page.keyboard.down('ArrowRight'); await sleep(400); await page.keyboard.up('ArrowRight');
let f1 = await readFrame(page);
check('keyboard → moves right', f1.square.x > f0.square.x, `${f0.square.x} → ${f1.square.x}`);
await sleep(200);
const f2 = await readFrame(page);
check('keyboard release stops movement', f2.square.x === f1.square.x);
await page.keyboard.down('KeyZ'); await sleep(120);
check('keyboard Z = A (square red)', color((await readFrame(page)).square.rgb) === 'red');
await page.keyboard.up('KeyZ'); await sleep(120);
check('A released (square white)', color((await readFrame(page)).square.rgb) === 'white');

// ---------- touch (real touch events through CDP: start, slide, end)
async function center(sel) {
  const b = await page.locator(sel).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });

const dp = await center('#dpad');
const right = { x: dp.x + dp.w * 0.36, y: dp.y, id: 1 };
f0 = await readFrame(page);
await touch('touchStart', [right]);
await sleep(300);
check('touch D-pad right held', JSON.stringify(await gba('held()')) === '["Right"]', JSON.stringify(await gba('held()')));
// slide thumb up without lifting: should roll Right → Up
await touch('touchMove', [{ x: dp.x + dp.w * 0.25, y: dp.y - dp.h * 0.25, id: 1 }]);
await sleep(60);
const diag = await gba('held()');
check('slide to diagonal = Up+Right', diag.includes('Up') && diag.includes('Right'), JSON.stringify(diag));
await touch('touchMove', [{ x: dp.x + 2, y: dp.y - dp.h * 0.38, id: 1 }]);
await sleep(60);
check('slide to top = Up only', JSON.stringify(await gba('held()')) === '["Up"]', JSON.stringify(await gba('held()')));
await touch('touchMove', [{ x: dp.x + 3, y: dp.y - 4, id: 1 }]);
await sleep(60);
check('centre of D-pad is a dead zone', (await gba('held()')).length === 0, JSON.stringify(await gba('held()')));
await touch('touchEnd', []);
f1 = await readFrame(page);
check('touch D-pad moved the square', f1.square.x !== f0.square.x || f1.square.y !== f0.square.y, `${f0.square.x},${f0.square.y} → ${f1.square.x},${f1.square.y}`);

// two thumbs: D-pad + A together
const a = await center('.fb-a');
const b = await center('.fb-b');
await touch('touchStart', [{ x: dp.x, y: dp.y + dp.h * 0.36, id: 1 }, { x: a.x, y: a.y, id: 2 }]);
await sleep(120);
const two = await gba('held()');
check('two thumbs: Down + A', two.includes('Down') && two.includes('A') && two.length === 2, JSON.stringify(two));
check('A via touch turns square red', color((await readFrame(page)).square.rgb) === 'red');
// roll the right thumb from A to B
await touch('touchMove', [{ x: dp.x, y: dp.y + dp.h * 0.36, id: 1 }, { x: b.x, y: b.y, id: 2 }]);
await sleep(80);
const rolled = await gba('held()');
check('roll A → B keeps Down, swaps to B', rolled.includes('B') && !rolled.includes('A') && rolled.includes('Down'), JSON.stringify(rolled));
await touch('touchEnd', []);
await sleep(60);
check('all touch released', (await gba('held()')).length === 0);
// the gap between A and B presses both
await touch('touchStart', [{ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, id: 3 }]);
await sleep(60);
const both = await gba('held()');
check('gap between A and B presses both', both.includes('A') && both.includes('B'), JSON.stringify(both));
await touch('touchEnd', []);
// a touch just outside a small button (Start) shouldn't stick
const st = await center('.sbtn[data-btn="Start"]');
await touch('touchStart', [{ x: st.x, y: st.y, id: 4 }]);
await touch('touchMove', [{ x: st.x + 120, y: st.y - 120, id: 4 }]);
await sleep(40);
check('sliding off Start releases it', !(await gba('held()')).includes('Start'));
await touch('touchEnd', []);

// ---------- fast forward 2×
await page.keyboard.press('KeyF');
await sleep(300);
check('fast-forward multiplier is 2', (await gba('ff()')) === 2, String(await gba('ff()')));
const ff = await fps(2000);
check('fast-forward runs ~2× (not 4×)', ff > base * 1.6 && ff < base * 2.4, `${ff.toFixed(1)} fps vs ${base.toFixed(1)}`);
check('2× badge visible', await page.isVisible('#ff-badge'));
await page.keyboard.press('KeyF');
await sleep(300);
check('fast-forward off', (await gba('ff()')) === 1);
await page.keyboard.down('Space'); await sleep(200);
check('hold Space = fast-forward', (await gba('ff()')) === 2);
await page.keyboard.up('Space'); await sleep(100);
check('release Space = normal speed', (await gba('ff()')) === 1);

// ---------- tab switch: held key, hidden, back
await page.keyboard.down('ArrowLeft');
await sleep(150);
const beforeHide = await readFrame(page);
await simulateTabSwitch(page, 2000);
await sleep(300);
const afterShow1 = await readFrame(page); await sleep(500); const afterShow2 = await readFrame(page);
check('held key released on tab hide', (await gba('held()')).length === 0, JSON.stringify(await gba('held()')));
check('no movement after return (no stuck key)', afterShow1.square.x === afterShow2.square.x, `${afterShow1.square.x} → ${afterShow2.square.x}`);
check('game paused while hidden', afterShow1.frame - beforeHide.frame < 60, `${afterShow1.frame - beforeHide.frame} frames across a 2 s hide`);
check('game resumes after return', afterShow2.frame > afterShow1.frame && await gba('running()'), `${afterShow2.frame - afterShow1.frame} frames in 0.5 s`);
check('audio running after return', (await gba('audioState()')) === 'running');
await page.keyboard.up('ArrowLeft');

// rapid flapping must not wedge anything
for (let i = 0; i < 6; i += 1) {
  await page.evaluate(() => window.__setHidden(true));
  await sleep(30 + i * 7);
  await page.evaluate(() => window.__setHidden(false));
  await sleep(20);
}
await sleep(900);
check('survives rapid hide/show', (await gba('running()')) && (await gba('reasons()')).length === 0, JSON.stringify(await gba('reasons()')));
const flapA = await readFrame(page); await sleep(500); const flapB = await readFrame(page);
check('still rendering after flapping', flapB.frame > flapA.frame);

// iOS-style: audio refuses to resume without a tap → paused prompt, then a tap resumes
await page.evaluate(() => {
  const ctx = window.__gba.audioContext();
  ctx.__realResume = ctx.resume.bind(ctx);
  ctx.resume = () => new Promise(() => {});
});
await simulateTabSwitch(page, 800, { suspendAudio: true });
await sleep(900);
check('refused audio → paused prompt shown', await page.isVisible('#paused'), JSON.stringify(await gba('reasons()')));
check('refused audio → game not running silent', !(await gba('running()')));
await page.evaluate(() => { const ctx = window.__gba.audioContext(); ctx.resume = ctx.__realResume; });
await page.click('#paused');
await sleep(500);
check('tap resumes with audio', (await gba('running()')) && (await gba('audioState()')) === 'running');

// ---------- menu pauses, closing resumes
await page.keyboard.press('Escape');
await sleep(500);
check('Esc opens pause menu and pauses', (await page.isVisible('#menu-sheet')) && !(await gba('running()')));
await page.keyboard.press('Escape');
await sleep(500);
check('closing menu resumes', await gba('running()'));
await page.keyboard.press('Shift+Slash');
await sleep(400);
check('"?" opens controls', await page.isVisible('#help-sheet'));
await page.keyboard.press('Escape');
await sleep(400);

// ---------- save state (Ctrl+S) with thumbnail
const posted = page.waitForResponse((r) => r.url().includes(`/gba/api/states/${id}`) && r.request().method() === 'POST');
await page.keyboard.press('Control+KeyS');
const res = await posted;
check('Ctrl+S posts a save state', res.ok());
await sleep(400);
const thumbs = await page.evaluate(() => new Promise((r) => {
  const q = indexedDB.open('gba-cache'); q.onsuccess = () => { const t = q.result.transaction('thumbs').objectStore('thumbs').getAllKeys(); t.onsuccess = () => r(t.result); };
}));
check('save state screenshot kept on device', thumbs.length >= 2, JSON.stringify(thumbs));

// ---------- in-game save (SRAM): Start writes SRAM, synced after the 5 s debounce
const put = page.waitForResponse((r) => r.url().includes(`/gba/api/sram/${id}`) && r.request().method() === 'PUT', { timeout: 15000 });
await page.keyboard.down('Enter'); await sleep(100); await page.keyboard.up('Enter');
const sr = await put.catch(() => null);
check('in-game save synced to cloud', !!sr && sr.ok());

// ---------- frame pacing while playing (main thread)
const pacing = await page.evaluate(() => new Promise((resolve) => {
  const deltas = []; let last = performance.now(); let long = 0;
  const po = new PerformanceObserver((l) => { long += l.getEntries().length; });
  try { po.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
  const tick = (t) => { deltas.push(t - last); last = t; if (deltas.length < 240) requestAnimationFrame(tick); else { po.disconnect(); resolve({ deltas, long }); } };
  requestAnimationFrame(tick);
}));
const sorted = pacing.deltas.slice(5).sort((x, y) => x - y);
const p50 = sorted[Math.floor(sorted.length * 0.5)];
const p95 = sorted[Math.floor(sorted.length * 0.95)];
check('main-thread frames on budget while playing', p95 < 20, `p50 ${p50.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, long tasks ${pacing.long}`);

// ---------- back to library: saves first, then the hero shows this game
await page.click('#back');
await page.waitForURL(/\/gba\/?$/, { timeout: 8000 });
await page.waitForSelector('.hero .hero-title', { timeout: 8000 });
await sleep(1500);
check('library hero = last played game', (await page.textContent('.hero .hero-title')).includes('Input Test'));
check('hero shows the save-state screenshot', await page.isVisible('.hero-shot'));

const errors = logs.filter((l) => !/ScriptProcessorNode|favicon|status of 404/.test(l));
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await page.screenshot({ path: 'C:/vibecoded/gba/.local/shots/after-play-library.png' });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

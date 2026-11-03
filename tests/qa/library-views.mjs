// Visual review of the library: signed out, first visit, returning player, details sheet, account sheet.
import { launch, BASE, collectLogs } from './lib.mjs';
const out = 'C:/vibecoded/gba/.local/shots';
const { browser } = await launch();
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const errors = [];
for (const [name, v] of Object.entries(sizes)) {
  // signed out
  let ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.deviceScaleFactor || 1, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch });
  await ctx.addCookies([{ name: 'mock_signed_out', value: '1', url: `${BASE}/gba` }]);
  let page = await ctx.newPage();
  errors.push(...collectLogs(page));
  await page.goto(`${BASE}/gba`);
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/lib-${name}-signedout.png` });
  await ctx.close();

  // returning player: Metroid Fusion played 2h ago, Golden Sun yesterday, Minish Cap last week
  ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.deviceScaleFactor || 1, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch });
  page = await ctx.newPage();
  errors.push(...collectLogs(page));
  const roms = await (await ctx.request.get(`${BASE}/gba/api/roms`)).json();
  const idOf = (t) => roms.find((r) => r.title.startsWith(t)).id;
  await page.goto(`${BASE}/gba`);
  await page.evaluate(({ a, b, c, d }) => {
    const now = Date.now();
    localStorage.setItem('gba:meta:v1', JSON.stringify({ roms: {
      [a]: { lastPlayed: now - 2 * 3600e3, playMs: 14 * 3600e3 + 22 * 60e3, sramSyncedAt: now - 2 * 3600e3 },
      [b]: { lastPlayed: now - 26 * 3600e3, playMs: 5 * 3600e3 },
      [c]: { lastPlayed: now - 8 * 86400e3, playMs: 3600e3 },
      [d]: { lastPlayed: now - 3 * 86400e3, playMs: 40 * 60e3 },
    }, prefs: {} }));
  }, { a: idOf('Metroid Fusion'), b: idOf('Golden Sun'), c: idOf('Legend of Zelda'), d: idOf('Advance Wars') });
  await page.reload();
  await page.waitForTimeout(2800);
  await page.screenshot({ path: `${out}/lib-${name}-returning.png` });
  await page.mouse.wheel(0, v.height * 0.9);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/lib-${name}-scrolled.png` });
  await page.mouse.wheel(0, -5000);
  await page.waitForTimeout(600);
  await page.click('[data-hero-more]');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/lib-${name}-sheet.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.fill('#search', 'zel');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/lib-${name}-search.png` });
  await page.fill('#search', '');
  await page.click('#account');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/lib-${name}-account.png` });
  await ctx.close();
}
await browser.close();
const real = errors.filter((l) => !/status of 404/.test(l));
console.log(real.length ? real.join('\n') : 'no console errors');

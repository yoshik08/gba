// Visual review: play page in several viewports with the game running, plus its sheets.
import { launch, romId, BASE } from './lib.mjs';
const out = 'C:/vibecoded/gba/.local/shots';
const { browser } = await launch();
const views = [
  ['phone-portrait', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['phone-landscape', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['tablet', { width: 1024, height: 768, deviceScaleFactor: 1, isMobile: true, hasTouch: true }],
  ['desktop', { width: 1440, height: 900, deviceScaleFactor: 1 }],
];
const only = process.argv[2];
for (const [name, v] of views) {
  if (only && !name.includes(only)) continue;
  const context = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: v.deviceScaleFactor, isMobile: !!v.isMobile, hasTouch: !!v.hasTouch });
  const page = await context.newPage();
  const id = await romId(context, process.env.TITLE || 'Input Test');
  await page.goto(`${BASE}/gba/play?id=${id}`);
  await page.waitForFunction(() => window.__gba?.phase() === 'ready', null, { timeout: 30000 });
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(900);
  await page.keyboard.down('KeyZ'); await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/play-${name}.png` });
  await page.keyboard.up('KeyZ'); await page.keyboard.up('ArrowRight');
  if (process.env.SHEETS) {
    await page.keyboard.press('Escape'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/play-${name}-menu.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/play-${name}-help.png` });
  }
  await context.close();
}
await browser.close();

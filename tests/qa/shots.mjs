// Visual pass: screenshots of the library and play page at phone + desktop sizes.
import { launch, collectLogs, romId, BASE } from './lib.mjs';
const out = process.env.OUT || 'C:/vibecoded/gba/.local/shots';
const which = process.argv[2] || 'library';
const { mkdir } = await import('node:fs/promises');
await mkdir(out, { recursive: true });
const sizes = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]];
const { browser } = await launch();
for (const [name, vp] of sizes) {
  const { viewport, ...rest } = { viewport: { width: vp.width, height: vp.height }, ...vp };
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  if (process.env.SIGNED_OUT) await context.addCookies([{ name: 'mock_signed_out', value: '1', url: BASE + '/gba' }]);
  if (process.env.SEED) await context.addInitScript(process.env.SEED);
  const page = await context.newPage();
  const logs = collectLogs(page);
  if (which === 'library') {
    await page.goto(`${BASE}/gba`);
    await page.waitForTimeout(Number(process.env.WAIT || 2600));
    await page.screenshot({ path: `${out}/${which}-${name}${process.env.SIGNED_OUT ? '-out' : ''}.png` });
    if (process.env.FULL) await page.screenshot({ path: `${out}/${which}-${name}-full.png`, fullPage: true });
  } else {
    const id = await romId(context, process.env.TITLE || 'Input Test');
    await page.goto(`${BASE}/gba/play?id=${id}`);
    await page.waitForTimeout(Number(process.env.WAIT || 3500));
    await page.screenshot({ path: `${out}/${which}-${name}.png` });
  }
  console.log(name, logs.filter((l) => !l.includes('ScriptProcessorNode')).join('\n') || 'no errors');
  await context.close();
}
await browser.close();

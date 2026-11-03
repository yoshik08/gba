// Renders the PWA icons with the site's own fonts. Run: node scripts/make-icons.mjs
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = `data:font/woff2;base64,${readFileSync(join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')).toString('base64')}`;
const html = (size, lcd) => `<!doctype html><html><head><style>
@font-face { font-family: A; src: url(${font}) format('woff2-variations'); font-weight: 100 900; font-stretch: 62% 125%; }
html,body{margin:0;background:#000;width:${size}px;height:${size}px;overflow:hidden}
.wrap{position:absolute;inset:0;display:grid;place-items:center;
  background: radial-gradient(60% 50% at 50% 58%, rgba(140,110,255,.35), transparent 70%), #000;}
.lcd{width:${lcd}%;aspect-ratio:3/2;border-radius:${size*0.05}px;position:relative;
  background: linear-gradient(120deg,#7d6bff 0%,#ff4fa8 52%,#ff8a3d 100%);
  box-shadow: 0 0 0 ${size*0.018}px #0c0c0e, 0 0 0 ${size*0.024}px rgba(255,255,255,.12), 0 ${size*0.06}px ${size*0.16}px rgba(255,90,180,.45);
  display:grid;place-items:center;overflow:hidden}
.lcd::after{content:'';position:absolute;inset:0;background:linear-gradient(160deg,rgba(255,255,255,.28),transparent 40%)}
b{font-family:A;font-weight:900;font-stretch:125%;font-size:${size*lcd/100*0.3}px;letter-spacing:-.03em;color:#000;line-height:1;margin-top:${size*0.008}px}
</style></head><body><div class="wrap"><div class="lcd"><b>GBA</b></div></div></body></html>`;

const browser = await chromium.launch({ headless: true });
const jobs = [
  ['icon-512.png', 512, 74],
  ['icon-192.png', 192, 76],
  ['icon-maskable-512.png', 512, 58],
  ['apple-touch-icon.png', 180, 74],
];
for (const [name, size, lcd] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(html(size, lcd));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(root, 'public', 'icons', name) });
  await page.close();
}
await browser.close();
console.log('icons written to public/icons');

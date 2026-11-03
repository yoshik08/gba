// Local preview server: Vite + an in-process mock of /gba/api/*.
// Mirrors the vercel.json rewrites so URLs are identical to production (/gba, /gba/play?id=…).
// Nothing here talks to Google Drive or MongoDB; data lives in .local/ (gitignored).
//
//   npm run dev:local            → http://localhost:5173/gba
//   drop your own .gba files in  → .local/roms/
//   DEMO=1 npm run dev:local     → also lists a few well-known titles (playing them loads the test ROM)
//   SLOW=1                       → throttles ROM downloads so the progress UI is visible
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import './copy-mgba.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(root, '.local');
const ROMS = join(LOCAL, 'roms');
const DATA = join(LOCAL, 'data');
const port = parseInt(process.env.PORT || '5173', 10);
const preview = process.argv.includes('--preview') || process.env.PREVIEW === '1';
const demo = process.argv.includes('--demo') || process.env.DEMO === '1';
const slow = process.argv.includes('--slow') || process.env.SLOW === '1';

if (!existsSync(join(ROMS, 'Input Test.gba'))) {
  await import('./make-test-rom.mjs');
}
await mkdir(DATA, { recursive: true });

const DEMO_TITLES = [
  'Pokemon - Emerald Version (USA, Europe)',
  'Metroid Fusion (USA)',
  'Advance Wars (USA)',
  'Golden Sun (USA, Europe)',
  'Mother 3 (Japan)',
  'Legend of Zelda, The - The Minish Cap (USA)',
  'Castlevania - Aria of Sorrow (USA)',
  'Kirby & The Amazing Mirror (USA)',
  'Mario Kart - Super Circuit (USA)',
  'Fire Emblem (USA, Australia)',
  'WarioWare, Inc. - Mega Microgame$! (USA)',
  'Final Fantasy Tactics Advance (USA, Australia)',
];

const idFor = (name) => createHash('sha1').update(name).digest('hex').slice(0, 20);
const cleanTitle = (filename) => String(filename || '')
  .replace(/\.gba$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

async function listRoms() {
  const files = (await readdir(ROMS)).filter((f) => /\.gba$/i.test(f));
  const roms = [];
  for (const f of files) {
    const s = await stat(join(ROMS, f));
    roms.push({ id: idFor(f), file: f, title: cleanTitle(f), size: s.size });
  }
  if (demo) {
    for (const t of DEMO_TITLES) {
      roms.push({ id: idFor(t), file: 'Input Test.gba', title: t, size: 16 * 1024 * 1024 });
    }
  }
  return roms;
}

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '')
  .split(';').map((p) => p.trim().split('=')).filter((p) => p[0]));
const signedIn = (req) => cookies(req).mock_signed_out !== '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const statesFile = join(DATA, 'states.json');
async function loadStates() {
  try { return JSON.parse(await readFile(statesFile, 'utf8')); } catch { return []; }
}
async function saveStates(list) { await writeFile(statesFile, JSON.stringify(list)); }

const coverCache = new Map();
async function cover(title) {
  if (coverCache.has(title)) return coverCache.get(title);
  const names = [...new Set([title, title.replace(/\s+/g, '_')])];
  const base = 'https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Game_Boy_Advance/master/Named_Boxarts';
  let found = null;
  for (const name of names) {
    try {
      const r = await fetch(`${base}/${encodeURIComponent(name)}.png`);
      if (r.ok) { found = Buffer.from(await r.arrayBuffer()); break; }
    } catch { /* offline */ }
  }
  coverCache.set(title, found);
  return found;
}

async function api(req, res, path) {
  const url = new URL(req.url, 'http://x');
  const parts = path.split('/').filter(Boolean);

  if (path === '/config') return json(res, 200, { googleClientId: 'local-mock' });
  if (parts[0] === 'auth' && parts[1] === 'callback') {
    res.setHeader('Set-Cookie', 'mock_signed_out=0; Path=/gba; HttpOnly; SameSite=Lax');
    res.statusCode = 302; res.setHeader('Location', '/gba'); return res.end();
  }
  if (path === '/auth/logout') {
    res.setHeader('Set-Cookie', 'mock_signed_out=1; Path=/gba; HttpOnly; SameSite=Lax');
    if (req.method === 'GET') { res.statusCode = 302; res.setHeader('Location', '/gba'); return res.end(); }
    return json(res, 200, { ok: true });
  }
  if (!signedIn(req)) return json(res, 401, { error: 'Unauthorized' });
  if (path === '/me') return json(res, 200, { sub: 'local-user', name: 'Local Player', picture: '' });

  const roms = await listRoms();
  if (path === '/roms') {
    await sleep(250);
    return json(res, 200, roms.map(({ id, title, size }) => ({
      id, title, size, coverUrl: `/gba/api/cover?title=${encodeURIComponent(title)}`,
    })));
  }
  if (path === '/cover') {
    const img = await cover(url.searchParams.get('title') || '');
    if (!img) return json(res, 404, { error: 'Thumbnail not found' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    return res.end(img);
  }
  if (parts[0] === 'rom' && parts[1]) {
    const rom = roms.find((r) => r.id === decodeURIComponent(parts[1]));
    if (!rom) return json(res, 404, { error: 'Not found' });
    const buf = await readFile(join(ROMS, rom.file));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    if (slow) {
      const step = Math.ceil(buf.length / 20);
      for (let i = 0; i < buf.length; i += step) { res.write(buf.subarray(i, i + step)); await sleep(80); }
      return res.end();
    }
    return res.end(buf);
  }
  if (parts[0] === 'sram' && parts[1]) {
    const file = join(DATA, `sram-${idFor(parts[1])}.bin`);
    if (req.method === 'GET') {
      if (!existsSync(file)) return json(res, 404, { error: 'No SRAM' });
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(await readFile(file));
    }
    if (req.method === 'PUT') {
      await writeFile(file, await readBody(req));
      return json(res, 200, { message: 'SRAM saved' });
    }
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if (parts[0] === 'states' && parts[1]) {
    const romId = decodeURIComponent(parts[1]);
    const all = await loadStates();
    if (parts[2]) {
      const doc = all.find((s) => s.id === parts[2] && s.romId === romId);
      if (!doc) return json(res, 404, { error: 'State not found' });
      const file = join(DATA, `state-${doc.id}.bin`);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(await readFile(file));
    }
    if (req.method === 'GET') {
      return json(res, 200, all.filter((s) => s.romId === romId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
        .map(({ id, createdAt, coreVersion }) => ({ id, createdAt, coreVersion })));
    }
    if (req.method === 'POST') {
      const data = await readBody(req);
      const id = randomBytes(12).toString('hex');
      await writeFile(join(DATA, `state-${id}.bin`), data);
      all.push({ id, romId, createdAt: new Date().toISOString(), coreVersion: req.headers['x-core-version'] || 'mgba-wasm' });
      const mine = all.filter((s) => s.romId === romId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const drop = new Set(mine.slice(3).map((s) => s.id));
      await saveStates(all.filter((s) => !drop.has(s.id)));
      return json(res, 200, { id, message: 'State saved' });
    }
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  return json(res, 404, { error: 'Not found' });
}

// Same rewrite order as vercel.json.
function rewrite(url) {
  const [path, query = ''] = url.split('?');
  const q = query ? `?${query}` : '';
  if (path === '/gba/play' || path === '/gba/play/') return `/play/index.html${q}`;
  if (path === '/gba' || path === '/gba/') return `/index.html${q}`;
  if (path.startsWith('/gba/')) return `${path.slice(4)}${q}`;
  return null;
}

const mockPlugin = {
  name: 'gba-local-mock',
  configureServer(server) { server.middlewares.use(handle); },
  configurePreviewServer(server) { server.middlewares.use(handle); },
};

async function handle(req, res, next) {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  const path = req.url.split('?')[0];
  if (path.startsWith('/gba/api/')) {
    try { await api(req, res, path.slice('/gba/api'.length)); } catch (err) {
      console.error(err); json(res, 500, { error: 'mock error' });
    }
    return;
  }
  if (path === '/' ) { res.statusCode = 302; res.setHeader('Location', '/gba'); return res.end(); }
  // Static files from public/ (the mGBA core, service worker, icons) are served as-is, like Vercel does.
  // Vite's dev server would otherwise try to transform /mgba/mgba.js when it's imported as a module.
  if (!preview && path.startsWith('/gba/')) {
    const file = join(root, 'public', decodeURIComponent(path.slice(5)));
    if (file.startsWith(join(root, 'public')) && existsSync(file) && (await stat(file)).isFile()) {
      const types = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json' };
      const ext = file.slice(file.lastIndexOf('.'));
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      return res.end(await readFile(file));
    }
  }
  const to = rewrite(req.url);
  if (to) req.url = to;
  next();
}

if (preview) {
  // Serve the production build (dist/, built with base /gba/) behind the same rewrites.
  const { preview: vitePreview } = await import('vite');
  const server = await vitePreview({
    base: '/',
    plugins: [mockPlugin],
    preview: { port, strictPort: true },
    build: { outDir: 'dist' },
  });
  console.log(`preview (production build) → http://localhost:${port}/gba`);
  server.printUrls();
} else {
  const server = await createServer({
    base: '/',
    plugins: [mockPlugin],
    optimizeDeps: { exclude: ['@thenick775/mgba-wasm'] },
    server: { port, strictPort: true },
  });
  await server.listen();
  console.log(`local mock → http://localhost:${port}/gba`);
}

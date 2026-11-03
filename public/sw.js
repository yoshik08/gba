// GBA service worker: app shell + emulator core offline, API always live.
// ROMs and saves are already kept in IndexedDB by the app itself.
const VERSION = 'gba-v2';
const SHELL = ['/gba/', '/gba/play', '/gba/mgba/mgba.js', '/gba/mgba/mgba.wasm', '/gba/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm') return;
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    for (const url of event.data.urls || []) {
      try {
        const u = new URL(url, self.location.origin);
        if (u.origin !== self.location.origin || u.pathname.startsWith('/gba/api/')) continue;
        if (await cache.match(u.pathname.startsWith('/gba/play') ? '/gba/play' : u.href, { ignoreVary: true })) continue;
        const res = await fetch(u.href, { cache: 'no-cache' });
        if (res.ok && !res.redirected) await cache.put(u.pathname === '/gba/play' ? '/gba/play' : u.href, res);
      } catch { /* skip */ }
    }
  })());
});

const isHashedAsset = (p) => p.startsWith('/gba/assets/') || p.startsWith('/assets/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // Live API: never intercepted, except box art which is safe to keep.
  if (p.startsWith('/gba/api/')) {
    if (p === '/gba/api/cover') event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    const key = p.startsWith('/gba/play') ? '/gba/play' : '/gba/';
    event.respondWith(networkFirst(request, key));
    return;
  }

  if (isHashedAsset(p)) { event.respondWith(cacheFirst(request)); return; }
  if (p.startsWith('/gba/mgba/') || p.startsWith('/gba/icons/') || p === '/gba/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request, { ignoreVary: true });
  const net = fetch(request).then((res) => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || Response.error();
}

async function networkFirst(request, key) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(request);
    if (res.ok && !res.redirected && res.type === 'basic') cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key, { ignoreVary: true })) || Response.error();
  }
}

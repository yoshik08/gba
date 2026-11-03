import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';
import { SplitText } from 'gsap/SplitText';
import { animate, createTimer } from 'animejs';
import { idbDelete, idbGet, idbKeys, idbSet } from './idb.js';
import { gzipBytes } from './gzip.js';
import { icon } from './lib/icons.js';
import {
  ago, allRomMeta, bytes, cacheLibrary, cacheUser, cachedLibrary, cachedUser, clockTime,
  displayTitle, playtime, prefs, recentRoms, romMeta, setPref, updateRom,
} from './lib/meta.js';
import { hashColor, pixelReveal, reducedMotion, sampleColor } from './lib/art.js';
import { closeSheet, openSheet, toast } from './lib/ui.js';
import { haptic, sfx } from './lib/sfx.js';
import { registerServiceWorker } from './lib/pwa.js';

gsap.registerPlugin(ScrollTrigger, Flip, SplitText);
registerServiceWorker();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const els = {
  top: $('#top'),
  topActions: $('#top-actions'),
  sync: $('#sync'),
  syncLabel: $('#sync-label'),
  account: $('#account'),
  avatar: $('#avatar'),
  signedOut: $('#signed-out'),
  signedIn: $('#signed-in'),
  login: $('#login-button'),
  hero: $('#hero'),
  recent: $('#recent'),
  recentRow: $('#recent-row'),
  grid: $('#grid'),
  empty: $('#empty'),
  count: $('#lib-count'),
  search: $('#search'),
  filters: $('#filters'),
  gameSheet: $('#game-sheet'),
  accountSheet: $('#account-sheet'),
  ambient: $$('.ambient i'),
};

$('#search-icon').innerHTML = icon('search');

const state = {
  user: null,
  roms: [],
  offline: new Set(),
  states: new Map(), // romId -> [{id, createdAt}]
  filter: 'all',
  query: '',
  online: true,
};

const playUrl = (id, extra = '') => `/gba/play?id=${encodeURIComponent(id)}${extra}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rgb = (c) => (c ? c.join(' ') : null);

// ---------------------------------------------------------------- API (unchanged endpoints)
async function me() {
  try {
    const res = await fetch('/gba/api/me');
    if (res.status === 401) return { user: null, online: true };
    if (!res.ok) throw new Error(String(res.status));
    return { user: await res.json(), online: true };
  } catch {
    return { user: cachedUser(), online: false };
  }
}

async function startLogin() {
  const configResponse = await fetch('/gba/api/config');
  if (!configResponse.ok) throw new Error('Failed to fetch config');
  const config = await configResponse.json();
  const redirectUri = `${window.location.origin}/gba/api/auth/callback/google`;
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function fetchRoms() {
  const res = await fetch('/gba/api/roms');
  if (res.status === 401) { window.location.href = '/gba'; return null; }
  if (!res.ok) throw new Error('Failed to fetch roms');
  return res.json();
}

async function fetchStates(id) {
  if (state.states.has(id)) return state.states.get(id);
  try {
    const res = await fetch(`/gba/api/states/${encodeURIComponent(id)}`);
    if (!res.ok) return [];
    const list = await res.json();
    state.states.set(id, list);
    updateRom(id, { stateCount: list.length, lastStateAt: list[0]?.createdAt || null });
    return list;
  } catch {
    return [];
  }
}

// small queue so a big library doesn't fire 200 requests at once
const stateQueue = [];
let stateActive = 0;
function queueStates(id, cb) {
  stateQueue.push([id, cb]);
  pumpStates();
}
function pumpStates() {
  while (stateActive < 4 && stateQueue.length) {
    const [id, cb] = stateQueue.shift();
    stateActive += 1;
    fetchStates(id).then(cb).finally(() => { stateActive -= 1; pumpStates(); });
  }
}

// SRAM that couldn't reach the cloud (offline) is retried from this device's copy.
async function flushPendingSaves() {
  const pending = Object.entries(allRomMeta()).filter(([, m]) => m.sramPending);
  for (const [id] of pending) {
    try {
      const save = await idbGet('sram', id);
      if (!save) { updateRom(id, { sramPending: false }); continue; }
      const gz = await gzipBytes(save instanceof Uint8Array ? save : new Uint8Array(save));
      const res = await fetch(`/gba/api/sram/${encodeURIComponent(id)}`, {
        method: 'PUT', body: gz, headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (res.ok) updateRom(id, { sramPending: false, sramSyncedAt: Date.now() });
    } catch { /* still offline */ }
  }
}

// ---------------------------------------------------------------- sync pill
function setSync(kind, text) {
  els.sync.dataset.state = kind;
  const label = els.syncLabel;
  if (label.textContent === text) return;
  if (reducedMotion()) { label.textContent = text; return; }
  gsap.to(label, {
    opacity: 0, filter: 'blur(3px)', duration: 0.12, ease: 'power1.in',
    onComplete: () => {
      label.textContent = text;
      gsap.to(label, { opacity: 1, filter: 'blur(0px)', duration: 0.22, ease: 'power2.out', clearProps: 'filter' });
    },
  });
}

function syncSummary() {
  const pending = Object.values(allRomMeta()).filter((m) => m.sramPending).length;
  if (!state.online) {
    const n = state.roms.filter((r) => state.offline.has(r.id)).length;
    setSync('offline', n ? `Offline · ${n} downloaded` : 'Offline');
    return;
  }
  if (pending) { setSync('syncing', `${pending} save${pending === 1 ? '' : 's'} waiting`); return; }
  setSync('synced', 'Drive synced');
}

// ---------------------------------------------------------------- ambient light
let ambientIdx = 0;
function setAmbient(color) {
  if (!color) return;
  const [a, b] = els.ambient;
  const next = ambientIdx === 0 ? b : a;
  const prev = ambientIdx === 0 ? a : b;
  next.style.setProperty('--c', rgb(color));
  next.classList.add('on');
  prev.classList.remove('on');
  ambientIdx = 1 - ambientIdx;
  document.documentElement.style.setProperty('--glow', rgb(color));
}

// ---------------------------------------------------------------- art
function artMarkup(rom, { lazy = true } = {}) {
  const { name } = displayTitle(rom.title);
  return `
    <div class="art" style="--glow:${rgb(romMeta(rom.id).color || hashColor(rom.title))}">
      <div class="art-clip">
        <img alt="" ${lazy ? 'loading="lazy"' : ''} decoding="async" draggable="false" style="opacity:0" data-src="${esc(rom.coverUrl || `/gba/api/cover?title=${encodeURIComponent(rom.title)}`)}">
        <div class="art-fallback" hidden><span class="glyph">${esc(name.replace(/^the /i, '').charAt(0))}</span><b>${esc(name)}</b></div>
      </div>
    </div>`;
}

// Loads the cover, samples its light, and resolves it in with the pixel reveal when visible.
function hydrateArt(root, rom, { reveal = true, delay = 0 } = {}) {
  const art = root.querySelector('.art');
  const img = art.querySelector('img');
  const fallback = art.querySelector('.art-fallback');
  return new Promise((resolve) => {
    img.onload = async () => {
      try { await img.decode(); } catch { /* already decoded or broken */ }
      const color = sampleColor(img);
      if (color) {
        art.style.setProperty('--glow', rgb(color));
        if (rgb(romMeta(rom.id).color) !== rgb(color)) updateRom(rom.id, { color });
      }
      if (reveal) pixelReveal(img, { delay }).then(resolve);
      else { img.style.opacity = '1'; resolve(); }
    };
    img.onerror = () => {
      img.remove();
      fallback.hidden = false;
      resolve();
    };
    img.src = img.dataset.src;
  });
}

// ---------------------------------------------------------------- game tile
function tileSub(rom) {
  const m = romMeta(rom.id);
  if (m.lastPlayed) return `<p class="sub played">Played ${esc(ago(m.lastPlayed))}</p>`;
  return `<p class="sub">${state.offline.has(rom.id) ? 'Downloaded' : 'Not played yet'}</p>`;
}

function badgesMarkup(rom) {
  const m = romMeta(rom.id);
  const out = [];
  const count = state.states.get(rom.id)?.length ?? m.stateCount;
  if (count) out.push(`<span class="badge" title="${count} save state${count === 1 ? '' : 's'}">${icon('saveFill')}<span class="num">${count}</span></span>`);
  if (state.offline.has(rom.id)) out.push(`<span class="badge offline" title="Downloaded to this device">${icon('downloaded')}</span>`);
  return out.join('');
}

function tile(rom) {
  const { name } = displayTitle(rom.title);
  const el = document.createElement('article');
  el.className = 'game';
  el.dataset.id = rom.id;
  el.innerHTML = `
    <a class="game-link" href="${playUrl(rom.id)}" aria-label="Play ${esc(name)}">
      ${artMarkup(rom)}
      <div class="meta"><h3 class="title">${esc(name)}</h3>${tileSub(rom)}</div>
    </a>
    <button class="more" type="button" aria-label="Details and saves for ${esc(name)}">${icon('more')}</button>`;
  el.querySelector('.art').insertAdjacentHTML('beforeend', `<div class="badges">${badgesMarkup(rom)}</div>`);
  el.querySelector('.more').addEventListener('click', (e) => { e.preventDefault(); openGame(rom, el); });
  el.querySelector('.game-link').addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    sfx('tap');
    haptic(6);
  });
  el.addEventListener('contextmenu', (e) => {
    if (!window.matchMedia('(hover: none)').matches) return;
    e.preventDefault();
    openGame(rom, el);
  });
  attachTilt(el);
  return el;
}

function refreshTile(el) {
  const rom = state.roms.find((r) => r.id === el.dataset.id);
  if (!rom) return;
  const badges = el.querySelector('.badges');
  if (badges) badges.innerHTML = badgesMarkup(rom);
  const sub = el.querySelector('.sub');
  if (sub) sub.outerHTML = tileSub(rom);
}

// subtle 3D tilt following the pointer (desktop only)
function attachTilt(el) {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches || reducedMotion()) return;
  const art = el.querySelector('.art');
  const rx = gsap.quickTo(art, 'rotationX', { duration: 0.5, ease: 'power3' });
  const ry = gsap.quickTo(art, 'rotationY', { duration: 0.5, ease: 'power3' });
  let rect = null;
  el.addEventListener('pointerenter', () => { rect = art.getBoundingClientRect(); });
  el.addEventListener('pointermove', (e) => {
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    ry(x * 10);
    rx(-y * 10);
  });
  el.addEventListener('pointerleave', () => { rect = null; rx(0); ry(0); });
}

// ---------------------------------------------------------------- hero
function renderHero(rom) {
  if (!rom) { els.hero.hidden = true; return null; }
  const m = romMeta(rom.id);
  const fresh = !m.lastPlayed;
  const { name, tags } = displayTitle(rom.title);
  els.hero.hidden = false;
  els.hero.innerHTML = `
    <div class="hero-visual">
      ${artMarkup(rom, { lazy: false })}
      <div class="hero-shot" hidden><img alt="Where you left off"></div>
    </div>
    <div class="hero-copy">
      <h1 class="hero-title">${esc(name)}</h1>
      ${tags.length ? `<div class="hero-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="hero-facts">
        ${fresh ? `<span>${icon('drive')}In your Drive, not played yet</span>` : `<span>${icon('clock')}Played ${esc(ago(m.lastPlayed))}</span>`}
        ${playtime(m.playMs) ? `<span>${esc(playtime(m.playMs))}</span>` : ''}
      </div>
      <div class="hero-actions">
        <a class="btn primary" href="${playUrl(rom.id)}">${icon('play')}${fresh ? 'Play' : 'Continue'}</a>
        <button class="btn ghost" type="button" data-hero-more>${icon('stack')}${fresh ? 'Details' : 'Saves'}</button>
      </div>
    </div>`;
  els.hero.querySelector('[data-hero-more]').addEventListener('click', (e) => openGame(rom, els.hero, e.currentTarget));
  setAmbient(m.color || hashColor(rom.title));
  idbGet('thumbs', `${rom.id}:latest`).then((blob) => {
    if (!blob) return;
    const shot = els.hero.querySelector('.hero-shot');
    shot.querySelector('img').src = URL.createObjectURL(blob);
    shot.hidden = false;
    if (!reducedMotion()) gsap.from(shot, { opacity: 0, y: 16, rotate: -2, duration: 0.6, ease: 'expo.out', delay: 0.55 });
  }).catch(() => {});
  return els.hero;
}

function animateHero(rom) {
  if (els.hero.hidden || !rom) return;
  const visual = els.hero.querySelector('.hero-visual');
  const title = els.hero.querySelector('.hero-title');
  const rest = els.hero.querySelectorAll('.hero-tags, .hero-facts, .hero-actions');
  hydrateArt(visual, rom, { reveal: true, delay: 120 }).then(() => {
    const c = visual.querySelector('.art').style.getPropertyValue('--glow');
    if (c) setAmbient(c.split(' ').map(Number));
  });
  if (reducedMotion()) return;
  const split = SplitText.create(title, { type: 'lines', mask: 'lines', linesClass: 'line' });
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from(visual, { opacity: 0, scale: 0.96, duration: 0.7 }, 0)
    .from(split.lines, { yPercent: 105, duration: 0.8, stagger: 0.07 }, 0.08)
    .from(rest, { opacity: 0, y: 14, duration: 0.6, stagger: 0.06 }, 0.3);
}

// ---------------------------------------------------------------- recent shelf
function renderRecent(heroId) {
  const known = new Map(state.roms.map((r) => [r.id, r]));
  const list = recentRoms(10).filter((r) => r.id !== heroId && known.has(r.id)).map((r) => known.get(r.id)).slice(0, 8);
  els.recent.hidden = !list.length;
  els.recentRow.replaceChildren(...list.map(tile));
  return $$('.game', els.recentRow);
}

// ---------------------------------------------------------------- grid + filtering
function matches(rom) {
  const q = state.query.trim().toLowerCase();
  if (q && !displayTitle(rom.title).name.toLowerCase().includes(q) && !rom.title.toLowerCase().includes(q)) return false;
  const m = romMeta(rom.id);
  if (state.filter === 'recent') return !!m.lastPlayed;
  if (state.filter === 'saves') return !!(state.states.get(rom.id)?.length ?? m.stateCount);
  if (state.filter === 'offline') return state.offline.has(rom.id);
  return true;
}

function sortedRoms() {
  const list = [...state.roms];
  if (state.filter === 'recent') {
    return list.sort((a, b) => (romMeta(b.id).lastPlayed || 0) - (romMeta(a.id).lastPlayed || 0));
  }
  return list.sort((a, b) => displayTitle(a.title).name.localeCompare(displayTitle(b.title).name));
}

let tiles = new Map();

function renderGrid() {
  tiles = new Map();
  const frag = document.createDocumentFragment();
  for (const rom of sortedRoms()) {
    const t = tile(rom);
    tiles.set(rom.id, t);
    frag.appendChild(t);
  }
  els.grid.replaceChildren(frag);
  applyFilter(false);
  revealTiles([...tiles.values()]);
}

function applyFilter(animateIt = true) {
  const order = sortedRoms();
  const doFlip = animateIt && !reducedMotion() && tiles.size < 160;
  const flipState = doFlip ? Flip.getState([...tiles.values()]) : null;
  let shown = 0;
  for (const rom of order) {
    const t = tiles.get(rom.id);
    if (!t) continue;
    const ok = matches(rom);
    t.classList.toggle('is-out', !ok);
    if (ok) shown += 1;
    els.grid.appendChild(t);
  }
  els.count.textContent = state.query || state.filter !== 'all'
    ? `${shown} of ${state.roms.length}`
    : `${state.roms.length} game${state.roms.length === 1 ? '' : 's'}`;
  renderEmpty(shown);
  if (doFlip) {
    Flip.from(flipState, {
      duration: 0.42,
      ease: 'expo.out',
      absolute: true,
      scale: false,
      stagger: 0.012,
      onEnter: (els2) => gsap.fromTo(els2, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.36, ease: 'expo.out', stagger: 0.015 }),
      onLeave: (els2) => gsap.to(els2, { opacity: 0, scale: 0.94, duration: 0.18 }),
    });
  }
}

function renderEmpty(shown) {
  if (shown) { els.empty.hidden = true; return; }
  els.empty.hidden = false;
  if (!state.roms.length) {
    els.empty.innerHTML = state.online
      ? `<strong>Your shelf is empty</strong><p>Add .gba files to your games folder in Google Drive, then refresh.</p><button class="btn ghost small" type="button" data-refresh>${icon('refresh')}Refresh</button>`
      : '<strong>Offline</strong><p>Connect once to load your library from Drive. Downloaded games stay playable afterwards.</p>';
    els.empty.querySelector('[data-refresh]')?.addEventListener('click', () => loadLibrary(true));
    return;
  }
  const labels = {
    recent: ['Nothing played yet', 'Games you start show up here.'],
    saves: ['No save states yet', 'Save states you make in a game appear here.'],
    offline: ['No downloaded games', 'Any game you play is kept on this device so it works offline.'],
  };
  const [title, body] = state.query
    ? [`No games match “${esc(state.query)}”`, 'Check the spelling, or clear the search.']
    : labels[state.filter] || ['No games', ''];
  els.empty.innerHTML = `<strong>${title}</strong><p>${body}</p>`;
}

// One observer does both jobs: fade tiles in as they arrive and load their art.
// (Cheaper than a scroll-driven trigger per tile: nothing runs while scrolling between rows.)
function revealTiles(list) {
  const motion = !reducedMotion();
  if (motion) gsap.set(list, { opacity: 0, y: 22 });
  const io = new IntersectionObserver((entries) => {
    const arriving = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    arriving.forEach((t, i) => {
      io.unobserve(t);
      const rom = state.roms.find((r) => r.id === t.dataset.id);
      if (!rom) return;
      hydrateArt(t, rom, { delay: 60 + i * 45 });
      if (state.online) queueStates(rom.id, () => refreshTile(t));
    });
    if (motion && arriving.length) {
      gsap.to(arriving, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.045, overwrite: true, clearProps: 'transform' });
    }
  }, { rootMargin: '0px 0px -4% 0px' });
  list.forEach((t) => io.observe(t));
}

// segmented control thumb
function moveThumb(btn, instant = false) {
  const thumb = els.filters.querySelector('.seg-thumb');
  const x = btn.offsetLeft;
  const w = btn.offsetWidth;
  if (instant || reducedMotion()) gsap.set(thumb, { x, width: w });
  else gsap.to(thumb, { x, width: w, duration: 0.42, ease: 'expo.out' });
}

function setupTools() {
  let t;
  els.search.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.query = els.search.value; applyFilter(); }, 90);
  });
  els.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { els.search.value = ''; state.query = ''; applyFilter(); els.search.blur(); }
    if (e.key === 'Enter') {
      const first = $('.game:not(.is-out) .game-link', els.grid)[0];
      if (first) first.click();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== els.search && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      els.search.focus();
    }
  });
  els.filters.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-filter]');
    if (!btn || btn.getAttribute('aria-selected') === 'true') return;
    $$('button', els.filters).forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    state.filter = btn.dataset.filter;
    moveThumb(btn);
    sfx('tap');
    applyFilter();
  });
  requestAnimationFrame(() => moveThumb(els.filters.querySelector('[aria-selected="true"]'), true));
  window.addEventListener('resize', () => moveThumb(els.filters.querySelector('[aria-selected="true"]'), true));
}

// ---------------------------------------------------------------- game sheet
async function openGame(rom, sourceEl, trigger) {
  const { name, tags } = displayTitle(rom.title);
  const m = romMeta(rom.id);
  const offline = state.offline.has(rom.id);
  const sheet = els.gameSheet;
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <button class="icon-btn gs-close" type="button" aria-label="Close">${icon('close')}</button>
    <div class="gs">
      <div>${artMarkup(rom, { lazy: false })}</div>
      <div data-stagger>
        <h2 class="gs-title" id="gs-title">${esc(name)}</h2>
        ${tags.length ? `<div class="hero-tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="gs-actions">
          <a class="btn primary" href="${playUrl(rom.id)}">${icon('play')}${m.lastPlayed ? 'Continue' : 'Play'}</a>
        </div>
        <section class="gs-section">
          <h3>Save states</h3>
          <div class="states" id="gs-states"><p class="muted">Loading…</p></div>
        </section>
        <section class="gs-section">
          <h3>Sync</h3>
          <div class="facts">
            <div class="fact">${icon('cloudCheck')}<span>${saveLine(m)}</span></div>
            <div class="fact" id="gs-offline">${offlineLine(rom, offline)}</div>
            <div class="fact">${icon('drive')}<span>Google Drive <b class="num">${esc(bytes(rom.size))}</b></span></div>
            ${m.playMs ? `<div class="fact">${icon('clock')}<span>${esc(playtime(m.playMs))} on this device</span></div>` : ''}
          </div>
        </section>
      </div>
    </div>`;
  sheet.style.setProperty('--glow', rgb(m.color || hashColor(rom.title)));
  hydrateArt(sheet, rom, { reveal: false });
  sheet.querySelector('.gs-close').addEventListener('click', () => closeSheet(sheet));
  bindOfflineButton(rom, sheet);
  openSheet(sheet, { from: trigger || sourceEl?.querySelector('.art') || sourceEl });

  const list = state.online ? await fetchStates(rom.id) : [];
  const host = sheet.querySelector('#gs-states');
  if (!host) return;
  if (!list.length) {
    host.innerHTML = `<p class="muted">${state.online ? 'None yet. In a game, use Save state or let autosave make one every minute.' : 'Connect to see your cloud save states.'}</p>`;
    return;
  }
  host.innerHTML = list.map((s) => `
    <a class="state" href="${playUrl(rom.id, `&state=${encodeURIComponent(s.id)}`)}">
      <div class="state-shot" data-thumb="${esc(rom.id)}:${esc(s.id)}"></div>
      <div><strong>${esc(clockTime(s.createdAt))}</strong><small>${esc(ago(s.createdAt))}</small></div>
      <span class="go">${icon('caretRight')}</span>
    </a>`).join('');
  $$('[data-thumb]', host).forEach(async (el) => {
    const blob = await idbGet('thumbs', el.dataset.thumb).catch(() => null);
    if (blob) el.innerHTML = `<img alt="" src="${URL.createObjectURL(blob)}">`;
  });
  if (!reducedMotion()) gsap.from(host.children, { opacity: 0, y: 8, duration: 0.4, ease: 'expo.out', stagger: 0.04 });
  if (sourceEl?.classList?.contains('game')) refreshTile(sourceEl);
}

function saveLine(m) {
  if (m.sramPending) return '<b class="warn">In-game save waiting to sync</b>';
  if (m.sramSyncedAt) return `In-game save synced <b>${esc(ago(m.sramSyncedAt))}</b>`;
  return 'In-game saves sync to the cloud as you play';
}

function offlineLine(rom, offline) {
  return offline
    ? `${icon('downloaded', 'ok')}<span>Downloaded to this device</span><button class="btn quiet small" type="button" data-offline="remove">Remove</button>`
    : `${icon('download')}<span>Streams from Drive</span><button class="btn ghost small" type="button" data-offline="get" ${state.online ? '' : 'disabled'}>Download</button>`;
}

function bindOfflineButton(rom, sheet) {
  const host = sheet.querySelector('#gs-offline');
  host.querySelector('[data-offline]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.offline === 'remove') {
      await idbDelete('roms', rom.id).catch(() => {});
      state.offline.delete(rom.id);
      toast('Download removed');
    } else {
      btn.disabled = true;
      try {
        await downloadRom(rom, (p) => { btn.textContent = `${p}%`; });
        state.offline.add(rom.id);
        toast('Ready offline');
        sfx('toggleOn');
      } catch {
        toast('Download failed. Check your connection.', { kind: 'err' });
        sfx('error');
      }
    }
    host.innerHTML = offlineLine(rom, state.offline.has(rom.id));
    bindOfflineButton(rom, sheet);
    const t = tiles.get(rom.id);
    if (t) refreshTile(t);
    syncSummary();
  });
}

// Same endpoint and IndexedDB slot the play page uses.
async function downloadRom(rom, onProgress) {
  const res = await fetch(`/gba/api/rom/${encodeURIComponent(rom.id)}`);
  if (!res.ok) throw new Error(String(res.status));
  const total = Number(res.headers.get('content-length') || rom.size || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) onProgress(Math.min(100, Math.round((received / total) * 100)));
  }
  const out = new Uint8Array(received);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  await idbSet('roms', rom.id, out.buffer);
}

// ---------------------------------------------------------------- account sheet
function openAccount() {
  const u = state.user || {};
  const p = prefs();
  const sheet = els.accountSheet;
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2 id="acct-title">Account</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="sheet-body" data-stagger>
      <div class="acct-user"><span class="avatar">${avatarInner(u)}</span><div><strong>${esc(u.name || 'Signed in')}</strong><small>Google account</small></div></div>
      <button class="row" type="button" role="switch" aria-checked="${p.sound}" data-pref="sound">${icon('speaker')}<span>Interface sounds</span><i class="switch"></i></button>
      <button class="row" type="button" role="switch" aria-checked="${p.haptics}" data-pref="haptics">${icon('vibrate')}<span>Haptics</span><i class="switch"></i></button>
      ${installPrompt ? `<button class="row" type="button" data-install>${icon('install')}<span>Install as an app</span></button>` : ''}
      <button class="row danger" type="button" data-signout>${icon('signOut')}<span>Sign out</span></button>
    </div>`;
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet(sheet));
  $$('[data-pref]', sheet).forEach((row) => row.addEventListener('click', () => {
    const on = row.getAttribute('aria-checked') !== 'true';
    row.setAttribute('aria-checked', String(on));
    setPref(row.dataset.pref, on);
    sfx(on ? 'toggleOn' : 'toggleOff');
    if (on && row.dataset.pref === 'haptics') haptic(12);
  }));
  sheet.querySelector('[data-install]')?.addEventListener('click', async () => {
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    closeSheet(sheet);
  });
  sheet.querySelector('[data-signout]').addEventListener('click', async () => {
    await fetch('/gba/api/auth/logout', { method: 'POST' }).catch(() => {});
    cacheUser(null);
    window.location.href = '/gba';
  });
  openSheet(sheet, { from: els.account });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

function avatarInner(u) {
  if (u.picture) return `<img alt="" src="${esc(u.picture)}" referrerpolicy="no-referrer">`;
  return esc((u.name || '?').trim().charAt(0).toUpperCase());
}

// ---------------------------------------------------------------- signed-out: the LCD boot
const SHELLS = [
  [118, 104, 255], // indigo
  [255, 84, 170], // fuchsia
  [94, 200, 255], // glacier
  [255, 140, 64], // spice
];
const FONT = {
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
};

function bootScreen(canvas) {
  const COLS = 60; const ROWS = 40;
  const g = canvas.getContext('2d');
  const logo = new Set();
  const S = 3; const gap = 3;
  const word = 'GBA';
  const wordW = word.length * 5 * S + (word.length - 1) * gap;
  const ox = Math.floor((COLS - wordW) / 2); const oy = Math.floor((ROWS - 7 * S) / 2);
  [...word].forEach((ch, li) => FONT[ch].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit !== '1') return;
    for (let dy = 0; dy < S; dy += 1) for (let dx = 0; dx < S; dx += 1) {
      logo.add((oy + y * S + dy) * COLS + ox + li * (5 * S + gap) + x * S + dx);
    }
  })));
  const cx = (COLS - 1) / 2; const cy = (ROWS - 1) / 2;
  const maxD = Math.hypot(cx, cy);
  const delay = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y += 1) for (let x = 0; x < COLS; x += 1) {
    delay[y * COLS + x] = Math.hypot(x - cx, y - cy) / maxD;
  }
  const s = { boot: reducedMotion() ? 1 : 0, logo: reducedMotion() ? 1 : 0, t: 0, px: -10, py: -10 };
  let W = 0; let H = 0; let cell = 0;
  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.width = Math.round(r.width * dpr);
    H = canvas.height = Math.round(r.height * dpr);
    cell = W / COLS;
    draw();
  };
  const outExpo = (x) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
  function draw() {
    if (!W) return;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const size = cell * 0.78;
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        const i = y * COLS + x;
        const p = outExpo(Math.max(0, Math.min(1, (s.boot * 1.5 - delay[i] * 0.9) / 0.6)));
        if (p <= 0.01) continue;
        const isLogo = logo.has(i);
        const v = (Math.sin(x * 0.16 + s.t * 0.9) + Math.sin(y * 0.21 - s.t * 0.7) + Math.sin((x + y) * 0.09 + s.t * 0.5)) / 3;
        const d = Math.hypot(x - s.px, y - s.py);
        const lift = Math.max(0, 1 - d / 9);
        const k = ((v + 1) / 2) * (SHELLS.length - 1);
        const a = SHELLS[Math.floor(k)]; const b = SHELLS[Math.min(SHELLS.length - 1, Math.floor(k) + 1)];
        const f = k - Math.floor(k);
        let r = a[0] + (b[0] - a[0]) * f; let gg = a[1] + (b[1] - a[1]) * f; let bb = a[2] + (b[2] - a[2]) * f;
        let alpha = (0.3 + lift * 0.5) * p;
        if (isLogo) {
          const lp = outExpo(Math.max(0, Math.min(1, s.logo * 1.6 - (x / COLS) * 0.6)));
          r += (255 - r) * lp; gg += (255 - gg) * lp; bb += (255 - bb) * lp;
          alpha = Math.max(alpha, lp);
        }
        g.globalAlpha = alpha;
        g.fillStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
        const sz = size * (0.4 + 0.6 * p);
        g.fillRect(x * cell + (cell - sz) / 2, y * cell + (cell - sz) / 2, sz, sz);
      }
    }
    g.globalAlpha = 1;
  }
  resize();
  new ResizeObserver(resize).observe(canvas);
  canvas.parentElement.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    s.px = ((e.clientX - r.left) / r.width) * COLS;
    s.py = ((e.clientY - r.top) / r.height) * ROWS;
  });
  canvas.parentElement.addEventListener('pointerleave', () => { s.px = -10; s.py = -10; });
  if (reducedMotion()) { draw(); return; }
  animate(s, { boot: 1, duration: 1300, ease: 'outQuad', onUpdate: draw });
  animate(s, { logo: 1, duration: 700, delay: 750, ease: 'outQuad', onUpdate: draw });
  // gentle idle shimmer at 30fps, paused whenever it can't be seen
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  createTimer({
    frameRate: 30,
    onUpdate: (timer) => {
      if (!visible || document.hidden) return;
      s.t = timer.currentTime / 1000;
      draw();
    },
  });
}

function showSignedOut() {
  els.signedOut.hidden = false;
  els.login.innerHTML = `${icon('google')}Sign in with Google`;
  els.login.addEventListener('click', () => {
    sfx('tap');
    startLogin().catch(() => toast('Couldn’t start Google sign-in. Try again.', { kind: 'err' }));
  });
  bootScreen($('#boot-canvas'));
  if (reducedMotion()) return;
  const split = SplitText.create('#welcome-title', { type: 'lines', mask: 'lines', linesClass: 'line' });
  gsap.timeline({ defaults: { ease: 'expo.out' } })
    .from('.welcome-screen', { opacity: 0, scale: 0.97, duration: 0.9 }, 0)
    .from(split.lines, { yPercent: 105, duration: 0.9, stagger: 0.08 }, 0.25)
    .from('.welcome-sub, .welcome-actions', { opacity: 0, y: 14, duration: 0.7, stagger: 0.08 }, 0.55);
}

// ---------------------------------------------------------------- load
function skeleton(n = 10) {
  els.grid.innerHTML = Array.from({ length: n }, () => '<div class="game skeleton"><div class="art"><div class="art-clip"></div></div><div class="meta"><div class="title"></div><div class="sub"></div></div></div>').join('');
}

async function loadLibrary(force = false) {
  const cached = cachedLibrary();
  if (cached && !force) state.roms = cached.roms;
  if (!state.roms.length) skeleton();
  setSync(state.online ? 'syncing' : 'offline', state.online ? 'Syncing with Drive' : 'Offline');
  if (state.online) {
    try {
      const roms = await fetchRoms();
      if (!roms) return;
      state.roms = roms;
      cacheLibrary(roms);
      flushPendingSaves().then(syncSummary);
    } catch {
      if (!state.roms.length) {
        setSync('error', 'Drive unavailable');
        els.grid.innerHTML = '';
        els.empty.hidden = false;
        els.empty.innerHTML = `<strong>Couldn’t reach Google Drive</strong><p>Your library didn’t load. Check your connection and try again.</p><button class="btn ghost small" type="button" data-retry>${icon('refresh')}Try again</button>`;
        els.empty.querySelector('[data-retry]').addEventListener('click', () => loadLibrary(true));
        return;
      }
      state.online = false;
    }
  }
  state.offline = new Set(await idbKeys('roms').catch(() => []));
  syncSummary();

  const recent = recentRoms(1).find((r) => state.roms.some((x) => x.id === r.id));
  // the last game you played, or (first visit) a pick of the day from your shelf
  const pool = state.roms;
  const daily = pool.length ? pool[Math.floor(Date.now() / 86_400_000) % pool.length] : null;
  const heroRom = (recent && state.roms.find((r) => r.id === recent.id)) || daily;
  renderHero(heroRom);
  const shelfTiles = renderRecent(heroRom?.id);
  renderGrid();
  animateHero(heroRom);
  shelfTiles.forEach((t, i) => {
    const rom = state.roms.find((r) => r.id === t.dataset.id);
    hydrateArt(t, rom, { delay: 200 + i * 60 });
  });
  if (!reducedMotion() && shelfTiles.length) {
    gsap.from(shelfTiles, { opacity: 0, x: 24, duration: 0.8, ease: 'expo.out', stagger: 0.05, delay: 0.25, clearProps: 'transform' });
  }
  if (!els.hero.hidden) return;
  // no history yet: let the first card's colour light the page
  const first = state.roms[0];
  if (first) setAmbient(romMeta(first.id).color || hashColor(first.title));
}

async function init() {
  setupTopbar();
  const { user, online } = await me();
  state.online = online;
  if (!user) {
    if (!online) {
      els.signedOut.hidden = false;
      $('#welcome-title').textContent = 'You’re offline';
      $('.welcome-sub').textContent = 'Sign in needs a connection. Once you’re signed in, downloaded games work offline too.';
      $('.welcome-actions').hidden = true;
      bootScreen($('#boot-canvas'));
      return;
    }
    showSignedOut();
    return;
  }
  state.user = user;
  if (online) cacheUser(user);
  els.topActions.hidden = false;
  els.avatar.innerHTML = avatarInner(user);
  els.signedIn.hidden = false;
  setupTools();
  await loadLibrary();
  if (!reducedMotion()) gsap.from(els.topActions, { opacity: 0, duration: 0.5, ease: 'power2.out' });
}

function setupTopbar() {
  ScrollTrigger.create({
    start: 8,
    end: 'max',
    onToggle: (self) => els.top.classList.toggle('is-scrolled', self.isActive),
  });
  els.account.addEventListener('click', openAccount);
  els.sync.addEventListener('click', () => {
    if (els.sync.dataset.state === 'syncing') return;
    sfx('tap');
    state.states.clear();
    if (navigator.onLine) state.online = true;
    loadLibrary(true);
  });
  window.addEventListener('online', () => { state.online = true; loadLibrary(true); });
  window.addEventListener('offline', () => { state.online = false; syncSummary(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted && state.user) loadLibrary(true); });
}

init();

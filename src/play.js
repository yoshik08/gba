import { gsap } from 'gsap';
import { gunzipBytes, gzipBytes } from './gzip.js';
import { idbGet, idbSet } from './idb.js';
import { icon } from './lib/icons.js';
import { ago, cachedLibrary, cachedUser, clockTime, displayTitle, prefs, romMeta, setPref, updateRom } from './lib/meta.js';
import { hashColor, reducedMotion } from './lib/color.js';
import { closeSheet, openSheet, toast } from './lib/ui.js';
import { haptic, sfx, useAudioContext } from './lib/sfx.js';
import { libraryUrl, registerServiceWorker } from './lib/pwa.js';
import { KEY_MAP, createInput } from './play/input.js';

registerServiceWorker();

const $ = (s) => document.querySelector(s);
const app = $('#app');
const canvas = $('#canvas');
const screenEl = $('#screen');
const statusEl = $('#status');
const els = {
  loading: $('#loading'),
  loadingTitle: $('#loading-title'),
  loadingLabel: $('#loading-label'),
  meter: $('#meter-fill'),
  start: $('#start'),
  paused: $('#paused'),
  error: $('#error'),
  errorTitle: $('#error-title'),
  errorLabel: $('#error-label'),
  flash: $('#flash'),
  ffBadge: $('#ff-badge'),
  ff: $('#ff'),
  saveBtn: $('#save-btn'),
  back: $('#back'),
  menuSheet: $('#menu-sheet'),
  helpSheet: $('#help-sheet'),
  cheatSheet: $('#cheat-sheet'),
};

$('#back').innerHTML = icon('back');
els.saveBtn.innerHTML = icon('save');
$('#help-btn').innerHTML = icon('help');
$('#menu-btn').innerHTML = icon('more');
$('.ff-icon').innerHTML = icon('ff');
$('#paused-icon').innerHTML = icon('pause');

const params = new URLSearchParams(window.location.search);
const romId = params.get('id') || params.get('rom');
const startStateId = params.get('state');

let emu = null;
let input = null;
let romName = 'game.gba';
let playedSinceState = false;
let sramTimer = null;
let fastForward = false;
let holdFF = false;
let romBytesCache = null;
let saveEvents = 0;
let frameEvents = 0;

// ------------------------------------------------------------------ run state
// The game runs only when it has been started and nothing asks it to pause.
// Reasons: 'hidden' (tab in background), 'sheet' (a menu is open), 'audio' (needs a tap to resume).
let phase = 'loading'; // loading → ready → playing, or error
let running = false;
const pauseReasons = new Set();
let runStartedAt = 0;

function applyRunState() {
  if (!emu || phase !== 'playing') return;
  const shouldRun = pauseReasons.size === 0;
  els.paused.hidden = !pauseReasons.has('audio');
  if (shouldRun === running) return;
  if (shouldRun) {
    emu.resumeGame();
    running = true;
    runStartedAt = performance.now();
    input.enable(true);
  } else {
    input.releaseAll();
    input.enable(false);
    emu.pauseGame();
    running = false;
    accumulatePlaytime();
  }
}

function setPaused(reason, on) {
  if (on) pauseReasons.add(reason); else pauseReasons.delete(reason);
  applyRunState();
}

function accumulatePlaytime() {
  if (!runStartedAt) return;
  const ms = performance.now() - runStartedAt;
  runStartedAt = running ? performance.now() : 0;
  const m = romMeta(romId);
  updateRom(romId, { playMs: (m.playMs || 0) + ms, lastPlayed: Date.now() });
}

// ------------------------------------------------------------------ status line + toasts
let statusTimer = null;
function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = `bar-status ${kind}`;
  clearTimeout(statusTimer);
  if (kind === 'ok') statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 4000);
}
const hhmm = () => new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// ------------------------------------------------------------------ network (same API as before)
async function requireSession() {
  try {
    const res = await fetch('/gba/api/me');
    if (!res.ok) {
      window.location.href = '/gba';
      return false;
    }
    return true;
  } catch {
    // offline: allowed if this device has signed in before and has the game
    return !!cachedUser();
  }
}

function asFile(name, bytes) {
  return new File([bytes], name);
}

function upload(fn, file) {
  return new Promise((resolve) => fn(file, resolve));
}

async function fetchBinary(url) {
  const res = await fetch(url, { keepalive: false });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

function setProgress(pct, label) {
  els.meter.style.transform = `scaleX(${Math.max(0.02, pct / 100)})`;
  if (label) els.loadingLabel.textContent = label;
}

async function downloadRom() {
  const cached = await idbGet('roms', romId);
  if (cached) return new Uint8Array(cached);

  setProgress(2, 'Downloading from Drive');
  const res = await fetch(`/gba/api/rom/${encodeURIComponent(romId)}`, { keepalive: false });
  if (!res.ok) throw new Error(`Failed to fetch ROM (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total) {
      const pct = Math.round((received / total) * 100);
      setProgress(pct, `Downloading from Drive · ${pct}%`);
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await idbSet('roms', romId, bytes.buffer);
  return bytes;
}

async function putGzip(url, bytes, { keepalive = false } = {}) {
  const gz = await gzipBytes(bytes);
  const res = await fetch(url, {
    method: url.includes('/sram/') ? 'PUT' : 'POST',
    body: gz,
    keepalive: keepalive && gz.byteLength < 60_000,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

function saveName() {
  return romName.replace(/\.gba$/i, '.sav');
}

function stateName(slot) {
  return romName.replace(/\.gba$/i, `.ss${slot}`);
}

function readSave() {
  try {
    return emu.getSave();
  } catch {
    return null;
  }
}

async function pushSram({ keepalive = false } = {}) {
  clearTimeout(sramTimer);
  sramTimer = null;
  const save = readSave();
  if (!save || !save.byteLength) return;
  await idbSet('sram', romId, save);
  try {
    await putGzip(`/gba/api/sram/${encodeURIComponent(romId)}`, save, { keepalive });
    updateRom(romId, { sramSyncedAt: Date.now(), sramPending: false });
    setStatus(`Game saved to cloud · ${hhmm()}`, 'ok');
  } catch {
    updateRom(romId, { sramPending: true });
    setStatus('Saved on this device · will sync', 'warn');
  }
}

function scheduleSram() {
  clearTimeout(sramTimer);
  sramTimer = setTimeout(() => {
    pushSram().catch(() => {});
  }, 5000);
}

function coreVersion() {
  if (!emu?.version) return 'mgba-wasm';
  return `${emu.version.projectName} ${emu.version.projectVersion}`;
}

function readStateSlot(slot) {
  const path = `${emu.filePaths().saveStatePath}/${stateName(slot)}`;
  try {
    if (!emu.FS.analyzePath(path).exists) return null;
    return emu.FS.readFile(path);
  } catch {
    return null;
  }
}

// Screenshot of the current frame, kept on this device to illustrate save states.
function captureThumb() {
  try {
    const name = `thumb-${romId}.png`;
    if (!emu.screenshot(name)) return null;
    const path = `${emu.filePaths().screenshotsPath}/${name}`;
    const data = emu.FS.readFile(path);
    emu.FS.unlink(path);
    return new Blob([data], { type: 'image/png' });
  } catch {
    return null;
  }
}

let stateBusy = false;
async function pushState({ manual = false } = {}) {
  if (!emu || stateBusy) return;
  stateBusy = true;
  try {
    emu.saveState(0);
    const data = readStateSlot(0);
    if (!data) return;
    // screenshot in the next task, so it doesn't stack onto the snapshot's frame
    await new Promise((r) => setTimeout(r, 0));
    const thumb = captureThumb();
    await idbSet('states', `${romId}:latest`, data);
    if (thumb) idbSet('thumbs', `${romId}:latest`, thumb).catch(() => {});
    const gz = await gzipBytes(data);
    const res = await fetch(`/gba/api/states/${encodeURIComponent(romId)}`, {
      method: 'POST',
      body: gz,
      keepalive: false,
      headers: {
        'Content-Type': 'application/octet-stream',
        'x-core-version': coreVersion(),
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const saved = await res.json().catch(() => ({}));
    if (thumb && saved.id) idbSet('thumbs', `${romId}:${saved.id}`, thumb).catch(() => {});
    playedSinceState = false;
    updateRom(romId, { lastStateAt: Date.now() });
    if (manual) toast(`State saved · ${hhmm()}`);
    else setStatus(`Autosaved · ${hhmm()}`, 'ok');
  } catch {
    if (manual) toast('Couldn’t reach the cloud. Saved on this device.', { kind: 'warn' });
  } finally {
    stateBusy = false;
  }
}

async function fetchStates() {
  try {
    const res = await fetch(`/gba/api/states/${encodeURIComponent(romId)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function loadRemoteState(stateId) {
  const raw = await fetchBinary(`/gba/api/states/${encodeURIComponent(romId)}/${stateId}`);
  if (!raw) return false;
  const data = await gunzipBytes(raw);
  await upload(emu.uploadSaveOrSaveState.bind(emu), asFile(stateName(0), data));
  return emu.loadState(0);
}

// ------------------------------------------------------------------ cheats (unchanged format)
function romGameCode() {
  if (!romBytesCache || romBytesCache.length < 0xb0) return 'GAME';
  return String.fromCharCode(...romBytesCache.slice(0xac, 0xb0));
}

function parseCheats(text) {
  const cheats = [];
  let n = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    let name;
    let codePart;
    const colon = line.indexOf(':');
    if (colon > 0) {
      name = line.slice(0, colon).trim() || `Cheat ${n + 1}`;
      codePart = line.slice(colon + 1);
    } else {
      n += 1;
      name = `Cheat ${n}`;
      codePart = line;
    }
    const codes = codePart.trim().split(/\s+/).filter(Boolean);
    if (!codes.length) continue;
    if (!codes.every((c) => /^[0-9a-fA-F]{8}$/.test(c))) {
      throw new Error(`Bad code in "${name}" — use 8-hex-digit pairs`);
    }
    cheats.push({ name: name.slice(0, 64), codes });
  }
  return cheats;
}

function applyCheatText(text, { quiet = false } = {}) {
  const cheats = parseCheats(text);
  if (!cheats.length) {
    if (!quiet) toast('No cheats entered', { kind: 'warn' });
    return;
  }
  const body = cheats.map((c) => `[${c.name}]\ncodes=${c.codes.join(' ')}`).join('\n\n') + '\n';
  const file = new File([body], `${romGameCode()}.cheats`, { type: 'text/plain' });
  emu.uploadCheats(file, () => {
    let ok = false;
    try {
      ok = emu.autoLoadCheats();
    } catch {
      /* ignore */
    }
    if (!quiet) toast(ok ? `${cheats.length} cheat${cheats.length === 1 ? '' : 's'} on` : 'Cheats loaded');
  });
}

async function loadSavedCheats() {
  try {
    const saved = await idbGet('cheats', romId);
    if (saved && saved.byteLength) return new TextDecoder().decode(saved);
  } catch {
    /* ignore */
  }
  return '';
}

// ------------------------------------------------------------------ fast forward (2×)
function setFastForward(on, { fromHold = false } = {}) {
  if (!emu) return;
  const effective = on || holdFF;
  if (!fromHold) fastForward = on;
  emu.setFastForwardMultiplier(effective ? 2 : 1);
  els.ff.setAttribute('aria-pressed', String(effective));
  els.ffBadge.hidden = !effective;
  if (effective && !reducedMotion()) gsap.fromTo(els.ffBadge, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.24, ease: 'back.out(2)' });
}

function toggleFastForward() {
  setFastForward(!fastForward);
  sfx(fastForward ? 'toggleOn' : 'toggleOff');
  haptic(10);
}

// ------------------------------------------------------------------ screen sizing
// Fits 240×160 into the space left by the controls, snapping to whole-pixel scales when big.
function layout() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const landscape = w > h * 1.05;
  const touchOn = prefs().touchControls !== false;
  app.dataset.layout = landscape ? 'landscape' : 'portrait';
  app.classList.toggle('no-touch', !touchOn);
  const cs = getComputedStyle(app);
  const safeT = parseFloat(cs.paddingTop) || 0;
  const safeB = parseFloat(cs.paddingBottom) || 0;
  const safeL = parseFloat(cs.paddingLeft) || 0;
  const safeR = parseFloat(cs.paddingRight) || 0;
  const bar = 52;
  let availW;
  let availH;
  let dp;
  let fb;
  if (!touchOn) {
    availW = w - safeL - safeR - 32;
    availH = h - safeT - safeB - bar - 28;
    dp = 148; fb = 66;
  } else if (landscape) {
    const side = Math.max(170, Math.min(300, w * 0.24));
    dp = Math.round(Math.max(116, Math.min(side - 36, h * 0.34, 176)));
    fb = Math.round(Math.max(54, Math.min(dp * 0.46, 76)));
    availW = w - safeL - safeR - side * 2;
    availH = h - safeT - safeB - bar - 12;
  } else {
    dp = Math.round(Math.max(116, Math.min(w * 0.4, 164, h * 0.2)));
    fb = Math.round(Math.max(54, Math.min(dp * 0.46, 74)));
    const controls = 46 + dp + 24 + 62;
    availW = w - safeL - safeR - 24;
    availH = h - safeT - safeB - bar - controls - 14;
  }
  let scale = Math.max(0.5, Math.min(availW / 240, availH / 160));
  if (scale >= 3) scale = Math.floor(scale);
  else if (scale >= 2) scale = Math.floor(scale * 4) / 4;
  app.style.setProperty('--sw', `${Math.round(240 * scale)}px`);
  app.style.setProperty('--sh', `${Math.round(160 * scale)}px`);
  app.style.setProperty('--dp', `${dp}px`);
  app.style.setProperty('--fb', `${fb}px`);
}

// ------------------------------------------------------------------ overlays + juice
function showOverlay(which) {
  for (const k of ['loading', 'start', 'paused', 'error']) els[k].hidden = k !== which;
}

function powerOn() {
  sfx('boot');
  if (reducedMotion()) return;
  gsap.fromTo(canvas,
    { clipPath: 'inset(49.5% 0% 49.5% 0%)', filter: 'brightness(2.2)' },
    { clipPath: 'inset(0% 0% 0% 0%)', filter: 'brightness(1)', duration: 0.42, ease: 'expo.out', clearProps: 'clipPath,filter' });
}

function shutterFlash() {
  sfx('shutter');
  haptic(14);
  if (reducedMotion()) return;
  gsap.fromTo(els.flash, { opacity: 0.32 }, { opacity: 0, duration: 0.32, ease: 'power2.out' });
}

function fail(err, title = 'Couldn’t start this game') {
  phase = 'error';
  els.errorTitle.textContent = title;
  els.errorLabel.textContent = err?.message || String(err || '');
  showOverlay('error');
  sfx('error');
}

// ------------------------------------------------------------------ starting
async function resumeAudioContext(timeout = 600) {
  const ctx = emu?.SDL2?.audioContext;
  if (!ctx) return true;
  if (ctx.state === 'running') return true;
  try {
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, timeout))]);
  } catch {
    /* iOS may need a fresh gesture */
  }
  return ctx.state === 'running';
}

let starting = false;
// Returns true when this input was used to power the game on (so it isn't forwarded to the game).
function startFromGesture() {
  if (phase === 'playing') {
    if (pauseReasons.has('audio')) { resumeFromPrompt(); return true; }
    return false;
  }
  if (phase !== 'ready' || starting) return phase !== 'playing';
  starting = true;
  // resume must be called synchronously inside the gesture for iOS
  const ctx = emu.SDL2?.audioContext;
  try { ctx?.resume(); } catch { /* ignore */ }
  (async () => {
    await resumeAudioContext();
    useAudioContext(emu.SDL2?.audioContext);
    if (startStateId) {
      els.start.hidden = true;
      try {
        if (await loadRemoteState(startStateId)) toast('Save state loaded');
      } catch {
        toast('Couldn’t load that save state', { kind: 'warn' });
      }
      history.replaceState(null, '', `/gba/play?id=${encodeURIComponent(romId)}`);
    }
    showOverlay(null);
    phase = 'playing';
    updateRom(romId, { lastPlayed: Date.now() });
    powerOn();
    applyRunState();
    starting = false;
  })();
  return true;
}

async function resumeFromPrompt() {
  const ok = await resumeAudioContext();
  if (ok || !document.hidden) setPaused('audio', false);
}

// ------------------------------------------------------------------ tab switching, done right
// Hide: let go of every button, pause the core, quiet the audio, and save progress.
// Show: resume the audio clock first, then the core, so the first frame back has sound.
// If the browser won't restart audio without a tap (iOS), wait for one instead of running silent.
let lifecycleGen = 0;
function onHide() {
  lifecycleGen += 1;
  input?.releaseAll();
  if (holdFF) { holdFF = false; setFastForward(fastForward, { fromHold: true }); }
  if (phase !== 'playing') return;
  setPaused('hidden', true);
  try { emu.SDL2?.audioContext?.suspend(); } catch { /* ignore */ }
  if (sramTimer) pushSram({ keepalive: true }).catch(() => {});
  if (playedSinceState) pushState().catch(() => {});
}

async function onShow() {
  const gen = ++lifecycleGen;
  if (phase !== 'playing' || !pauseReasons.has('hidden')) return;
  const ok = await resumeAudioContext(500);
  if (gen !== lifecycleGen || document.hidden) return; // hidden again meanwhile
  if (!ok) pauseReasons.add('audio');
  setPaused('hidden', false);
}

document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
window.addEventListener('pagehide', onHide);
window.addEventListener('pageshow', (e) => { if (e.persisted) onShow(); });
document.addEventListener('freeze', onHide);
document.addEventListener('resume', onShow);
// Focus moving to another window doesn't hide the page, but its keyup events go elsewhere.
window.addEventListener('blur', () => input?.releaseAll());

// ------------------------------------------------------------------ sheets
function bindSheet(dialog) {
  openSheet(dialog, { onClose: () => setPaused('sheet', false) });
  setPaused('sheet', true);
}

async function openMenu() {
  const p = prefs();
  const sheet = els.menuSheet;
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2 id="menu-title">Paused</h2><button class="icon-btn" type="button" data-close aria-label="Resume">${icon('close')}</button></div>
    <div class="sheet-body" data-stagger>
      <h3 class="group">Save states</h3>
      <div class="states" id="menu-states"><p class="muted">Loading…</p></div>
      <div class="sheet-actions"><button class="btn ghost" type="button" data-act="save" ${phase === 'playing' ? '' : 'disabled'}>${icon('save')}Save state now</button></div>
      <h3 class="group">Play</h3>
      <div class="menu-list">
        <button class="row" type="button" role="switch" aria-checked="${fastForward}" data-act="ff">${icon('ff')}<span>Fast forward <small>2×</small></span><i class="switch"></i></button>
        <button class="row" type="button" role="switch" aria-checked="${p.touchControls !== false}" data-pref="touchControls">${icon('hand')}<span>On-screen controls</span><i class="switch"></i></button>
        <button class="row" type="button" role="switch" aria-checked="${p.sound}" data-pref="sound">${icon('speaker')}<span>Button sounds</span><i class="switch"></i></button>
        <button class="row" type="button" role="switch" aria-checked="${p.haptics}" data-pref="haptics">${icon('vibrate')}<span>Haptics</span><i class="switch"></i></button>
        <button class="row" type="button" data-act="cheats">${icon('code')}<span>Cheats</span>${icon('caretRight')}</button>
        <button class="row" type="button" data-act="help">${icon('help')}<span>Controls</span>${icon('caretRight')}</button>
        <button class="row" type="button" data-act="back">${icon('back')}<span>Back to library</span></button>
      </div>
    </div>`;
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet(sheet));
  sheet.querySelector('[data-act="save"]').addEventListener('click', async () => {
    await closeSheet(sheet);
    saveStateNow();
  });
  sheet.querySelector('[data-act="ff"]').addEventListener('click', (e) => {
    toggleFastForward();
    e.currentTarget.setAttribute('aria-checked', String(fastForward));
  });
  sheet.querySelectorAll('[data-pref]').forEach((row) => row.addEventListener('click', () => {
    const on = row.getAttribute('aria-checked') !== 'true';
    row.setAttribute('aria-checked', String(on));
    setPref(row.dataset.pref, on);
    sfx(on ? 'toggleOn' : 'toggleOff');
    if (row.dataset.pref === 'touchControls') { layout(); input?.remeasure(); }
  }));
  sheet.querySelector('[data-act="cheats"]').addEventListener('click', async () => { await closeSheet(sheet); openCheats(); });
  sheet.querySelector('[data-act="help"]').addEventListener('click', async () => { await closeSheet(sheet); openHelp(); });
  sheet.querySelector('[data-act="back"]').addEventListener('click', () => goBack());
  bindSheet(sheet);

  const list = await fetchStates();
  const host = sheet.querySelector('#menu-states');
  if (!host) return;
  if (!list) { host.innerHTML = '<p class="muted">Connect to see your cloud save states.</p>'; return; }
  if (!list.length) { host.innerHTML = '<p class="muted">No save states yet. Autosave makes one every minute while you play.</p>'; return; }
  host.innerHTML = '';
  list.slice(0, 3).forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'state';
    b.innerHTML = `<div class="state-shot"></div><div><strong></strong><small></small></div>${icon('caretRight')}`;
    b.querySelector('strong').textContent = clockTime(s.createdAt);
    b.querySelector('small').textContent = ago(s.createdAt);
    idbGet('thumbs', `${romId}:${s.id}`).then((blob) => {
      if (blob) b.querySelector('.state-shot').innerHTML = `<img alt="" src="${URL.createObjectURL(blob)}">`;
    }).catch(() => {});
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const ok = await loadRemoteState(s.id);
        await closeSheet(sheet);
        if (ok) { toast(`Loaded ${clockTime(s.createdAt)}`); shutterFlash(); }
      } catch {
        toast('Couldn’t load that save state', { kind: 'err' });
        b.disabled = false;
      }
    });
    host.appendChild(b);
  });
  if (!reducedMotion()) gsap.from(host.children, { opacity: 0, y: 8, duration: 0.36, ease: 'expo.out', stagger: 0.04 });
}

function openHelp() {
  const sheet = els.helpSheet;
  const k = (...keys) => keys.map((x) => `<kbd>${x}</kbd>`).join('');
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2 id="help-title">Controls</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="sheet-body">
      <div class="help-grid" data-stagger>
        <section class="help-col">
          <h3>${icon('keyboard')}Keyboard</h3>
          <dl class="help-table">
            <dt>${k('↑', '↓', '←', '→')}</dt><dd>D-pad</dd>
            <dt>${k('Z')}</dt><dd>A</dd>
            <dt>${k('X')}</dt><dd>B</dd>
            <dt>${k('A')}</dt><dd>L</dd>
            <dt>${k('S')}</dt><dd>R</dd>
            <dt>${k('Enter')}</dt><dd>Start</dd>
            <dt>${k('Backspace')}</dt><dd>Select</dd>
            <dt>${k('F')}</dt><dd>Fast forward on/off (2×)</dd>
            <dt>${k('Space')}</dt><dd>Hold to fast forward</dd>
            <dt>${k('Ctrl', 'S')}</dt><dd>Save state</dd>
            <dt>${k('Esc')}</dt><dd>Pause menu</dd>
            <dt>${k('?')}</dt><dd>This screen</dd>
          </dl>
        </section>
        <section class="help-col">
          <h3>${icon('hand')}Touch</h3>
          <dl class="help-table">
            <dt>D-pad</dt><dd>Slide your thumb to change direction. The centre is a dead zone, diagonals work.</dd>
            <dt>A and B</dt><dd>Roll between them, or rest in the gap to press both.</dd>
            <dt>L and R</dt><dd>Top corners.</dd>
            <dt>2×</dt><dd>Fast forward on/off.</dd>
          </dl>
          <p class="help-note">Button sounds and haptics can be turned off in the pause menu.</p>
        </section>
        <section class="help-col">
          <h3>${icon('controller')}Gamepad</h3>
          <dl class="help-table">
            <dt>D-pad / stick</dt><dd>D-pad</dd>
            <dt>South / East</dt><dd>A / B</dd>
            <dt>Bumpers</dt><dd>L / R</dd>
            <dt>Triggers</dt><dd>Hold to fast forward</dd>
            <dt>Menu / View</dt><dd>Start / Select</dd>
          </dl>
          <p class="help-note">The game pauses when you switch tabs and picks up where you left it when you come back.</p>
        </section>
      </div>
    </div>`;
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet(sheet));
  bindSheet(sheet);
}

async function openCheats() {
  const sheet = els.cheatSheet;
  sheet.innerHTML = `
    <div class="sheet-grip"></div>
    <div class="sheet-head"><h2 id="cheat-title">Cheats</h2><button class="icon-btn" type="button" data-close aria-label="Close">${icon('close')}</button></div>
    <div class="sheet-body" data-stagger>
      <p class="cheat-hint">GameShark or Action Replay codes, one per line, as <code>Name: XXXXXXXX YYYYYYYY</code>. Lines starting with # are ignored.</p>
      <textarea id="cheat-input" spellcheck="false" autocomplete="off" placeholder="Walk through walls: 509197D3 542975F4&#10;Rare candy: 128898B6 EDA43037"></textarea>
      <div class="sheet-actions">
        <button class="btn quiet" type="button" data-act="clear">Clear</button>
        <button class="btn primary" type="button" data-act="apply">Apply</button>
      </div>
    </div>`;
  const field = sheet.querySelector('#cheat-input');
  field.value = await loadSavedCheats();
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet(sheet));
  sheet.querySelector('[data-act="apply"]').addEventListener('click', async () => {
    try {
      applyCheatText(field.value);
      await idbSet('cheats', romId, new TextEncoder().encode(field.value).buffer);
      closeSheet(sheet);
    } catch (err) {
      toast(err.message || 'Bad cheat codes', { kind: 'err' });
      sfx('error');
    }
  });
  sheet.querySelector('[data-act="clear"]').addEventListener('click', async () => {
    field.value = '';
    try {
      await idbSet('cheats', romId, new ArrayBuffer(0));
    } catch {
      /* ignore */
    }
    toast('Cheats cleared');
  });
  bindSheet(sheet);
}

const anySheetOpen = () => !!document.querySelector('dialog.sheet[open]');

async function saveStateNow() {
  if (phase !== 'playing') return;
  shutterFlash();
  await pushState({ manual: true });
}

let leaving = false;
async function goBack() {
  if (leaving) return;
  leaving = true;
  accumulatePlaytime();
  if (phase === 'playing') {
    setStatus('Saving…');
    const work = [];
    if (sramTimer) work.push(pushSram().catch(() => {}));
    if (playedSinceState) work.push(pushState().catch(() => {}));
    await Promise.race([Promise.all(work), new Promise((r) => setTimeout(r, 2500))]);
  }
  window.location.href = libraryUrl();
}

// ------------------------------------------------------------------ init
function setupChrome() {
  const meta = romMeta(romId);
  const lib = cachedLibrary();
  const known = lib?.roms?.find((r) => r.id === romId);
  const title = known ? displayTitle(known.title).name : '';
  $('#title').textContent = title || 'GBA';
  els.loadingTitle.textContent = title || 'Loading';
  document.title = title ? `${title} · GBA` : 'GBA';
  const color = meta.color || (known ? hashColor(known.title) : null);
  if (color) document.documentElement.style.setProperty('--glow', color.join(' '));

  els.back.addEventListener('click', (e) => {
    e.preventDefault();
    goBack();
  });
  $('#help-btn').addEventListener('click', openHelp);
  $('#menu-btn').addEventListener('click', openMenu);
  els.saveBtn.addEventListener('click', saveStateNow);
  els.ff.addEventListener('click', () => { if (phase === 'playing') toggleFastForward(); });
  els.start.addEventListener('click', () => startFromGesture());
  els.paused.addEventListener('click', () => resumeFromPrompt());
  $('#retry').addEventListener('click', () => window.location.reload());
  $('#error-back').addEventListener('click', (e) => { e.preventDefault(); window.location.href = libraryUrl(); });

  // the very first tap anywhere on the page can start the game
  app.addEventListener('pointerdown', (e) => {
    if (phase === 'ready' && !e.target.closest('button, a, [data-zone]')) startFromGesture();
  });

  layout();
  // one entrance: the screen settles, then the hardware fades up around it
  if (!reducedMotion()) {
    const hw = [...document.querySelectorAll('.pad-shoulder, .pad-dpad-zone, .pad-face-zone, .pad-sys > *')];
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .from(screenEl, { opacity: 0, scale: 0.97, duration: 0.7 }, 0)
      .from('.bar > *', { opacity: 0, y: -8, duration: 0.5, stagger: 0.05 }, 0.1)
      .from(hw, { opacity: 0, y: 14, duration: 0.6, stagger: 0.035, clearProps: 'transform,opacity' }, 0.15)
      .call(() => input?.remeasure());
  }
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  screen.orientation?.addEventListener?.('change', layout);
}

function hotkey(code, e) {
  if (code === 'save') { saveStateNow(); return true; }
  if (code === 'KeyF') { if (phase === 'playing') toggleFastForward(); return true; }
  if (code === 'Space') {
    e?.preventDefault();
    if (phase === 'ready') { startFromGesture(); return true; }
    if (!e?.repeat && phase === 'playing') { holdFF = true; setFastForward(fastForward, { fromHold: true }); }
    return true;
  }
  if (code === 'SpaceUp') {
    if (holdFF) { holdFF = false; setFastForward(fastForward, { fromHold: true }); }
    return true;
  }
  if (code === 'PadFFDown' || code === 'PadFFUp') {
    holdFF = code === 'PadFFDown';
    if (phase === 'playing') setFastForward(fastForward, { fromHold: true });
    return true;
  }
  if (code === 'Escape') {
    // consume it, or the same keypress closes the dialog it just opened
    e?.preventDefault();
    if (!anySheetOpen()) setTimeout(openMenu, 0);
    return true;
  }
  if (e && (e.key === '?' || code === 'Slash' && e.shiftKey)) { openHelp(); return true; }
  if (phase === 'ready' && e && !KEY_MAP[code] && !['Tab', 'ShiftLeft', 'ShiftRight'].includes(code)) {
    startFromGesture();
    return true;
  }
  return false;
}

async function init() {
  if (!romId) { window.location.href = libraryUrl(); return; }
  setupChrome();
  if (!(await requireSession())) return;

  setProgress(4, 'Starting the emulator');
  const coreUrl = '/gba/mgba/mgba.js';
  const { default: mGBA } = await import(/* @vite-ignore */ coreUrl);
  const wasmUrl = '/gba/mgba/mgba.wasm';
  emu = await mGBA({
    canvas,
    locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : `/gba/mgba/${path}`),
  });
  await emu.FSInit();
  if (window.__gbaDebugLog) {
    emu.setLogger((e) => console.log(`[mgba ${e.level}] ${e.category}: ${e.message}`));
    window.__emu = emu;
  }
  emu.setCoreSettings({
    autoSaveStateEnable: false,
    restoreAutoSaveStateOnLoad: false,
    rewindEnable: false,
  });
  const romBytes = await downloadRom();
  setProgress(100, 'Loading save');
  romBytesCache = romBytes;
  romName = `${romId}.gba`;
  await upload(emu.uploadRom.bind(emu), asFile(romName, romBytes));

  let sram = await idbGet('sram', romId);
  if (!sram) {
    try {
      const remote = await fetchBinary(`/gba/api/sram/${encodeURIComponent(romId)}`);
      if (remote) sram = await gunzipBytes(remote);
    } catch {
      sram = null;
    }
  }
  if (sram && sram.byteLength) {
    const bytes = sram instanceof Uint8Array ? sram : new Uint8Array(sram);
    await upload(emu.uploadSaveOrSaveState.bind(emu), asFile(saveName(), bytes));
  }

  const loaded = emu.loadGame(`${emu.filePaths().gamePath}/${romName}`);
  if (!loaded) throw new Error('loadGame failed');
  // The core only keeps callbacks registered once a game is loaded.
  emu.addCoreCallbacks({
    saveDataUpdatedCallback: () => { saveEvents += 1; scheduleSram(); },
    videoFrameEndedCallback: () => { frameEvents += 1; if (running) playedSinceState = true; },
    coreCrashedCallback: () => {
      pushSram().catch(() => {});
      fail(new Error('The emulator stopped unexpectedly. Your in-game save is safe on this device.'), 'Something went wrong');
    },
  });
  const savedCheats = await loadSavedCheats();
  if (savedCheats.trim()) {
    try {
      applyCheatText(savedCheats, { quiet: true });
    } catch {
      /* ignore bad saved cheats */
    }
  }
  emu.pauseGame();
  emu.toggleInput(false);

  input = createInput({
    emu,
    root: app,
    isBlocked: () => anySheetOpen() || phase === 'error' || phase === 'loading',
    onFirstInput: () => (phase === 'ready' || pauseReasons.has('audio') ? startFromGesture() : false),
    onHotkey: hotkey,
    onSourceChange: (src) => app.classList.toggle('kb-active', src !== 'touch'),
  });

  phase = 'ready';
  els.saveBtn.disabled = false;
  showOverlay('start');
  if (!reducedMotion()) gsap.from(els.start, { opacity: 0, duration: 0.4, ease: 'power2.out' });

  setInterval(() => {
    if (running && playedSinceState) pushState().catch(() => {});
  }, 60000);
  setInterval(() => { if (running) accumulatePlaytime(); }, 15000);
  window.addEventListener('online', () => {
    if (romMeta(romId).sramPending) pushSram().catch(() => {});
  });
  if (romMeta(romId).sramPending && navigator.onLine) pushSram().catch(() => {});

  // dev/QA hook: read-only state for the Playwright checks
  window.__gba = {
    phase: () => phase,
    running: () => running,
    reasons: () => [...pauseReasons],
    held: () => [...input.held()],
    ff: () => emu.getFastForwardMultiplier?.(),
    audioState: () => emu.SDL2?.audioContext?.state,
    audioContext: () => emu.SDL2?.audioContext,
    saveEvents: () => saveEvents,
    frameEvents: () => frameEvents,
    saveBytes: () => { const s = readSave(); return s ? [...s.slice(0, 4)] : null; },
  };
}

init().catch((err) => fail(err));

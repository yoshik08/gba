import mGBA from '@thenick775/mgba-wasm';
import { gunzipBytes, gzipBytes } from './gzip.js';
import { idbGet, idbSet } from './idb.js';

const canvas = document.getElementById('canvas');
const overlay = document.getElementById('overlay');
const menu = document.getElementById('menu');
const toast = document.getElementById('toast');
const progressWrap = document.getElementById('progress-wrap');
const progress = document.getElementById('progress');
const progressLabel = document.getElementById('progress-label');
const loadList = document.getElementById('load-list');
const ffBtn = document.getElementById('fast-forward');

const KEY_MAP = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  KeyZ: 'A',
  KeyX: 'B',
  KeyA: 'L',
  KeyS: 'R',
  Enter: 'Start',
  Backspace: 'Select',
};

const params = new URLSearchParams(window.location.search);
const romId = params.get('id') || params.get('rom');

let emu = null;
let romName = 'game.gba';
let running = false;
let playedSinceState = false;
let sramTimer = null;
let fastForward = false;

function showToast(text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  toast.textContent = `${text} ✓ ${hh}:${mm}`;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 1800);
}

async function requireSession() {
  const res = await fetch('/gba/api/me');
  if (!res.ok) {
    window.location.href = '/gba';
    return false;
  }
  return true;
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

async function downloadRom() {
  const cached = await idbGet('roms', romId);
  if (cached) return new Uint8Array(cached);

  progressWrap.style.display = 'block';
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
      progress.value = Math.round((received / total) * 100);
      progressLabel.textContent = `Loading ROM… ${progress.value}%`;
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await idbSet('roms', romId, bytes.buffer);
  progressWrap.style.display = 'none';
  return bytes;
}

async function putGzip(url, bytes) {
  const gz = await gzipBytes(bytes);
  await fetch(url, {
    method: url.includes('/sram/') ? 'PUT' : 'POST',
    body: gz,
    keepalive: false,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
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

async function pushSram() {
  const save = readSave();
  if (!save || !save.byteLength) return;
  await idbSet('sram', romId, save);
  await putGzip(`/gba/api/sram/${encodeURIComponent(romId)}`, save);
  showToast('Saved');
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

async function pushState() {
  if (!emu) return;
  emu.saveState(0);
  const data = readStateSlot(0);
  if (!data) return;
  await idbSet('states', `${romId}:latest`, data);
  const gz = await gzipBytes(data);
  await fetch(`/gba/api/states/${encodeURIComponent(romId)}`, {
    method: 'POST',
    body: gz,
    keepalive: false,
    headers: {
      'Content-Type': 'application/octet-stream',
      'x-core-version': coreVersion(),
    },
  });
  playedSinceState = false;
  showToast('Saved');
  await refreshStates();
}

async function refreshStates() {
  const res = await fetch(`/gba/api/states/${encodeURIComponent(romId)}`);
  if (!res.ok) return;
  const states = await res.json();
  loadList.innerHTML = '';
  if (!states.length) {
    const p = document.createElement('p');
    p.style.color = 'var(--muted)';
    p.textContent = 'No save states yet';
    loadList.appendChild(p);
    return;
  }
  states.slice(0, 3).forEach((state, i) => {
    const btn = document.createElement('button');
    const when = new Date(state.createdAt).toLocaleString();
    btn.type = 'button';
    btn.textContent = `Load ${i + 1} — ${when}`;
    btn.addEventListener('click', () => loadRemoteState(state.id));
    loadList.appendChild(btn);
  });
}

async function loadRemoteState(stateId) {
  const raw = await fetchBinary(`/gba/api/states/${encodeURIComponent(romId)}/${stateId}`);
  if (!raw) return;
  const data = await gunzipBytes(raw);
  await upload(emu.uploadSaveOrSaveState.bind(emu), asFile(stateName(0), data));
  emu.loadState(0);
}

function bindKeys() {
  emu.toggleInput(false);
  const down = new Set();
  window.addEventListener('keydown', (e) => {
    const btn = KEY_MAP[e.code] || KEY_MAP[e.key];
    if (!btn) return;
    e.preventDefault();
    if (down.has(btn)) return;
    down.add(btn);
    emu.buttonPress(btn);
  });
  window.addEventListener('keyup', (e) => {
    const btn = KEY_MAP[e.code] || KEY_MAP[e.key];
    if (!btn) return;
    e.preventDefault();
    down.delete(btn);
    emu.buttonUnpress(btn);
  });
}

function bindTouch() {
  const held = new Map();
  document.querySelectorAll('[data-btn]').forEach((el) => {
    const name = el.getAttribute('data-btn');
    const press = (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      held.set(e.pointerId, name);
      el.classList.add('active');
      emu.buttonPress(name);
    };
    const release = (e) => {
      e.preventDefault();
      const btn = held.get(e.pointerId);
      if (!btn) return;
      held.delete(e.pointerId);
      el.classList.remove('active');
      emu.buttonUnpress(btn);
    };
    el.addEventListener('pointerdown', press);
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  });
}

function bindGamepad() {
  const map = {
    0: 'A', 1: 'B', 4: 'L', 5: 'R', 8: 'Select', 9: 'Start',
    12: 'Up', 13: 'Down', 14: 'Left', 15: 'Right',
  };
  let prev = new Set();
  const tick = () => {
    const pad = navigator.getGamepads?.()[0];
    const now = new Set();
    if (pad && running) {
      Object.entries(map).forEach(([idx, name]) => {
        if (pad.buttons[idx]?.pressed) now.add(name);
      });
      if (pad.axes[0] < -0.4) now.add('Left');
      if (pad.axes[0] > 0.4) now.add('Right');
      if (pad.axes[1] < -0.4) now.add('Up');
      if (pad.axes[1] > 0.4) now.add('Down');
    }
    now.forEach((name) => { if (!prev.has(name)) emu.buttonPress(name); });
    prev.forEach((name) => { if (!now.has(name)) emu.buttonUnpress(name); });
    prev = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function resumeAudio() {
  try {
    if (emu.SDL2?.audioContext && emu.SDL2.audioContext.state !== 'running') {
      await emu.SDL2.audioContext.resume();
    }
  } catch {
    /* iOS may need a second gesture */
  }
  emu.resumeGame();
  running = true;
}

function setupMenu() {
  const toggle = () => {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    if (menu.style.display === 'block') refreshStates();
  };
  document.getElementById('menu-btn').addEventListener('click', toggle);
  document.getElementById('menu-close').addEventListener('click', () => {
    menu.style.display = 'none';
  });
  document.getElementById('save-state').addEventListener('click', () => {
    pushState().catch(() => {});
  });
  document.getElementById('back').addEventListener('click', () => {
    window.location.href = '/gba';
  });
  ffBtn.addEventListener('click', () => {
    fastForward = !fastForward;
    emu.setFastForwardMultiplier(fastForward ? 4 : 1);
    ffBtn.textContent = fastForward ? 'Fast forward on' : 'Fast forward';
  });
}

async function init() {
  if (!romId || !(await requireSession())) return;

  const wasmUrl = '/gba/mgba/mgba.wasm';
  emu = await mGBA({
    canvas,
    locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : `/gba/mgba/${path}`),
    mainScriptUrlOrBlob: '/gba/mgba/mgba.js',
  });
  await emu.FSInit();
  emu.setCoreSettings({
    autoSaveStateEnable: false,
    restoreAutoSaveStateOnLoad: false,
    rewindEnable: false,
  });
  emu.addCoreCallbacks({
    saveDataUpdatedCallback: () => scheduleSram(),
    videoFrameEndedCallback: () => { if (running) playedSinceState = true; },
  });

  const romBytes = await downloadRom();
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
  emu.pauseGame();
  bindKeys();
  bindTouch();
  bindGamepad();
  setupMenu();

  overlay.style.display = 'flex';
  overlay.addEventListener('click', async () => {
    overlay.style.display = 'none';
    await resumeAudio();
  }, { once: true });

  setInterval(() => {
    if (running && playedSinceState) pushState().catch(() => {});
  }, 60000);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      emu.pauseGame();
      running = false;
      if (playedSinceState) pushState().catch(() => {});
    }
  });
}

init().catch((err) => {
  progressWrap.style.display = 'block';
  progressLabel.textContent = `Failed to start: ${err.message}`;
});

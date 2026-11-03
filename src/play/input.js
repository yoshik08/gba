// One input system for touch, keyboard and gamepad.
// Every source keeps its own set of held buttons; the emulator only ever sees the union,
// and only on change. That makes stuck buttons impossible: releaseAll() clears every source.
import { haptic, sfx } from '../lib/sfx.js';

export const KEY_MAP = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  KeyZ: 'A',
  KeyX: 'B',
  KeyA: 'L',
  KeyS: 'R',
  Enter: 'Start',
  NumpadEnter: 'Start',
  Backspace: 'Select',
};

const PAD_MAP = {
  0: 'A', 1: 'B', 2: 'B', 3: 'A', 4: 'L', 5: 'R', 8: 'Select', 9: 'Start',
  12: 'Up', 13: 'Down', 14: 'Left', 15: 'Right',
};

// D-pad tuning. Radii are fractions of the pad's half-size.
const DEAD = 0.2; // touching the centre does nothing, like the pivot on a real pad
const DIAG = 18; // half-width of the diagonal sectors, in degrees (cardinals get the rest)
const HYST = 6; // extra degrees needed to leave the current sector, kills flicker
// Face buttons: generous hit circles, and a narrow band between them that presses both.
const FACE_REACH = 1.5;
const FACE_BOTH = 0.45;
const EDGE_SLOP = 14; // px around L/R/Start/Select before a sliding finger lets go

const DPAD_SVG = `
<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="dp-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#34343a"/><stop offset="1" stop-color="#18181b"/>
    </linearGradient>
    <radialGradient id="dp-dimple" cx="50%" cy="45%" r="50%">
      <stop offset="0" stop-color="#101012"/><stop offset="1" stop-color="#26262b"/>
    </radialGradient>
    <linearGradient id="dp-press" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgb(0 0 0 / 0.42)"/><stop offset="1" stop-color="rgb(0 0 0 / 0.2)"/>
    </linearGradient>
  </defs>
  <path d="M39 2h22a6 6 0 0 1 6 6v25h25a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H67v25a6 6 0 0 1-6 6H39a6 6 0 0 1-6-6V67H8a6 6 0 0 1-6-6V39a6 6 0 0 1 6-6h25V8a6 6 0 0 1 6-6z" fill="url(#dp-body)"/>
  <path d="M39 2.6h22a5.4 5.4 0 0 1 5.4 5.4M33.6 33.6H8a5.4 5.4 0 0 0-5.4 5.4M67 33.6h25" fill="none" stroke="rgb(255 255 255 / 0.13)" stroke-width="1"/>
  <g class="press-layer">
    <path class="press" data-dir="Up" d="M39 2h22a6 6 0 0 1 6 6v25H33V8a6 6 0 0 1 6-6z" fill="url(#dp-press)"/>
    <path class="press" data-dir="Down" d="M33 67h34v25a6 6 0 0 1-6 6H39a6 6 0 0 1-6-6z" fill="url(#dp-press)"/>
    <path class="press" data-dir="Left" d="M8 33h25v34H8a6 6 0 0 1-6-6V39a6 6 0 0 1 6-6z" fill="url(#dp-press)"/>
    <path class="press" data-dir="Right" d="M67 33h25a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6H67z" fill="url(#dp-press)"/>
  </g>
  <g fill="rgb(255 255 255 / 0.3)">
    <path class="arrow" data-dir="Up" d="M50 11l6 8H44z"/>
    <path class="arrow" data-dir="Down" d="M50 89l6-8H44z"/>
    <path class="arrow" data-dir="Left" d="M11 50l8-6v12z"/>
    <path class="arrow" data-dir="Right" d="M89 50l-8-6v12z"/>
  </g>
  <circle cx="50" cy="50" r="9" fill="url(#dp-dimple)"/>
</svg>`;

export function createInput({ emu, root, isBlocked = () => false, onFirstInput, onHotkey, onSourceChange }) {
  const touch = new Map(); // pointerId -> { kind, zone, rect, buttons:Set, sector }
  const keys = new Set();
  const pad = new Set();
  let held = new Set();
  let enabled = false;

  const dpadZone = root.querySelector('[data-zone="dpad"]');
  const dpad = root.querySelector('#dpad');
  dpad.innerHTML = DPAD_SVG;
  const dpadPress = Object.fromEntries([...dpad.querySelectorAll('.press')].map((p) => [p.dataset.dir, p]));
  const lit = new Map();
  root.querySelectorAll('[data-btn]').forEach((el) => {
    if (el.closest('#dpad')) return;
    const b = el.dataset.btn;
    lit.set(b, [...(lit.get(b) || []), el]);
  });

  // Hit-test geometry, measured once per layout instead of on every press (no forced layout in the hot path).
  const geo = new Map();
  let geoValid = false;
  function measure() {
    geo.clear();
    root.querySelectorAll('[data-zone]').forEach((zone) => {
      const g = { rect: zone.getBoundingClientRect() };
      if (zone.dataset.zone === 'face') {
        g.circles = ['A', 'B'].map((n) => {
          const r = zone.querySelector(`[data-btn="${n}"]`).getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
        });
      }
      if (zone.dataset.zone === 'dpad') {
        // the pad tilts when pressed; measure its untilted box
        const r = dpad.getBoundingClientRect();
        const z = zone.getBoundingClientRect();
        const size = Math.min(r.width, r.height);
        g.rect = { left: z.left + (z.width - size) / 2, top: z.top + (z.height - size) / 2, width: size, height: size };
      }
      geo.set(zone, g);
    });
    geoValid = true;
  }
  const invalidate = () => { geoValid = false; };
  window.addEventListener('resize', invalidate);
  window.addEventListener('orientationchange', invalidate);
  window.visualViewport?.addEventListener('resize', invalidate);
  new ResizeObserver(invalidate).observe(root);

  function paint(next) {
    for (const [b, list] of lit) {
      const on = next.has(b);
      list.forEach((el) => { if (el.classList.contains('is-down') !== on) el.classList.toggle('is-down', on); });
    }
    let x = 0; let y = 0;
    for (const d of ['Up', 'Down', 'Left', 'Right']) {
      const on = next.has(d);
      if (dpadPress[d].classList.contains('on') !== on) dpadPress[d].classList.toggle('on', on);
    }
    if (next.has('Left')) x -= 1;
    if (next.has('Right')) x += 1;
    if (next.has('Up')) y -= 1;
    if (next.has('Down')) y += 1;
    // the pad rocks toward the pressed direction
    dpad.style.setProperty('--ry', `${x * 9}deg`);
    dpad.style.setProperty('--rx', `${-y * 9}deg`);
    const any = x !== 0 || y !== 0;
    dpad.classList.toggle('is-down', any);
    dpadZone.classList.toggle('has-down', any);
  }

  function commit() {
    const next = new Set([...keys, ...pad]);
    for (const t of touch.values()) t.buttons.forEach((b) => next.add(b));
    if (enabled) {
      for (const b of next) if (!held.has(b)) emu.buttonPress(b);
      for (const b of held) if (!next.has(b)) emu.buttonUnpress(b);
    } else {
      for (const b of held) emu.buttonUnpress(b);
    }
    paint(next);
    held = enabled ? next : new Set();
  }

  // ---------- touch ----------
  function dpadButtons(t, x, y) {
    const r = t.rect;
    const half = Math.min(r.width, r.height) / 2;
    const dx = (x - (r.left + r.width / 2)) / half;
    const dy = (y - (r.top + r.height / 2)) / half;
    const dist = Math.hypot(dx, dy);
    if (dist < (t.sector == null ? DEAD : DEAD * 0.7)) { t.sector = null; return []; }
    const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360; // 0 = right, 90 = down
    // sectors: 0 R, 1 DR, 2 D, 3 DL, 4 L, 5 UL, 6 U, 7 UR. Diagonals are narrower than cardinals.
    const offFrom = (k) => { const o = Math.abs(a - k * 45); return o > 180 ? 360 - o : o; };
    let s = Math.round(a / 90) % 4 * 2;
    for (const k of [1, 3, 5, 7]) if (offFrom(k) <= DIAG) s = k;
    if (t.sector != null && s !== t.sector) {
      // stay put until the thumb is clearly past the edge of the current sector
      const half = t.sector % 2 === 1 ? DIAG : 45 - DIAG;
      if (offFrom(t.sector) <= half + HYST) s = t.sector;
    }
    t.sector = s;
    return [['Right'], ['Right', 'Down'], ['Down'], ['Down', 'Left'], ['Left'], ['Left', 'Up'], ['Up'], ['Up', 'Right']][s];
  }

  function faceButtons(t, x, y) {
    const [a, b] = t.circles;
    const da = Math.hypot(x - a.x, y - a.y) / a.r;
    const db = Math.hypot(x - b.x, y - b.y) / b.r;
    const inA = da < FACE_REACH;
    const inB = db < FACE_REACH;
    // a thumb resting in the gap between them presses both, like rolling across real buttons
    const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    if (Math.hypot(x - mx, y - my) < a.r * FACE_BOTH) return ['A', 'B'];
    if (inA && (!inB || da <= db)) return ['A'];
    if (inB) return ['B'];
    return [];
  }

  function btnButtons(t, x, y) {
    const r = t.rect;
    const inside = x > r.left - EDGE_SLOP && x < r.right + EDGE_SLOP && y > r.top - EDGE_SLOP && y < r.bottom + EDGE_SLOP;
    return inside ? [t.zone.dataset.btn] : [];
  }

  function update(t, x, y) {
    const list = t.kind === 'dpad' ? dpadButtons(t, x, y) : t.kind === 'face' ? faceButtons(t, x, y) : btnButtons(t, x, y);
    const next = new Set(list);
    let pressed = false;
    for (const b of next) if (!t.buttons.has(b)) pressed = true;
    let released = false;
    for (const b of t.buttons) if (!next.has(b)) released = true;
    if (!pressed && !released) return;
    t.buttons = next;
    commit();
    // layered feedback for touch, fired in the same tick as the press
    if (pressed && enabled) { sfx('press'); haptic(9); } else if (released && enabled) sfx('release');
  }

  root.querySelectorAll('[data-zone]').forEach((zone) => {
    const kind = zone.dataset.zone;
    zone.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (isBlocked()) return;
      onSourceChange?.('touch');
      if (onFirstInput?.()) return; // that press powered the game on; don't forward it
      try { zone.setPointerCapture(e.pointerId); } catch { /* already released */ }
      if (!geoValid) measure();
      const g = geo.get(zone);
      const t = { kind, zone, rect: g.rect, circles: g.circles, buttons: new Set(), sector: null };
      touch.set(e.pointerId, t);
      update(t, e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => {
      const t = touch.get(e.pointerId);
      if (!t) return;
      // coalesced events give us the most recent position without extra work
      update(t, e.clientX, e.clientY);
    });
    const end = (e) => {
      const t = touch.get(e.pointerId);
      if (!t) return;
      touch.delete(e.pointerId);
      if (t.buttons.size) {
        t.buttons = new Set();
        commit();
        if (enabled) sfx('release');
      }
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
    zone.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ---------- keyboard ----------
  const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.altKey || e.metaKey || e.ctrlKey) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS' && !typing(e.target)) { e.preventDefault(); onHotkey?.('save'); }
      return;
    }
    if (isBlocked()) return;
    if (onHotkey?.(e.code, e)) return;
    const b = KEY_MAP[e.code];
    if (!b) return;
    e.preventDefault();
    onSourceChange?.('keyboard');
    if (e.repeat) return;
    if (onFirstInput?.()) return;
    keys.add(b);
    commit();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') onHotkey?.('SpaceUp', e);
    const b = KEY_MAP[e.code];
    if (!b || !keys.has(b)) return;
    e.preventDefault();
    keys.delete(b);
    commit();
  });

  // ---------- gamepad (polled only while one is connected) ----------
  let polling = false;
  let padFF = false;
  function poll() {
    const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
    if (!pads.length) { polling = false; if (pad.size) { pad.clear(); commit(); } return; }
    const p = pads[0];
    const now = new Set();
    for (const [i, name] of Object.entries(PAD_MAP)) if (p.buttons[i]?.pressed) now.add(name);
    if (p.axes[0] < -0.5) now.add('Left');
    if (p.axes[0] > 0.5) now.add('Right');
    if (p.axes[1] < -0.5) now.add('Up');
    if (p.axes[1] > 0.5) now.add('Down');
    const ff = !!(p.buttons[7]?.pressed || p.buttons[6]?.pressed);
    if (ff !== padFF) { padFF = ff; onHotkey?.(ff ? 'PadFFDown' : 'PadFFUp'); }
    let changed = now.size !== pad.size;
    if (!changed) for (const b of now) if (!pad.has(b)) { changed = true; break; }
    if (changed && !isBlocked()) {
      if (now.size) onSourceChange?.('gamepad');
      if (now.size && onFirstInput?.()) { /* consumed */ } else {
        pad.clear();
        now.forEach((b) => pad.add(b));
        commit();
      }
    }
    requestAnimationFrame(poll);
  }
  function startPolling() {
    if (polling) return;
    polling = true;
    requestAnimationFrame(poll);
  }
  window.addEventListener('gamepadconnected', startPolling);
  if ([...(navigator.getGamepads?.() || [])].some(Boolean)) startPolling();

  return {
    enable(on) { enabled = on; commit(); },
    // Called on blur / tab hide / sheet open: every source lets go, the core sees releases.
    releaseAll() {
      touch.forEach((t, id) => { try { t.zone.releasePointerCapture(id); } catch { /* gone */ } });
      touch.clear();
      keys.clear();
      pad.clear();
      commit();
    },
    held: () => new Set(held),
    remeasure: invalidate,
  };
}

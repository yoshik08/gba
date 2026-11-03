// Procedural UI and button sounds. Plain Web Audio, no samples, no dependencies.
// Each sound is a few short-lived nodes; nothing runs between sounds.
import { prefs } from './meta.js';

let ctx = null;
let master = null;
let noise = null;
let borrowed = false;

// The play page hands over mGBA's own AudioContext so we never run two at once.
export function useAudioContext(external) {
  if (!external || ctx === external) return;
  ctx = external;
  borrowed = true;
  master = null;
  noise = null;
  baked.press = []; baked.release = []; baking = false;
  if (audio()) bake(ctx);
}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === 'suspended' && !borrowed) ctx.resume().catch(() => {});
  return ctx.state === 'running' || !borrowed ? ctx : null;
}

function noiseBuffer(c) {
  if (noise) return noise;
  const len = Math.floor(c.sampleRate * 0.25);
  noise = c.createBuffer(1, len, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
  return noise;
}

const jitter = (amt) => 1 + (Math.random() * 2 - 1) * amt;

function env(c, gain, t, attack, decay) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function tone(c, { freq, to, type = 'sine', gain = 0.1, at = 0, attack = 0.003, decay = 0.08, filter, dest = master }) {
  const t = c.currentTime + at;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  const g = env(c, gain, t, attack, decay);
  let node = o;
  if (filter) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    node = node.connect(f);
  }
  node.connect(g).connect(dest);
  o.start(t);
  o.stop(t + attack + decay + 0.02);
}

function burst(c, { gain = 0.1, at = 0, decay = 0.02, band = 3000, q = 1.2, type = 'bandpass', sweepTo, dest = master }) {
  const t = c.currentTime + at;
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(band, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
  f.Q.value = q;
  const g = env(c, gain, t, 0.002, decay);
  s.connect(f).connect(g).connect(dest);
  s.start(t, Math.random() * 0.2);
  s.stop(t + decay + 0.03);
}

// The two sounds fired on every on-screen button press are rendered once into buffers
// (a few pitch variants each), so a press costs one buffer source, not a synth graph.
const baked = { press: [], release: [] };
let baking = false;
function bake(c) {
  if (baking || typeof OfflineAudioContext === 'undefined') return;
  baking = true;
  const sr = c.sampleRate;
  const render = async (len, fn) => {
    const off = new OfflineAudioContext(1, Math.ceil(sr * len), sr);
    fn(off, off.destination);
    return off.startRendering();
  };
  const pitches = [0.95, 1, 1.05, 1.1];
  Promise.all(pitches.map((p) => render(0.06, (o, d) => {
    burst(o, { gain: 0.07, decay: 0.012, band: 3400 * p, q: 2.2, dest: d });
    tone(o, { freq: 190 * p, to: 120, gain: 0.05, decay: 0.03, dest: d });
  }))).then((b) => { baked.press = b; }).catch(() => {});
  Promise.all(pitches.map((p) => render(0.04, (o, d) => {
    burst(o, { gain: 0.025, decay: 0.01, band: 5200 * p, q: 2.5, dest: d });
  }))).then((b) => { baked.release = b; }).catch(() => {});
}

function playBaked(c, list) {
  const src = c.createBufferSource();
  src.buffer = list[(Math.random() * list.length) | 0];
  src.connect(master);
  src.start();
}

const SOUNDS = {
  // hardware button down: a dry click and a little body
  press() {
    const c = audio(); if (!c) return;
    if (baked.press.length) { playBaked(c, baked.press); return; }
    bake(c);
    const p = jitter(0.06);
    burst(c, { gain: 0.07, decay: 0.012, band: 3400 * p, q: 2.2 });
    tone(c, { freq: 190 * p, to: 120, gain: 0.05, decay: 0.03 });
  },
  // button up: softer and higher
  release() {
    const c = audio(); if (!c) return;
    if (baked.release.length) { playBaked(c, baked.release); return; }
    bake(c);
    burst(c, { gain: 0.025, decay: 0.01, band: 5200 * jitter(0.08), q: 2.5 });
  },
  tap() {
    const c = audio(); if (!c) return;
    tone(c, { freq: 1320 * jitter(0.02), gain: 0.035, decay: 0.045, type: 'triangle' });
  },
  open() {
    const c = audio(); if (!c) return;
    burst(c, { gain: 0.03, decay: 0.14, band: 700, sweepTo: 2600, q: 0.8 });
    tone(c, { freq: 660, gain: 0.025, decay: 0.07, at: 0.02, type: 'triangle' });
  },
  close() {
    const c = audio(); if (!c) return;
    burst(c, { gain: 0.025, decay: 0.12, band: 2400, sweepTo: 600, q: 0.8 });
  },
  toggleOn() {
    const c = audio(); if (!c) return;
    tone(c, { freq: 880, gain: 0.04, decay: 0.05, type: 'triangle' });
    tone(c, { freq: 1320, gain: 0.04, decay: 0.08, at: 0.05, type: 'triangle' });
  },
  toggleOff() {
    const c = audio(); if (!c) return;
    tone(c, { freq: 1320, gain: 0.035, decay: 0.05, type: 'triangle' });
    tone(c, { freq: 880, gain: 0.035, decay: 0.08, at: 0.05, type: 'triangle' });
  },
  // save state: a shutter
  shutter() {
    const c = audio(); if (!c) return;
    burst(c, { gain: 0.09, decay: 0.03, band: 2600, q: 1.4 });
    burst(c, { gain: 0.06, decay: 0.05, band: 1800, q: 1.4, at: 0.06 });
    tone(c, { freq: 1568, gain: 0.03, decay: 0.12, at: 0.08, type: 'sine' });
  },
  // game start: a short rising arpeggio
  boot() {
    const c = audio(); if (!c) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      tone(c, { freq: f, gain: 0.045, decay: i === 3 ? 0.4 : 0.12, at: i * 0.055, type: 'square', filter: 2600 });
    });
  },
  error() {
    const c = audio(); if (!c) return;
    tone(c, { freq: 220, gain: 0.06, decay: 0.12, type: 'square', filter: 1200 });
    tone(c, { freq: 165, gain: 0.06, decay: 0.18, at: 0.11, type: 'square', filter: 1200 });
  },
};

export function sfx(name) {
  if (!prefs().sound) return;
  try { SOUNDS[name]?.(); } catch { /* audio is best-effort */ }
}

export function haptic(ms = 8) {
  if (!prefs().haptics) return;
  try { navigator.vibrate?.(ms); } catch { /* unsupported */ }
}

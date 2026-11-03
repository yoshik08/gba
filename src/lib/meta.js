// Small per-device memory: play history, sync timestamps, cached library, preferences.
// Lives in localStorage; every read/write is guarded so private mode never breaks the app.
const KEY = 'gba:meta:v1';

const DEFAULT_PREFS = { sound: true, haptics: true, touchControls: 'auto' };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    return { roms: {}, prefs: {}, ...data };
  } catch {
    return { roms: {}, prefs: {} };
  }
}

let state = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

window.addEventListener('storage', (e) => { if (e.key === KEY) state = load(); });

export function prefs() {
  return { ...DEFAULT_PREFS, ...state.prefs };
}

export function setPref(key, value) {
  state.prefs = { ...state.prefs, [key]: value };
  persist();
}

export function romMeta(id) {
  return state.roms[id] || {};
}

export function updateRom(id, patch) {
  state.roms[id] = { ...state.roms[id], ...patch };
  persist();
}

export function allRomMeta() {
  return state.roms;
}

export function cacheLibrary(roms) {
  state.library = { at: Date.now(), roms };
  persist();
}

export function cachedLibrary() {
  return state.library || null;
}

export function cacheUser(user) {
  state.user = user ? { ...user, at: Date.now() } : null;
  persist();
}

export function cachedUser() {
  return state.user || null;
}

export function recentRoms(limit = 6) {
  return Object.entries(state.roms)
    .filter(([, m]) => m.lastPlayed)
    .sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)
    .slice(0, limit)
    .map(([id, m]) => ({ id, ...m }));
}

// ---- formatting ----
const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
  : null;

export function ago(ts) {
  if (!ts) return '';
  const diff = (typeof ts === 'number' ? ts : Date.parse(ts)) - Date.now();
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';
  const units = [
    ['year', 31_536_000_000], ['month', 2_592_000_000], ['week', 604_800_000],
    ['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000],
  ];
  const [unit, size] = units.find(([, s]) => abs >= s) || units[units.length - 1];
  const value = Math.round(diff / size) || -1;
  return rtf ? rtf.format(value, unit) : `${Math.abs(value)} ${unit}s ago`;
}

export function playtime(ms) {
  if (!ms || ms < 60_000) return '';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (!h) return `${m} min played`;
  return m ? `${h} h ${m} min played` : `${h} h played`;
}

export function bytes(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function clockTime(ts) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

// "Legend of Zelda, The - The Minish Cap (USA)" → { name: "The Legend of Zelda: The Minish Cap", tags: ["USA"] }
export function displayTitle(raw) {
  const tags = [];
  let name = String(raw || '').replace(/\s*[([]([^)\]]+)[)\]]/g, (_, t) => { tags.push(t.trim()); return ''; }).trim();
  name = name.replace(/^(.+?), (The|A|An)(?= - |$)/i, '$2 $1');
  name = name.replace(/\s+-\s+/, ': ');
  name = name.replace(/\s+/g, ' ').trim();
  return { name: name || String(raw || 'Untitled'), tags };
}

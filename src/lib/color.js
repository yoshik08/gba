// The colour a cover "shines" with, as light on true black. No animation code here,
// so the play page can use it without loading an animation library.

const colorCache = new Map();

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function rgbFromHsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Normalises any colour into something that reads as light on true black.
export function asLight([r, g, b]) {
  const [h, s, l] = hsl(r, g, b);
  return rgbFromHsl(h, Math.max(0.5, Math.min(0.92, s * 1.15)), Math.max(0.56, Math.min(0.68, l)));
}

export function hashColor(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = Math.abs(h) % 360;
  return rgbFromHsl(hue, 0.7, 0.62);
}

// Picks the most "luminous" colour in a cover: saturated, mid-light pixels win.
export function sampleColor(img) {
  const key = img.currentSrc || img.src;
  if (colorCache.has(key)) return colorCache.get(key);
  const size = 24;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  let data;
  try { data = g.getImageData(0, 0, size, size).data; } catch { return null; }
  const scored = [];
  for (let i = 0; i < data.length; i += 4) {
    const [, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
    const score = s * (1 - Math.min(1, Math.abs(l - 0.55) * 1.6));
    scored.push([score, data[i], data[i + 1], data[i + 2]]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.slice(0, Math.max(6, Math.floor(scored.length * 0.12)));
  const sum = top.reduce((acc, [w, r, gg, b]) => {
    const wt = w + 0.01;
    return [acc[0] + r * wt, acc[1] + gg * wt, acc[2] + b * wt, acc[3] + wt];
  }, [0, 0, 0, 0]);
  const rgb = top[0][0] < 0.08 ? null : asLight([sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]]);
  colorCache.set(key, rgb);
  return rgb;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;


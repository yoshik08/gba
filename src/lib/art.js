// The pixel-resolve reveal for box art (Anime.js drives the steps).
import { animate } from 'animejs';
import { reducedMotion } from './color.js';

export { asLight, hashColor, reducedMotion, sampleColor } from './color.js';

// "Resolve" an image the way a low-res screen powers up: big blocks → finer → sharp.
// Draws a handful of frames into a canvas laid over the <img>, then gets out of the way.
export function pixelReveal(img, { blocks = [26, 13, 6.5, 3.25], duration = 460, delay = 0, fit = 'cover' } = {}) {
  const host = img.parentElement;
  if (!host || reducedMotion() || !img.naturalWidth) {
    img.style.opacity = '1';
    return Promise.resolve();
  }
  // Set up inside the stagger slot, so a row of covers arriving together doesn't stack its work in one frame.
  return new Promise((resolve) => {
    setTimeout(() => requestAnimationFrame(() => runReveal(img, host, blocks, duration, fit).then(resolve)), delay);
  });
}

function runReveal(img, host, blocks, duration, fit) {
  const rect = host.getBoundingClientRect();
  // Drawn at CSS resolution: the effect is meant to be blocky, so device pixels buy nothing.
  const W = Math.max(1, Math.round(rect.width));
  const H = Math.max(1, Math.round(rect.height));
  const canvas = document.createElement('canvas');
  canvas.className = 'pix';
  canvas.width = W; canvas.height = H;
  host.appendChild(canvas);
  const g = canvas.getContext('2d');

  // Shrink the cover once (object-fit emulated); every step samples this small copy.
  const iw = img.naturalWidth; const ih = img.naturalHeight;
  const scale = fit === 'cover' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  const dw = iw * scale; const dh = ih * scale;
  const dx = (W - dw) / 2; const dy = (H - dh) / 2;
  const SW = Math.max(1, Math.round(W / 2)); const SH = Math.max(1, Math.round(H / 2));
  const small = document.createElement('canvas');
  small.width = SW; small.height = SH;
  const sg = small.getContext('2d');
  sg.imageSmoothingQuality = 'low';
  sg.drawImage(img, dx / 2, dy / 2, dw / 2, dh / 2);
  const tiny = document.createElement('canvas');
  const tg = tiny.getContext('2d');

  const draw = (block) => {
    const tw = Math.max(1, Math.round(W / block));
    const th = Math.max(1, Math.round(H / block));
    tiny.width = tw; tiny.height = th;
    tg.drawImage(small, 0, 0, tw, th);
    g.imageSmoothingEnabled = false;
    g.drawImage(tiny, 0, 0, W, H);
  };

  draw(blocks[0]);
  img.style.opacity = '0';
  const state = { step: 0 };
  let last = 0;
  return new Promise((resolve) => {
    animate(state, {
      step: blocks.length,
      duration,
      ease: 'linear',
      onUpdate: () => {
        const s = Math.min(blocks.length - 1, Math.floor(state.step));
        if (s !== last) { last = s; draw(blocks[s]); }
      },
      onComplete: () => {
        img.style.opacity = '1';
        canvas.style.transition = 'opacity 180ms ease-out';
        canvas.style.opacity = '0';
        setTimeout(() => canvas.remove(), 200);
        resolve();
      },
    });
  });
}

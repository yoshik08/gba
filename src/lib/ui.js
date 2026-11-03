// Sheets (dialogs) and toasts, choreographed with GSAP.
import { gsap } from 'gsap';
import { icon } from './icons.js';
import { sfx } from './sfx.js';
import { reducedMotion } from './color.js';

const isDrawer = () => !window.matchMedia('(min-width: 720px) and (min-height: 560px)').matches;

// Opens a <dialog class="sheet">. Bottom drawer on phones, centered panel on larger screens.
export function openSheet(dialog, { onClose, from } = {}) {
  if (dialog.open) return;
  dialog.tabIndex = -1;
  dialog.showModal();
  dialog.focus({ preventScroll: true }); // keyboard users tab in from here, no ring on open
  dialog.classList.add('is-open');
  dialog.scrollTop = 0;
  sfx('open');
  const body = dialog.querySelectorAll('[data-stagger] > *');
  gsap.killTweensOf([dialog, body]);
  if (reducedMotion()) {
    gsap.fromTo(dialog, { opacity: 0 }, { opacity: 1, duration: 0.15 });
  } else if (isDrawer()) {
    gsap.fromTo(dialog, { yPercent: 100 }, { yPercent: 0, duration: 0.42, ease: 'expo.out', clearProps: 'transform' });
    if (body.length) gsap.fromTo(body, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'expo.out', stagger: 0.035, delay: 0.06, clearProps: 'transform,opacity' });
  } else {
    const origin = from ? originFrom(dialog, from) : '50% 50%';
    gsap.fromTo(dialog, { opacity: 0, scale: 0.96, transformOrigin: origin }, { opacity: 1, scale: 1, duration: 0.26, ease: 'expo.out', clearProps: 'transform' });
    if (body.length) gsap.fromTo(body, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.32, ease: 'expo.out', stagger: 0.03, delay: 0.04, clearProps: 'transform,opacity' });
  }
  const cancel = (e) => { e.preventDefault(); closeSheet(dialog); };
  const backdrop = (e) => { if (e.target === dialog) closeSheet(dialog); };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('click', backdrop);
  dialog._cleanup = () => {
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('click', backdrop);
    onClose?.();
  };
  enableDragToClose(dialog);
}

function originFrom(dialog, el) {
  const a = el.getBoundingClientRect();
  const d = dialog.getBoundingClientRect();
  const x = ((a.left + a.width / 2 - d.left) / d.width) * 100;
  const y = ((a.top + a.height / 2 - d.top) / d.height) * 100;
  return `${Math.max(0, Math.min(100, x))}% ${Math.max(0, Math.min(100, y))}%`;
}

export function closeSheet(dialog) {
  if (!dialog.open || dialog._closing) return Promise.resolve();
  dialog._closing = true;
  sfx('close');
  dialog.classList.remove('is-open');
  const done = () => {
    dialog._closing = false;
    gsap.set(dialog, { clearProps: 'all' });
    dialog.close();
    dialog._cleanup?.();
    dialog._cleanup = null;
  };
  return new Promise((resolve) => {
    if (reducedMotion()) {
      gsap.to(dialog, { opacity: 0, duration: 0.12, onComplete: () => { done(); resolve(); } });
    } else if (isDrawer()) {
      gsap.to(dialog, { yPercent: 100, duration: 0.28, ease: 'power3.in', onComplete: () => { done(); resolve(); } });
    } else {
      gsap.to(dialog, { opacity: 0, scale: 0.97, duration: 0.16, ease: 'power2.in', onComplete: () => { done(); resolve(); } });
    }
  });
}

// Drag the grip/head down to dismiss a drawer, with velocity.
function enableDragToClose(dialog) {
  const handle = dialog.querySelector('.sheet-grip')?.parentElement === dialog
    ? dialog.querySelectorAll('.sheet-grip, .sheet-head')
    : dialog.querySelectorAll('.sheet-head');
  handle.forEach((h) => {
    if (h._drag) return;
    h._drag = true;
    h.style.touchAction = 'none';
    let startY = 0; let lastY = 0; let lastT = 0; let v = 0; let dragging = false;
    h.addEventListener('pointerdown', (e) => {
      if (!isDrawer() || e.target.closest('button')) return;
      dragging = true; startY = lastY = e.clientY; lastT = performance.now(); v = 0;
      h.setPointerCapture(e.pointerId);
    });
    h.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - startY);
      const now = performance.now();
      v = (e.clientY - lastY) / Math.max(1, now - lastT);
      lastY = e.clientY; lastT = now;
      gsap.set(dialog, { y: dy });
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      const dy = lastY - startY;
      if (dy > 120 || v > 0.6) {
        gsap.to(dialog, { y: dialog.offsetHeight, duration: 0.22, ease: 'power2.in', onComplete: () => { gsap.set(dialog, { y: 0 }); closeSheet(dialog); } });
      } else {
        gsap.to(dialog, { y: 0, duration: 0.35, ease: 'expo.out' });
      }
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
  });
}

let toastHost = null;
let toastTimer = null;
let current = null;

export function toast(text, { kind = 'ok', ms = 1800 } = {}) {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.className = 'toast-host';
    toastHost.setAttribute('role', 'status');
    toastHost.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastHost);
  }
  const glyph = kind === 'ok' ? 'check' : kind === 'warn' ? 'warn' : kind === 'sync' ? 'cloudUp' : 'warn';
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(glyph)}<span></span>`;
  el.querySelector('span').textContent = text;
  if (current) {
    const old = current;
    gsap.to(old, { opacity: 0, y: -6, filter: 'blur(4px)', duration: 0.14, onComplete: () => old.remove() });
  }
  current = el;
  toastHost.appendChild(el);
  gsap.fromTo(el, { opacity: 0, y: -14, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'expo.out' });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    gsap.to(el, { opacity: 0, y: -10, duration: 0.2, ease: 'power2.in', onComplete: () => { el.remove(); if (current === el) current = null; } });
  }, ms);
}

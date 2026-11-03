// Injected before page scripts. Simulates a background tab in headless Chromium:
// document.hidden/visibilityState flip, visibilitychange fires, and requestAnimationFrame stops
// (callbacks are held and released on return, like a real background tab).
(() => {
  let hidden = false;
  const rAF = window.requestAnimationFrame.bind(window);
  const cAF = window.cancelAnimationFrame.bind(window);
  Object.defineProperty(Document.prototype, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible'), configurable: true });
  let nextId = 1e9;
  const held = new Map();
  window.requestAnimationFrame = (cb) => {
    if (!hidden) return rAF(cb);
    nextId += 1;
    held.set(nextId, cb);
    return nextId;
  };
  window.cancelAnimationFrame = (id) => { if (held.has(id)) held.delete(id); else cAF(id); };
  window.__setHidden = (h) => {
    if (h === hidden) return;
    hidden = h;
    if (h) window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    if (!h) {
      const cbs = [...held.values()];
      held.clear();
      cbs.forEach((cb) => rAF(cb));
      window.dispatchEvent(new Event('focus'));
    }
  };
})();

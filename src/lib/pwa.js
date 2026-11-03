// Service worker registration. Makes /gba installable and lets downloaded games run offline.
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.hostname === '127.0.0.1') return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/gba/sw.js', { scope: '/gba/' });
      const warm = () => {
        const urls = performance.getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(location.origin) && !u.includes('/api/') && !u.includes('/@') && !u.includes('/node_modules/'));
        urls.push(location.pathname.startsWith('/gba/play') ? '/gba/play' : '/gba/');
        (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: 'warm', urls });
      };
      // once a worker is active (first visit included), hand it everything this page loaded
      await navigator.serviceWorker.ready;
      warm();
    } catch { /* offline support is a bonus, never a blocker */ }
  });
}

// The library lives at /gba. Inside the installed app (and offline) /gba/ is the URL the
// service worker controls, so use that form there; both are served by the same rewrite.
export function libraryUrl() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  return !navigator.onLine || standalone ? '/gba/' : '/gba';
}

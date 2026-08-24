/* 1031CF Content Map — service worker. Shell cache-first; data network-first. */
const VERSION = 'v2026-08-23-4';
const SHELL = 'shell-' + VERSION;
const SHELL_FILES = ['./', 'index.html', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const DATA_CACHE = 'data-v1';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const name = url.pathname.split('/').pop();
  if (name === 'data.json' || name === 'annotations.json' || name === 'version.json') {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(DATA_CACHE).then(c => c.put(url.pathname, copy));
        return r;
      }).catch(() => caches.open(DATA_CACHE).then(c => c.match(url.pathname)))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request))
  );
});

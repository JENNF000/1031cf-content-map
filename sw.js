/* 1031 CF Content Map — service worker.
   Shell: cache-first (fast, offline). Data: network-first (fresh, offline fallback). */
const VERSION = "823e4595a6";
const SHELL = "shell-" + VERSION;
const DATA  = "data-" + VERSION;
const SHELL_FILES = [
  "./", "index.html", "app.js?v=6b595119e1", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // never touch api.github.com

  const isData = /\/(data|annotations|version)\.json$/.test(url.pathname);

  if (isData) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh && fresh.ok) (await caches.open(DATA)).put(req, fresh.clone());
        return fresh;
      } catch (err) {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        throw err;
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) {
      fetch(req).then(r => { if (r && r.ok) caches.open(SHELL).then(c => c.put(req, r)); }).catch(() => {});
      return hit;
    }
    try {
      const r = await fetch(req);
      if (r && r.ok) (await caches.open(SHELL)).put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === "navigate") {
        const idx = await caches.match("index.html", { ignoreSearch: true });
        if (idx) return idx;
      }
      throw err;
    }
  })());
});

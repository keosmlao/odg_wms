// ODG WMS service worker — minimal app-shell caching.
// Bumps on file change so the browser picks up new assets cleanly.

const CACHE_VERSION = "odg-wms-v1";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(RUNTIME_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname === "/manifest.json"
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API: never cache — go to network so data is always fresh.
  if (isApiRequest(url)) return;

  // Static assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch (err) {
          if (cached) return cached;
          throw err;
        }
      })(),
    );
    return;
  }

  // Pages: network-first with cache fallback so app loads offline.
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const fresh = await fetch(req);
        if (fresh.ok && (req.mode === "navigate" || req.destination === "")) {
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (_err) {
        const cached = await cache.match(req);
        if (cached) return cached;
        // Last-resort offline fallback page (if cached).
        const fallback = await cache.match("/stocktake");
        if (fallback) return fallback;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>Offline</h1><p>ບໍ່ສາມາດເຊື່ອມຕໍ່ — ກວດສອບ WiFi</p></body>',
          { status: 503, headers: { "Content-Type": "text/html" } },
        );
      }
    })(),
  );
});

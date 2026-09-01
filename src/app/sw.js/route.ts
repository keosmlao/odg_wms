/**
 * Service worker, served from a route handler instead of `public/sw.js`.
 *
 * ເປັນຫຍັງຈຶ່ງບໍ່ເປັນໄຟລ໌ໃນ public: sw.js ເກົ່າຕັ້ງ `CACHE_VERSION = "odg-wms-v1"`
 * ໄວ້ຄົງທີ່ ແລະ cache ໄຟລ໌ໃນ `/_next/static/` ແບບ cache-first ໂດຍບໍ່ມີວັນໝົດອາຍຸ.
 * Turbopack **ໃຊ້ຊື່ chunk ຊ້ຳກັນຂ້າມ build** (ເຊັ່ນ `05e7iabhln-mq.css` ຄືເກົ່າ
 * ທັງທີ່ເນື້ອໃນປ່ຽນ) — ຜົນຄື browser ຂອງຄົນໃຊ້ຈະໄດ້ CSS/JS ເກົ່າຢູ່ຕະຫຼອດ
 * ເຖິງວ່າ deploy ແລ້ວກໍ່ຕາມ ແລະ `activate` ກໍ່ບໍ່ເຄີຍລຶບ cache ເພາະຮຸ່ນບໍ່ເຄີຍປ່ຽນ.
 *
 * ວິທີແກ້: ໃສ່ຕົວເລກຮຸ່ນທີ່ **ປ່ຽນທຸກຄັ້ງທີ່ server ເລີ່ມໃໝ່**. ການ deploy ທຸກເທື່ອ
 * ຈົບດ້ວຍ `systemctl restart odg-wms` ຢູ່ແລ້ວ ດັ່ງນັ້ນ byte ຂອງ sw.js ຈຶ່ງປ່ຽນ →
 * browser ຮູ້ວ່າມີ SW ໃໝ່ → install → activate → ລຶບ cache ເກົ່າຖິ້ມ → ໄດ້ໂຄ້ດໃໝ່.
 * (ການ restart ດ້ວຍເຫດອື່ນກໍ່ລ້າງ cache ຄືກັນ — ເສຍແຕ່ໂຫຼດຊ້າຄັ້ງດຽວ ບໍ່ມີຜົນເສຍ.)
 */

// ປະເມີນເທື່ອດຽວຕອນ process ເລີ່ມ — ນີ້ຄື "ຮຸ່ນ" ຂອງ deploy ນີ້
const BUILD_STAMP = Date.now().toString(36);

export const dynamic = "force-dynamic";

const SW_SOURCE = `// ODG WMS service worker — app-shell caching, ຮຸ່ນຜູກກັບການ deploy.
const CACHE_VERSION = "odg-wms-${BUILD_STAMP}";
const RUNTIME_CACHE = CACHE_VERSION + "-runtime";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(RUNTIME_CACHE));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // ລຶບ cache ຂອງທຸກຮຸ່ນກ່ອນໜ້າ — ນີ້ຄືບ່ອນທີ່ໂຄ້ດເກົ່າຖືກຖິ້ມຈິງ
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
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

  // API: ບໍ່ cache ເລີຍ — ຂໍ້ມູນສາງຕ້ອງສົດສະເໝີ.
  if (isApiRequest(url)) return;

  // ໄຟລ໌ static: stale-while-revalidate — ຕອບຈາກ cache ທັນທີ ແລ້ວດຶງຂອງໃໝ່
  // ໄວ້ໃຫ້ຄັ້ງໜ້າ. ຮຸ່ນ cache ຜູກກັບ deploy ຢູ່ແລ້ວ ອັນນີ້ຈຶ່ງເປັນຊັ້ນປ້ອງກັນທີສອງ
  // ເຜື່ອວ່າ chunk ຖືກຕັ້ງຊື່ຊ້ຳພາຍໃນຮຸ່ນດຽວກັນ.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        if (cached) {
          event.waitUntil(network);
          return cached;
        }
        const fresh = await network;
        if (fresh) return fresh;
        throw new Error("offline and not cached");
      })(),
    );
    return;
  }

  // ໜ້າເວັບ: network-first ພ້ອມ cache ສຳຮອງ ເພື່ອໃຫ້ເປີດໄດ້ຕອນເນັດຫຼຸດ.
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
        const fallback = await cache.match("/m");
        if (fallback) return fallback;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem"><h1>Offline</h1><p>ບໍ່ສາມາດເຊື່ອມຕໍ່ — ກວດສອບ WiFi</p></body>',
          { status: 503, headers: { "Content-Type": "text/html" } },
        );
      }
    })(),
  );
});
`;

export async function GET() {
  return new Response(SW_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // sw.js ເອງຫ້າມ cache — ບໍ່ດັ່ງນັ້ນ browser ຈະບໍ່ເຫັນຮຸ່ນໃໝ່
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}

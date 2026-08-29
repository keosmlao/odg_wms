"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once on mount. The SW lives at /sw.js
 * and caches the app shell so the app can load when offline.
 *
 * Skipped in development (no SW) to avoid stale caching during hot
 * reload.
 */
export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    /**
     * ລຶບ cache ຂອງ service worker ຮຸ່ນເກົ່າຖິ້ມ.
     *
     * sw.js ຮຸ່ນທຳອິດຕັ້ງຊື່ cache ໄວ້ຄົງທີ່ວ່າ "odg-wms-v1" ແລະ ເກັບໄຟລ໌ໃນ
     * /_next/static/ ແບບ cache-first ບໍ່ມີວັນໝົດອາຍຸ. Turbopack ໃຊ້ຊື່ chunk
     * ຊ້ຳກັນຂ້າມ build ຈຶ່ງໝາຍຄວາມວ່າ browser ທີ່ເຄີຍເປີດແອັບກ່ອນໜ້ານີ້ ຈະໄດ້
     * CSS/JS ເກົ່າ **ຕະຫຼອດໄປ** ເຖິງວ່າ server ຈະ deploy ໃໝ່ແລ້ວກໍ່ຕາມ.
     *
     * ຮຸ່ນໃໝ່ຜູກຊື່ cache ກັບການ deploy ແລ້ວ ແຕ່ເຄື່ອງທີ່ຍັງຄ້າງ cache ເກົ່າຢູ່
     * ຕ້ອງມີໃຜໄປລຶບໃຫ້ — ຖ້າລໍໃຫ້ຄົນໃຊ້ໄປ clear site data ເອງ ຈະບໍ່ມີວັນເກີດ.
     * ລຶບຈາກໜ້າເວັບໂດຍກົງ (ບໍ່ຜ່ານ SW) ຈຶ່ງໄດ້ຜົນທັນທີ ແລະ ແລ່ນເທື່ອດຽວກໍ່ພໍ.
     */
    const evictLegacyCaches = async () => {
      if (!("caches" in window)) return;
      try {
        const keys = await caches.keys();
        const stale = keys.filter((k) => k.startsWith("odg-wms-v1"));
        if (stale.length === 0) return;
        await Promise.all(stale.map((k) => caches.delete(k)));
        // ໜ້າທີ່ກຳລັງເປີດຢູ່ຍັງໃຊ້ asset ເກົ່າທີ່ໂຫຼດໄປແລ້ວ — ໂຫຼດຄືນເທື່ອດຽວ
        // ເພື່ອດຶງຂອງໃໝ່. ຈາກຮອບນີ້ໄປ cache ຜູກກັບ deploy ຈຶ່ງບໍ່ເກີດອີກ.
        window.location.reload();
      } catch {
        /* browser ບາງໂຕປິດ Cache API ໄວ້ — ຂ້າມໄປ */
      }
    };

    const register = () => {
      navigator.serviceWorker
        // updateViaCache: "none" — ບັງຄັບໃຫ້ browser ຖາມ server ຫາ sw.js ໃໝ່ສະເໝີ
        // ແທນທີ່ຈະໃຊ້ສຳເນົາໃນ HTTP cache. ຖ້າບໍ່ມີອັນນີ້ ການ deploy ໃໝ່ອາດຈະ
        // ບໍ່ຮອດເຄື່ອງຄົນໃຊ້ຈົນກວ່າ cache ຈະໝົດອາຍຸເອງ.
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          // ກວດຫາຮຸ່ນໃໝ່ທຸກຄັ້ງທີ່ເປີດແອັບ — deploy ແລ້ວ refresh ເທື່ອດຽວກໍ່ເຫັນ
          void reg.update();
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener("statechange", () => {
              // ມີ SW ໃໝ່ພ້ອມໃຊ້ ແລະ ມີອັນເກົ່າຄຸມຢູ່ → ໂຫຼດໃໝ່ໃຫ້ເລີຍ
              if (next.state === "activated" && navigator.serviceWorker.controller) {
                window.location.reload();
              }
            });
          });
        })
        .catch((err) => {
          // Non-fatal; the app works without SW.
          console.warn("SW registration failed:", err);
        });
    };

    const start = () => {
      void evictLegacyCaches();
      register();
    };

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
  }, []);

  return null;
}

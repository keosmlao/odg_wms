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

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}

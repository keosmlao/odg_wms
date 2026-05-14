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
        .register("/sw.js", { scope: "/" })
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

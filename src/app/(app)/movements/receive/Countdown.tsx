"use client";

import { useEffect, useState } from "react";

/**
 * Live per-second countdown to a document's scheduled arrival (send_date).
 * Renders bold + red. `target` is a "YYYY-MM-DD" date (counts to its midnight).
 */
export default function Countdown({ target, className = "" }: { target: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  // Start ticking only after mount → avoids SSR/hydration mismatch.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const targetMs = new Date(`${target}T00:00:00`).getTime();

  if (now === null || !Number.isFinite(targetMs)) {
    return <span className={`font-bold text-red-600 dark:text-red-400 ${className}`}>{target}</span>;
  }

  const diff = targetMs - now;
  const future = diff >= 0;
  const abs = Math.abs(diff);
  const d = Math.floor(abs / 86_400_000);
  const h = Math.floor((abs % 86_400_000) / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const s = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${d > 0 ? `${d} ມື້ ` : ""}${pad(h)}:${pad(m)}:${pad(s)}`;

  return (
    <span className={`font-bold tabular-nums text-red-600 dark:text-red-400 ${className}`}>
      {future ? `ອີກ ${clock}` : `ກາຍກຳນົດ ${clock}`}
    </span>
  );
}

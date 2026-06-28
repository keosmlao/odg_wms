"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Health = { dead_items: number; dead_qty: number; sn_mismatch: number; cached?: boolean };

/** Async health chips for the home control-tower section — never blocks render. */
export default function HealthBadges() {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/movements/health");
        if (!res.ok) throw new Error();
        const d = (await res.json()) as Health;
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (err) return null;
  if (!data) {
    return <span className="text-[11px] text-zinc-400 animate-pulse">ກຳລັງກວດສຸຂະພາບ...</span>;
  }

  const ok = data.dead_items === 0 && data.sn_mismatch === 0;
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
        ✓ ສາງສຸຂະພາບດີ
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {data.dead_items > 0 && (
        <Link
          href="/movements/aging"
          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50"
        >
          ⚠ {data.dead_items.toLocaleString("en-US")} ສິນຄ້າຄ້າງ
        </Link>
      )}
      {data.sn_mismatch > 0 && (
        <Link
          href="/movements/sn-check"
          className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50"
        >
          ⚠ {data.sn_mismatch.toLocaleString("en-US")} SN ບໍ່ຕົງ
        </Link>
      )}
    </div>
  );
}

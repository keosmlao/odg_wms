"use client";

import { useEffect, useState } from "react";

type Kpi = { instock: number; issued: number; items: number };

/**
 * KPI counts loaded client-side so the page renders immediately instead of
 * blocking on the full-view count scan in odg_sn_balance.
 */
export default function SerialKpi({ wh }: { wh: string }) {
  const [kpi, setKpi] = useState<Kpi | null>(null);

  useEffect(() => {
    let cancelled = false;
    setKpi(null);
    const params = wh ? `?wh=${encodeURIComponent(wh)}` : "";
    fetch(`/api/serials/summary${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d?.instock === "number") setKpi(d as Kpi);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wh]);

  return (
    <div className="mt-4 grid grid-cols-3 gap-2.5">
      <Cell label="ຄົງເຫຼືອ" value={kpi?.instock} tone="emerald" />
      <Cell label="ສິນຄ້າ (ມີ SN)" value={kpi?.items} tone="aqua" />
      <Cell label="ຈ່າຍອອກແລ້ວ" value={kpi?.issued} tone="zinc" />
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: number | undefined; tone: "emerald" | "aqua" | "zinc" }) {
  const color =
    tone === "emerald" ? "text-emerald-600 dark:text-emerald-400" : tone === "aqua" ? "text-aqua-600 dark:text-aqua-400" : "text-zinc-700 dark:text-zinc-300";
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100 dark:bg-zinc-800/40 dark:ring-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      {value === undefined ? (
        <div className="mt-1 h-6 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
      ) : (
        <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${color}`}>{value.toLocaleString("en-US")}</div>
      )}
    </div>
  );
}

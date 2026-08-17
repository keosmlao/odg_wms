"use client";

import Link from "next/link";
import { useState } from "react";

type Serial = { sn: string; wh_code: string; wh_name: string | null; status_name: string | null };

/**
 * Expandable item row for the item-centric SN view. Lazy-loads the item's
 * serials from /api/serials on first open.
 */
export default function SerialItemGroup({
  itemCode,
  itemName,
  itemBrand,
  count,
  wh,
  status,
}: {
  itemCode: string;
  itemName: string | null;
  itemBrand: string | null;
  count: number;
  wh: string;
  status: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ item: itemCode, status, limit: "200" });
        if (wh) params.set("wh", wh);
        const res = await fetch(`/api/serials?${params}`);
        const data = (await res.json()) as { items?: Serial[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setSerials(data.items ?? []);
        setLoaded(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-aqua-50/40 dark:hover:bg-aqua-950/20"
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] font-semibold text-aqua-700 dark:text-aqua-300">{itemCode}</div>
          <div className="truncate text-sm text-zinc-800 dark:text-zinc-200" title={itemName ?? ""}>{itemName ?? "—"}</div>
          {itemBrand && <div className="text-[10px] text-zinc-500">{itemBrand}</div>}
        </div>
        <span className="shrink-0 rounded-full bg-aqua-50 px-2.5 py-1 text-xs font-bold tabular-nums text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">
          {count.toLocaleString("en-US")} SN
        </span>
      </button>

      {open && (
        <div className="border-t border-zinc-100 bg-zinc-50/50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-950/30">
          {loading && <div className="py-3 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>}
          {error && <div className="py-3 text-center text-xs text-red-500">{error}</div>}
          {loaded && serials.length === 0 && <div className="py-3 text-center text-xs text-zinc-400">ບໍ່ມີ serial</div>}
          {serials.map((s) => (
            <Link
              key={`${s.sn}-${s.wh_code}`}
              href={`/serials/${encodeURIComponent(s.sn)}`}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-white dark:hover:bg-zinc-800/60"
            >
              <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">{s.sn}</span>
              <span className="text-[10px] text-zinc-500">{s.wh_code}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

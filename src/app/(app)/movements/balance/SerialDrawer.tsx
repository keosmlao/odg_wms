"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SerialRow = {
  sn: string;
  wh_code: string;
  item_brand: string | null;
  status_name: string | null;
  first_in: string | null;   // earliest stock-in (purchase/entry)
  arrived_wh: string | null; // arrived at this warehouse
};

function ageDays(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d + "T00:00:00").getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

/**
 * In-page drawer: in-stock serials of one item at one warehouse, with age since
 * entry (ມື້ຊື້/ເຂົ້າ) and time at this warehouse (ມື້ມາສາງ). Links to detail.
 */
export default function SerialDrawer({
  open,
  itemCode,
  itemName,
  warehouse,
  scope = null,
  onClose,
}: {
  open: boolean;
  itemCode: string;
  itemName: string | null;
  warehouse: string;
  /** Exact storage node. When set, serials are narrowed to it so the count
   *  matches the location's stock balance ("" = stored at the level above). */
  scope?: { rack: string; location: string; pallet: string } | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SerialRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeRack = scope?.rack ?? "";
  const scopeLoc = scope?.location ?? "";
  const scopePallet = scope?.pallet ?? "";
  const scoped = scope !== null;

  useEffect(() => {
    if (!open || !itemCode || !warehouse) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ item: itemCode, wh: warehouse });
        if (scoped) {
          params.set("rack", scopeRack);
          params.set("location", scopeLoc);
          params.set("pallet", scopePallet);
        }
        const res = await fetch(`/api/serials/aged?${params}`);
        const data = (await res.json()) as { items?: SerialRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setRows(data.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, itemCode, warehouse, scoped, scopeRack, scopeLoc, scopePallet]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="close" onClick={onClose} className="flex-1 bg-black/40" />
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{itemCode}</div>
            <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{itemName ?? "—"}</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Serial ຄົງເຫຼືອ{warehouse ? ` · ສາງ ${warehouse}` : ""}{scoped && (scopePallet || scopeLoc || scopeRack) ? ` · ${scopePallet || scopeLoc || scopeRack}` : ""} ({rows.length.toLocaleString("en-US")})
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
              <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}
          {loading && <div className="px-5 py-10 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">ບໍ່ມີ serial ຄົງເຫຼືອ</div>
          )}
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r) => {
              const age = ageDays(r.first_in);
              const whAge = ageDays(r.arrived_wh);
              return (
                <li key={`${r.sn}-${r.wh_code}`}>
                  <Link
                    href={`/serials/${encodeURIComponent(r.sn)}`}
                    className="block px-5 py-2.5 transition hover:bg-violet-50/40 dark:hover:bg-violet-950/20"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-xs font-semibold text-violet-700 dark:text-violet-300">{r.sn}</div>
                      {r.item_brand && <span className="shrink-0 text-[10px] text-zinc-400">{r.item_brand}</span>}
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-md bg-zinc-50 px-2 py-1 dark:bg-zinc-800/40">
                        <div className="text-[9px] uppercase tracking-wide text-zinc-400">ອາຍຸ (ແຕ່ມື້ເຂົ້າ)</div>
                        <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {age === null ? "—" : `${age.toLocaleString("en-US")} ມື້`}
                          {r.first_in && <span className="ml-1 font-normal text-zinc-400">{r.first_in}</span>}
                        </div>
                      </div>
                      <div className="rounded-md bg-zinc-50 px-2 py-1 dark:bg-zinc-800/40">
                        <div className="text-[9px] uppercase tracking-wide text-zinc-400">ຢູ່ສາງນີ້</div>
                        <div className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {whAge === null ? "—" : `${whAge.toLocaleString("en-US")} ມື້`}
                          {r.arrived_wh && <span className="ml-1 font-normal text-zinc-400">{r.arrived_wh}</span>}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { StockLocationRow } from "@/app/api/movements/items/stock-locations/route";

function formatQty(value: string | null) {
  const n = Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return value ?? "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

export default function StockLocationsDrawer({
  open,
  itemCode,
  itemName,
  highlightWh,
  highlightLocation,
  onClose,
}: {
  open: boolean;
  itemCode: string;
  itemName: string | null;
  /** Warehouse code the client currently has selected (e.g. transfer-request's whFrom) — matching rows get highlighted. */
  highlightWh?: string;
  /** Shelf/condition code currently selected within highlightWh — matching row gets a stronger highlight. */
  highlightLocation?: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StockLocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !itemCode) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/movements/items/stock-locations?item_code=${encodeURIComponent(itemCode)}`);
        const data = (await res.json()) as { rows?: StockLocationRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
        setRows(data.rows ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, itemCode]);

  if (!open) return null;

  const total = rows.reduce((s, r) => s + (Number.parseFloat(r.balance_qty) || 0), 0);

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" aria-label="close" onClick={onClose} className="flex-1 bg-black/40" />
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex items-start justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <div className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{itemCode}</div>
            <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">{itemName ?? "—"}</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">ສະຕັອກທຸກສາງ (ERP) — ລວມ {formatQty(String(total))}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="close" className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <svg viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor"><path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4L11.4 10l4.3 4.3-1.4 1.4L10 11.4l-4.3 4.3-1.4-1.4L8.6 10 4.3 5.7z" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">ກຳລັງໂຫຼດ...</div>}
          {error && (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">ບໍ່ພົບສະຕັອກຢູ່ສາງໃດ</div>
          )}
          {!loading && rows.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">ສາງ</th>
                  <th className="px-4 py-2 font-medium">ຈຸດ (Location)</th>
                  <th className="px-4 py-2 text-right font-medium">ຈຳນວນ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const whMatch = !!highlightWh && r.wh_code === highlightWh;
                  const locMatch = whMatch && !!highlightLocation && r.location === highlightLocation;
                  const rowCls = locMatch
                    ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300 dark:bg-emerald-950/30 dark:ring-emerald-800"
                    : whMatch
                      ? "bg-blue-50 dark:bg-blue-950/20"
                      : "";
                  return (
                    <tr key={`${r.wh_code}-${r.location}-${i}`} className={`border-t border-zinc-100 text-zinc-800 dark:border-zinc-800 dark:text-zinc-200 ${rowCls}`}>
                      <td className="px-4 py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <div className={`font-mono text-xs font-semibold ${whMatch ? "text-blue-700 dark:text-blue-300" : ""}`}>{r.wh_code}</div>
                          {whMatch && <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">ສາງທີ່ເລືອກ</span>}
                        </div>
                        {r.wh_name && <div className="text-[10px] text-zinc-500">{r.wh_name}</div>}
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <div className={`font-mono text-xs ${locMatch ? "font-semibold text-emerald-700 dark:text-emerald-300" : ""}`}>{r.location || "—"}</div>
                          {locMatch && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">ຈຸດທີ່ເລືອກ</span>}
                        </div>
                        {r.location_name && <div className="text-[10px] text-zinc-500">{r.location_name}</div>}
                      </td>
                      <td className="px-4 py-2 text-right align-top font-mono text-xs font-semibold tabular-nums">
                        {formatQty(r.balance_qty)}
                        <div className="text-[10px] font-normal text-zinc-500">{r.unit_code ?? ""}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

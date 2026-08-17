"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertIcon, BuildingIcon, LayersIcon } from "@/components/ui/Icons";
import { SYNC_SOURCE_LABEL, fmtQty } from "@/lib/stockCard";

type WhState = {
  code: string; name: string | null; items: number; nodes: number; total_qty: string;
  synced_at: string | null; user_created: string | null;
};

export default function StockCardSync() {
  const [rows, setRows] = useState<WhState[]>([]);
  const [canSync, setCanSync] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyWh, setBusyWh] = useState<string | null>(null);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);

  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 4000); }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock-card/sync");
      const d = (await res.json()) as { warehouses?: WhState[]; can_sync?: boolean };
      setRows(d.warehouses ?? []); setCanSync(!!d.can_sync);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function sync(w: WhState) {
    // Re-baselining throws the previous opening set away and shifts every figure
    // on the card — never let that happen on a single stray click.
    const warn = w.items > 0
      ? `ສາງ ${w.code} ມີຍອດຕັ້ງຕົ້ນຢູ່ແລ້ວ ${w.items} ສິນຄ້າ / ${w.nodes} ບ່ອນເກັບ.\n\n⚠ Sync ໃໝ່ຈະ "ລຶບຂອງເກົ່າອອກທັງໝົດ" ແລ້ວໃສ່ຊຸດໃໝ່ທັບ.\n(ລາຍການເຄື່ອນໄຫວ +/− ບໍ່ຖືກແຕະຕ້ອງ)\n\nຕ້ອງການສືບຕໍ່ບໍ?`
      : `Sync ຍອດຕັ້ງຕົ້ນຂອງສາງ ${w.code} (ຮອດລະດັບ rack / location)?`;
    if (!window.confirm(warn)) return;

    setBusyWh(w.code);
    try {
      const res = await fetch("/api/stock-card/sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh: w.code }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; rows_before?: number; rows_after?: number };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ສາງ ${w.code}: sync ສຳເລັດ ${d.rows_after} ບ່ອນເກັບ (ທັບຂອງເກົ່າ ${d.rows_before} ບ່ອນເກັບ)`);
      await load();
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusyWh(null); }
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${toast.k === "ok" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300"}`}>
          {toast.t}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl bg-amber-50/60 p-4 ring-1 ring-amber-200 dark:bg-amber-950/15 dark:ring-amber-900/40">
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="space-y-1 text-xs text-amber-900 dark:text-amber-200">
          <div className="font-bold">ຍອດຕັ້ງຕົ້ນ ດຶງມາຈາກ {SYNC_SOURCE_LABEL} ທີລະສາງ</div>
          <div>· ດຶງ <b>ຮອດລະດັບ rack → location</b> — ນັບຍອດເປັນ SUM(qty × calc_flag) ຂອງແຕ່ລະບ່ອນເກັບ, ຂ້າມບ່ອນທີ່ຍອດເປັນ 0.</div>
          <div>· Sync ຄັ້ງໃໝ່ = <b>ທັບຂອງເກົ່າທັງໝົດ</b> ຂອງສາງນັ້ນ (ລາຍການເຄື່ອນໄຫວ +/− ບໍ່ຖືກແຕະຕ້ອງ).</div>
          {!canSync && <div className="font-bold text-rose-600 dark:text-rose-400">· ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດ sync — ຕ້ອງໃຫ້ຜູ້ຈັດການເປີດສິດໃນ ຕັ້ງຄ່າ › ຈັດການສິດເຂົ້າເຖິງ</div>}
        </div>
      </div>

      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {loading ? <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2">ສາງ</th>
                  <th className="px-4 py-2 text-right">ສິນຄ້າ</th>
                  <th className="px-4 py-2 text-right">ບ່ອນເກັບ</th>
                  <th className="px-4 py-2 text-right">ຍອດລວມ</th>
                  <th className="px-4 py-2">sync ຫຼ້າສຸດ</th>
                  <th className="px-4 py-2">ໂດຍ</th>
                  <th className="px-4 py-2 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((w) => (
                  <tr key={w.code}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <BuildingIcon className="h-4 w-4 text-zinc-400" />
                        <span>
                          <span className="block font-mono text-[12px] font-bold text-indigo-600 dark:text-indigo-400">{w.code}</span>
                          <span className="block text-[12px] text-zinc-600 dark:text-zinc-400">{w.name ?? "—"}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{w.items || <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-500">{w.nodes || <span className="text-zinc-300">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-600 dark:text-zinc-400">{w.items ? fmtQty(w.total_qty) : "—"}</td>
                    <td className="px-4 py-2.5 text-[11px] text-zinc-500">{w.synced_at ?? <span className="text-amber-600 dark:text-amber-400">ຍັງບໍ່ໄດ້ sync</span>}</td>
                    <td className="px-4 py-2.5 text-[11px] text-zinc-400">{w.user_created ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button type="button" onClick={() => void sync(w)} disabled={!canSync || busyWh !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-sm disabled:opacity-40">
                        <LayersIcon className="h-3.5 w-3.5" />
                        {busyWh === w.code ? "ກຳລັງ sync..." : w.items ? "Sync ໃໝ່" : "Sync"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

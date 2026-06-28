"use client";

import { useEffect, useState } from "react";

type Row = {
  doc_no: string;
  wh_code: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: string;
  calc_flag: number | null;
  doc_date: string | null;
  user_created: string | null;
};

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

export default function SnadjCleanup() {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ docs: string; net: string }>({ docs: "0", net: "0" });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<null | "delete" | "reverse">(null);
  const [confirm, setConfirm] = useState<null | "delete" | "reverse">(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/movements/sn-check/snadj`);
      const data = (await res.json()) as { summary?: { docs: string; net: string }; rows?: Row[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setSummary(data.summary ?? { docs: "0", net: "0" });
      setRows(data.rows ?? []);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function run(action: "delete" | "reverse") {
    setBusy(action);
    try {
      const res = await fetch(`/api/movements/sn-check/snadj`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; affected?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `${action === "delete" ? "ລຶບ" : "Reverse"} ສຳເລັດ · ${data.affected ?? 0} ແຖວ`);
      setConfirm(null);
      await load();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(null);
    }
  }

  const net = Number.parseFloat(summary.net) || 0;
  const docs = Number.parseInt(summary.docs, 10) || 0;

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">ເອກະສານ SNADJ (reconcile ແບບເກົ່າ)</div>
            <p className="mt-0.5 max-w-2xl text-xs text-zinc-500">
              ໃບປັບ stock ເກົ່າ (trans_flag 99, ref <code className="font-mono">sn-sync</code>) ທີ່ຫັກ stock WMS ຜິດ.
              <b className="text-rose-600 dark:text-rose-400"> Delete</b> = ລຶບ row (stock ກັບຄືນ) ·
              <b className="text-amber-600 dark:text-amber-400"> Reverse</b> = ຂຽນ movement ກົງກັນຂ້າມ offset (ເກັບ audit).
            </p>
          </div>
          <div className="flex items-center gap-5 text-right">
            <div>
              <div className="text-[10px] uppercase text-zinc-400">ໃບ</div>
              <div className="font-mono text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{docs}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-zinc-400">ຜົນຕໍ່ stock</div>
              <div className={`font-mono text-2xl font-bold tabular-nums ${net < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{net > 0 ? "+" : ""}{fmt(net)}</div>
            </div>
          </div>
        </div>

        {docs > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {confirm === "delete" ? (
              <span className="inline-flex items-center gap-1.5">
                <button type="button" onClick={() => run("delete")} disabled={!!busy} className="rounded-lg bg-gradient-to-r from-rose-500 to-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50">{busy === "delete" ? "ກຳລັງລຶບ..." : `ຢືນຢັນລຶບ ${docs} ໃບ`}</button>
                <button type="button" onClick={() => setConfirm(null)} disabled={!!busy} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">ຍົກເລີກ</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm("delete")} disabled={!!busy} className="rounded-lg bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 disabled:opacity-50 dark:bg-rose-950/30 dark:text-rose-300 dark:ring-rose-900/50">🗑 ລຶບທັງໝົດ</button>
            )}

            {confirm === "reverse" ? (
              <span className="inline-flex items-center gap-1.5">
                <button type="button" onClick={() => run("reverse")} disabled={!!busy} className="rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2 text-xs font-semibold text-white shadow-sm disabled:opacity-50">{busy === "reverse" ? "ກຳລັງ reverse..." : "ຢືນຢັນ Reverse"}</button>
                <button type="button" onClick={() => setConfirm(null)} disabled={!!busy} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">ຍົກເລີກ</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirm("reverse")} disabled={!!busy} className="rounded-lg bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">↺ Reverse (offset)</button>
            )}
            <button type="button" onClick={load} disabled={!!busy} className="text-xs font-semibold text-zinc-500 hover:underline">↻ ໂຫຼດຄືນ</button>
          </div>
        )}
      </section>

      {loading ? (
        <p className="py-8 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</p>
      ) : docs === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
          <div className="text-3xl">✅</div>
          <p className="mt-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">ບໍ່ມີ SNADJ ຄ້າງ — ສະອາດແລ້ວ</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                <th className="px-4 py-2">doc_no</th>
                <th className="px-4 py-2">ສາງ</th>
                <th className="px-4 py-2">ສິນຄ້າ</th>
                <th className="px-4 py-2">ວັນທີ</th>
                <th className="px-4 py-2 text-right">ຜົນຕໍ່ stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((r) => {
                const eff = (Number.parseFloat(r.qty) || 0) * (r.calc_flag ?? 0);
                return (
                  <tr key={r.doc_no}>
                    <td className="px-4 py-2 font-mono text-[11px] font-semibold text-zinc-800 dark:text-zinc-100">{r.doc_no}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{r.wh_code}</td>
                    <td className="px-4 py-2">
                      <div className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">{r.item_code}</div>
                      <div className="max-w-xs truncate text-[11px] text-zinc-500" title={r.item_name ?? ""}>{r.item_name ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{r.doc_date}</td>
                    <td className={`px-4 py-2 text-right font-mono text-xs font-bold tabular-nums ${eff < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{eff > 0 ? "+" : ""}{fmt(eff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.text}</div>
        </div>
      )}
    </div>
  );
}

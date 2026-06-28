"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertIcon, CheckIcon, SearchIcon, TrendIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };

type Kpi = { total: number; matched: number; mismatched: number; accuracy: number; total_abs_var: number };
type Row = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  sml: number;
  wms: number;
  sn: number;
  var_wms_sml: number;
};

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

export default function AccuracyClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<number | null>(null);

  async function load(refresh = false) {
    if (!whCode) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/movements/accuracy?wh=${encodeURIComponent(whCode)}${refresh ? "&refresh=1" : ""}`);
      const data = (await res.json()) as { kpi?: Kpi; rows?: Row[]; computed_at?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setKpi(data.kpi ?? null);
      setRows(data.rows ?? []);
      setComputedAt(data.computed_at ?? null);
      setLoaded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  // Single-warehouse users → run on load.
  useEffect(() => {
    if (whCode && !loaded && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.item_code.toLowerCase().includes(s) || (r.item_name ?? "").toLowerCase().includes(s));
  }, [rows, q]);

  const accColor = kpi
    ? kpi.accuracy >= 98
      ? "text-emerald-600 dark:text-emerald-400"
      : kpi.accuracy >= 90
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  const inputCls =
    "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-5">
      {/* controls */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ *</label>
            <select value={whCode} onChange={(e) => { setWhCode(e.target.value); setLoaded(false); setKpi(null); setRows([]); }} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => load(false)} disabled={!whCode || loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition hover:shadow-lg disabled:opacity-50">
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດຄວາມຖືກຕ້ອງ"}
          </button>
          {loaded && (
            <button type="button" onClick={() => load(true)} disabled={!whCode || loading} className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800" title="ຄຳນວນໃໝ່ (ບໍ່ໃຊ້ cache)">
              ↻ ຄຳນວນໃໝ່
            </button>
          )}
        </div>
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
        {loading && <p className="mt-3 text-xs text-zinc-400">ກຳລັງຄຳນວນ ERP / WMS / SN ... (ຄັ້ງທຳອິດ ~30 ວິ ສຳລັບສາງໃຫຍ່ — cache 10 ນາທີ)</p>}
        {!loading && computedAt && <p className="mt-3 text-[11px] text-zinc-400">ຄຳນວນເມື່ອ {new Date(computedAt).toLocaleTimeString("lo-LA")}</p>}
      </section>

      {kpi && (
        <>
          {/* KPI cards */}
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"><TrendIcon className="h-4 w-4" /> ຄວາມຖືກຕ້ອງ</div>
              <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${accColor}`}>{kpi.accuracy}%</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ເປົ້າ ≥ 98%</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ສິນຄ້າທັງໝົດ</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">{kpi.total.toLocaleString("en-US")}</div>
              <div className="mt-0.5 text-[11px] text-emerald-500">ກົງ {kpi.matched.toLocaleString("en-US")}</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ບໍ່ກົງ (WMS≠ERP)</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-rose-600 dark:text-rose-400">{kpi.mismatched.toLocaleString("en-US")}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ລາຍການ</div>
            </div>
            <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">ສ່ວນຕ່າງລວມ (|WMS−ERP|)</div>
              <div className="mt-2 font-mono text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400">{fmt(kpi.total_abs_var)}</div>
              <div className="mt-0.5 text-[11px] text-zinc-400">ໜ່ວຍ</div>
            </div>
          </section>

          {/* mismatch table */}
          <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                {kpi.mismatched === 0 ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400"><CheckIcon className="h-4 w-4" /> WMS ກົງ ERP ທຸກລາຍການ 🎉</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400"><AlertIcon className="h-4 w-4" /> ລາຍການ WMS ≠ ERP ({rows.length}{rows.length >= 500 ? "+" : ""})</span>
                )}
              </div>
              {kpi.mismatched > 0 && (
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
                  <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ກອງສິນຄ້າ..." className={`${inputCls} py-2 pl-8 text-xs`} />
                </div>
              )}
            </div>

            {kpi.mismatched === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
                <CheckIcon className="mx-auto h-8 w-8 text-emerald-400" />
                <p className="mt-2 text-xs font-semibold text-zinc-500">ບໍ່ມີຄວາມແຕກຕ່າງ</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-4 py-2.5">ສິນຄ້າ</th>
                      <th className="px-4 py-2.5 text-right">ERP (SML)</th>
                      <th className="px-4 py-2.5 text-right">WMS</th>
                      <th className="px-4 py-2.5 text-right">SN</th>
                      <th className="px-4 py-2.5 text-right">ຕ່າງ (WMS−ERP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filtered.map((r) => (
                      <tr key={r.item_code} className="align-middle">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{r.item_code}</div>
                          <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.item_name ?? ""}>{r.item_name ?? "—"}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(r.sml)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{r.unit_code}</span></td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(r.wms)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-500">{r.sn || "—"}</td>
                        <td className={`px-4 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${r.var_wms_sml > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{r.var_wms_sml > 0 ? "+" : ""}{fmt(r.var_wms_sml)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[11px] text-zinc-400">
              ⓘ ກວດ <b>WMS ທຽບ ERP (SML)</b> ເປັນຫຼັກ (ERP = ບັນຊີ). <b>+</b> = WMS ຫຼາຍກວ່າ ERP, <b>−</b> = WMS ໜ້ອຍກວ່າ. SN ສຳລັບສິນຄ້າ serial. ປັບໃຫ້ກົງຜ່ານ <span className="font-mono">/movements/adjust</span> ຫຼື ກວດ SN.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

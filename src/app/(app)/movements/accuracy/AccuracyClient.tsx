"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertIcon, CheckIcon, SearchIcon, TrendIcon } from "@/components/ui/Icons";
import { WarehouseGroup } from "@/components/ui/WarehouseGroup";

export type WarehouseOption = { code: string; name: string | null };

type Kpi = { total: number; matched: number; mismatched: number; accuracy: number; total_abs_var: number };
type Row = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  sml: number;
  wms: number;
  sn: number;
  /** ຈຳນວນທີ່ຢູ່ໃນໃບຝາກສາງທີ່ຍັງ active — ຂໍ້ມູນປະກອບ, ບໍ່ໄດ້ຫັກໃນ ຕ່າງ/%. */
  deposit: number;
  /** ຍອດທີ່ມາຈາກ "ປັບປຸງເພີ່ມເຂົ້າ" (WMS trans_flag 4) — ຂໍ້ມູນປະກອບເຊັ່ນກັນ. */
  adj_in: number;
  var_wms_sml: number;
};

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

type WhAcc = { code: string; name: string | null; kpi: Kpi | null; rows: Row[]; computedAt: number | null; err: string | null };

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

export default function AccuracyClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [results, setResults] = useState<WhAcc[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  /** ສະເພາະແຖວທີ່ WMS ສູງກວ່າ ERP ແລະ ມີຍອດ "ປັບປຸງເພີ່ມເຂົ້າ" — ຄືສາເຫດຫຼັກ. */
  const [adjOnly, setAdjOnly] = useState(false);

  const exportHref = `/api/movements/accuracy/export?${new URLSearchParams({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(adjOnly ? { adj: "1" } : {}),
  })}`;

  /** ບໍ່ມີການເລືອກສາງ — ກວດທຸກສາງທີ່ມີສິດ ແລ້ວສະແດງເປັນກຸ່ມຕໍ່ສາງ. */
  async function load(refresh = false) {
    setLoading(true);
    try {
      const all = await Promise.all(
        warehouses.map(async (w): Promise<WhAcc> => {
          try {
            const res = await fetch(`/api/movements/accuracy?wh=${encodeURIComponent(w.code)}${refresh ? "&refresh=1" : ""}`);
            const data = (await res.json()) as { kpi?: Kpi; rows?: Row[]; computed_at?: number; error?: string };
            if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
            return { code: w.code, name: w.name, kpi: data.kpi ?? null, rows: data.rows ?? [], computedAt: data.computed_at ?? null, err: null };
          } catch (e) {
            return { code: w.code, name: w.name, kpi: null, rows: [], computedAt: null, err: e instanceof Error ? e.message : "ບໍ່ສຳເລັດ" };
          }
        }),
      );
      setResults(all);
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      {/* controls */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <div className={`${inputCls} flex w-full items-center gap-2 font-bold`}>
              ທຸກສາງ
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{warehouses.length}</span>
            </div>
          </div>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ກອງສິນຄ້າ..." className={`${inputCls} py-2 pl-8 text-xs`} />
          </div>
          <label
            className={`inline-flex h-[42px] cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-bold ring-1 transition ${adjOnly ? "bg-orange-50 text-orange-700 ring-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:ring-orange-800" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"}`}
            title="ສະແດງແຕ່ແຖວທີ່ WMS ສູງກວ່າ ERP ແລະ ມີຍອດປັບປຸງເພີ່ມເຂົ້າ"
          >
            <input type="checkbox" checked={adjOnly} onChange={(e) => setAdjOnly(e.target.checked)} className="h-4 w-4 accent-orange-600" />
            ສະເພາະທີ່ຕ່າງເພາະປັບປຸງເພີ່ມເຂົ້າ
          </label>
          <button type="button" onClick={() => load(false)} disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:opacity-50">
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດຄວາມຖືກຕ້ອງ"}
          </button>
          <a
            href={exportHref}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg"
            title="ດຶງລາຍການ WMS ≠ ERP ອອກເປັນ Excel (ທຸກສາງ, ຕາມການກອງປັດຈຸບັນ)"
          >
            Excel
          </a>
          {loaded && (
            <button type="button" onClick={() => load(true)} disabled={loading} className="rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800" title="ຄຳນວນໃໝ່ (ບໍ່ໃຊ້ cache)">
              ↻ ຄຳນວນໃໝ່
            </button>
          )}
        </div>
        {loading && <p className="mt-3 text-xs text-zinc-400">ກຳລັງຄຳນວນ ERP / WMS / SN ທຸກສາງ ... (ຄັ້ງທຳອິດ ~30 ວິ ຕໍ່ສາງໃຫຍ່ — cache 10 ນາທີ)</p>}
      </section>

      {results.map((r) => (
        <WarehouseGroup key={r.code} code={r.code} name={r.name} tone="brand">
          <WhAccuracy r={r} q={q} adjOnly={adjOnly} />
        </WarehouseGroup>
      ))}
    </div>
  );
}

/** KPI + ຕາຕະລາງ WMS≠ERP ຂອງສາງໜຶ່ງ. */
function WhAccuracy({ r, q, adjOnly }: { r: WhAcc; q: string; adjOnly: boolean }) {
  const { kpi, rows } = r;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((x) => {
      if (adjOnly && !(x.adj_in > 0 && x.var_wms_sml > 0)) return false;
      if (s && !x.item_code.toLowerCase().includes(s) && !(x.item_name ?? "").toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, q, adjOnly]);

  const accColor = kpi
    ? kpi.accuracy >= 98
      ? "text-emerald-600 dark:text-emerald-400"
      : kpi.accuracy >= 90
        ? "text-amber-600 dark:text-amber-400"
        : "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  if (r.err) return <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{r.err}</p>;
  if (!kpi) return <p className="text-xs text-zinc-400">ກຳລັງຄຳນວນ...</p>;

  return (
    <div className="space-y-5">
      {r.computedAt && <p className="text-[11px] text-zinc-400">ຄຳນວນເມື່ອ {new Date(r.computedAt).toLocaleTimeString("lo-LA")}</p>}
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
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                    <AlertIcon className="h-4 w-4" /> ລາຍການ WMS ≠ ERP ({filtered.length}{!adjOnly && !q.trim() && rows.length >= 500 ? "+" : ""}
                    {filtered.length !== rows.length ? ` / ${rows.length}` : ""})
                  </span>
                )}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
                <CheckIcon className="mx-auto h-8 w-8 text-emerald-400" />
                <p className="mt-2 text-xs font-semibold text-zinc-500">
                  {kpi.mismatched === 0 ? "ບໍ່ມີຄວາມແຕກຕ່າງ" : "ບໍ່ມີແຖວທີ່ກົງກັບການກອງ"}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-4 py-2.5">ສິນຄ້າ</th>
                      <th className="px-4 py-2.5 text-right">ERP (SML)</th>
                      <th className="px-4 py-2.5 text-right" title="ຂອງທີ່ຂາຍແລ້ວ ຮັບຝາກໄວ້ໃນສາງ — ERP ຕັດ stock ໄປແລ້ວ ແຕ່ WMS ຍັງນັບ">ຝາກສາງ</th>
                      <th className="px-4 py-2.5 text-right" title="ຍອດທີ່ປັບເຂົ້າ WMS ດ້ວຍມື (ບໍ່ໄດ້ຜ່ານໃບຮັບ) — ຖ້າ ERP ບໍ່ໄດ້ລົງນຳ ຈະເຮັດໃຫ້ WMS ສູງກວ່າ ERP">ປັບປຸງເພີ່ມເຂົ້າ</th>
                      <th className="px-4 py-2.5 text-right">WMS</th>
                      <th className="px-4 py-2.5 text-right">SN</th>
                      <th className="px-4 py-2.5 text-right">ຕ່າງ (WMS−ERP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {filtered.map((r) => (
                      <tr key={r.item_code} className="align-middle">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{r.item_code}</div>
                          <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.item_name ?? ""}>{r.item_name ?? "—"}</div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-200">{fmt(r.sml)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{r.unit_code}</span></td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-amber-600 dark:text-amber-400" title={r.deposit ? "ຢູ່ໃນໃບຝາກສາງທີ່ຍັງ active" : undefined}>{r.deposit ? fmt(r.deposit) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-orange-600 dark:text-orange-400" title={r.adj_in ? "ປັບເຂົ້າ WMS ດ້ວຍມື — ກວດວ່າ ERP ລົງລາຍການດຽວກັນບໍ" : undefined}>
                          {r.adj_in ? fmt(r.adj_in) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                          {/* ປັບປຸງເພີ່ມເຂົ້າ ອະທິບາຍສ່ວນຕ່າງໄດ້ໝົດ → ໝາຍໃຫ້ເຫັນວ່າ "ນີ້ແຫຼະຄືສາເຫດ" */}
                          {r.adj_in > 0 && Math.abs(r.adj_in - r.var_wms_sml) < 0.001 && (
                            <span className="ml-1 rounded bg-orange-50 px-1 text-[9px] font-bold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300" title="ສ່ວນຕ່າງເທົ່າກັບຍອດປັບປຸງເພີ່ມເຂົ້າພໍດີ">= ຕ່າງ</span>
                          )}
                        </td>
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
              ⓘ ກວດ <b>WMS ທຽບ ERP (SML)</b> ເປັນຫຼັກ (ERP = ບັນຊີ). <b>+</b> = WMS ຫຼາຍກວ່າ ERP, <b>−</b> = WMS ໜ້ອຍກວ່າ. SN ສຳລັບສິນຄ້າ serial.
              <b> ຝາກສາງ</b> = ຂອງທີ່ອອກບິນແລ້ວ ຮັບຝາກໄວ້ໃນສາງ (ERP ຕັດ stock ໄປແລ້ວ ແຕ່ WMS ຍັງນັບ).
              <b> ປັບປຸງເພີ່ມເຂົ້າ</b> = ຍອດທີ່ປັບເຂົ້າ WMS ດ້ວຍມື ໂດຍບໍ່ໄດ້ຜ່ານໃບຮັບ — ຖ້າ ERP ບໍ່ໄດ້ລົງລາຍການດຽວກັນ WMS ຈະສູງກວ່າ ERP ຕະຫຼອດ (ປ້າຍ <b>= ຕ່າງ</b> ໝາຍວ່າສ່ວນຕ່າງມາຈາກສາເຫດນີ້ໝົດ).
              ສອງຄອລັມນີ້ອະທິບາຍ <b>+</b> ໄດ້ ແຕ່ <u>ບໍ່ໄດ້ຫັກ</u> ອອກຈາກ ຕ່າງ ແລະ %ຄວາມຖືກຕ້ອງ.
              ປັບໃຫ້ກົງຜ່ານ <span className="font-mono">/movements/adjust</span> ຫຼື ກວດ SN.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

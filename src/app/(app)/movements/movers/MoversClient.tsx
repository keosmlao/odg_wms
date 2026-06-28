"use client";

import { useEffect, useMemo, useState } from "react";

export type WarehouseOption = { code: string; name: string | null };
type Mover = { item_code: string; item_name: string | null; unit_code: string | null; qin: string; qout: string; outmoves: number };
type TrendPt = { d: string; inq: string; outq: string };
type Kpi = { total_in: number; total_out: number; active_items: number; active_days: number };
type SortKey = "qout" | "qin" | "outmoves";

function fmt(v: string | number) {
  const n = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function ddmm(d: string) {
  const [, m, day] = d.split("-");
  return `${day}/${m}`;
}

export default function MoversClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [from, setFrom] = useState(ago30);
  const [to, setTo] = useState(today);
  const [movers, setMovers] = useState<Mover[]>([]);
  const [trend, setTrend] = useState<TrendPt[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortKey>("qout");

  async function load() {
    if (!wh) return;
    setLoading(true);
    try {
      const p = new URLSearchParams({ wh, from, to });
      const res = await fetch(`/api/movements/movers?${p}`);
      const data = (await res.json()) as { movers?: Mover[]; trend?: TrendPt[]; kpi?: Kpi };
      setMovers(data.movers ?? []); setTrend(data.trend ?? []); setKpi(data.kpi ?? null);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wh]);

  const sorted = useMemo(() => {
    const v = (m: Mover) => sort === "qout" ? Number.parseFloat(m.qout) : sort === "qin" ? Number.parseFloat(m.qin) : m.outmoves;
    return [...movers].sort((a, b) => v(b) - v(a)).slice(0, 50);
  }, [movers, sort]);

  const trendMax = useMemo(() => Math.max(1, ...trend.map((t) => Math.max(Number.parseFloat(t.inq) || 0, Number.parseFloat(t.outq) || 0))), [trend]);

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ແຕ່</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຫາ</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <button type="button" onClick={load} disabled={loading || !wh} className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">{loading ? "..." : "ກອງ"}</button>
        </div>
      </section>

      {kpi && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kard label="ຮັບເຂົ້າລວມ" value={fmt(kpi.total_in)} tone="emerald" />
          <Kard label="ຈ່າຍອອກລວມ" value={fmt(kpi.total_out)} tone="rose" />
          <Kard label="ສິນຄ້າເຄື່ອນໄຫວ" value={kpi.active_items} tone="blue" />
          <Kard label="ມື້ມີການเคลื่อนไหว" value={kpi.active_days} tone="zinc" />
        </div>
      )}

      {trend.length > 0 && (
        <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">ແນວໂນ້ມ ເຂົ້າ/ອອກ ຕາມວັນ</h3>
            <div className="flex items-center gap-3 text-[11px]">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> ເຂົ້າ</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> ອອກ</span>
            </div>
          </div>
          <div className="flex h-40 items-end gap-1 overflow-x-auto">
            {trend.map((t) => {
              const inq = Number.parseFloat(t.inq) || 0, outq = Number.parseFloat(t.outq) || 0;
              return (
                <div key={t.d} className="flex min-w-[16px] flex-1 flex-col items-center gap-1" title={`${t.d}\nເຂົ້າ ${fmt(inq)} · ອອກ ${fmt(outq)}`}>
                  <div className="flex w-full items-end justify-center gap-0.5" style={{ height: "120px" }}>
                    <div className="w-1/2 rounded-t bg-emerald-400 dark:bg-emerald-500" style={{ height: `${(inq / trendMax) * 100}%` }} />
                    <div className="w-1/2 rounded-t bg-rose-400 dark:bg-rose-500" style={{ height: `${(outq / trendMax) * 100}%` }} />
                  </div>
                  <span className="text-[8px] text-zinc-400">{ddmm(t.d)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">Top 50 ສິນຄ້າເຄື່ອນໄຫວ</h3>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-0.5 text-[11px] dark:bg-zinc-800">
            {([["qout", "ອອກຫຼາຍ"], ["qin", "ເຂົ້າຫຼາຍ"], ["outmoves", "ຄັ້ງ"]] as [SortKey, string][]).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setSort(k)} className={`rounded-md px-2.5 py-1 font-semibold transition ${sort === k ? "bg-white text-blue-600 shadow-sm dark:bg-zinc-950 dark:text-blue-400" : "text-zinc-500"}`}>{l}</button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2.5 w-10">#</th><th className="px-4 py-2.5">ສິນຄ້າ</th><th className="px-4 py-2.5 text-right">ເຂົ້າ</th><th className="px-4 py-2.5 text-right">ອອກ</th><th className="px-4 py-2.5 text-center">ຄັ້ງ(ອອກ)</th></tr></thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sorted.length === 0 && !loading && <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-zinc-400">ບໍ່ມີຂໍ້ມູນ</td></tr>}
            {sorted.map((m, i) => (
              <tr key={m.item_code} className="transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-2.5 text-center font-mono text-xs text-zinc-400">{i + 1}</td>
                <td className="px-4 py-2.5"><span className="font-mono text-[11px] font-bold text-blue-600 dark:text-blue-400">{m.item_code}</span><div className="max-w-md truncate text-[13px] text-zinc-700 dark:text-zinc-300" title={m.item_name ?? ""}>{m.item_name}</div></td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{Number.parseFloat(m.qin) > 0 ? fmt(m.qin) : "—"}</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{Number.parseFloat(m.qout) > 0 ? fmt(m.qout) : "—"}<span className="ml-1 text-[10px] text-zinc-400">{m.unit_code}</span></td>
                <td className="px-4 py-2.5 text-center text-zinc-500">{m.outmoves}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kard({ label, value, tone }: { label: string; value: string | number; tone: "zinc" | "emerald" | "rose" | "blue" }) {
  const t = {
    zinc: "text-zinc-700 dark:text-zinc-200",
    emerald: "text-emerald-600 dark:text-emerald-400",
    rose: "text-rose-600 dark:text-rose-400",
    blue: "text-blue-600 dark:text-blue-400",
  }[tone];
  return (
    <div className="shadow-card rounded-xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-medium text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-bold tabular-nums ${t}`}>{value}</div>
    </div>
  );
}

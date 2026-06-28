"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronRightIcon, SearchIcon } from "@/components/ui/Icons";

export type WarehouseOption = { code: string; name: string | null };
type Row = {
  doc_no: string; wh_code: string; doc_date: string; doc_time: string | null;
  user_created: string | null; doc_ref: string | null; lines: number;
  qty_in: string | null; qty_out: string | null; net: string;
};
type LineRow = {
  item_code: string; item_name: string | null; qty: string; unit_code: string | null;
  calc_flag: number; rack: string | null; location: string | null; pallet: string | null;
};

const TYPES = [
  { v: "", label: "ທັງໝົດ" },
  { v: "in", label: "ຮັບເຂົ້າ" },
  { v: "out", label: "ຈ່າຍອອກ" },
  { v: "move", label: "ໂອນ/ຍ້າຍ" },
  { v: "adj", label: "ປັບປຸງ" },
  { v: "pallet", label: "Pallet" },
  { v: "sn", label: "Serial" },
];

function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function ddmmyyyy(d: string) {
  const [y, m, day] = d.split("-");
  return day && m && y ? `${day}-${m}-${y}` : d;
}
/** Operation label + tone from doc_no prefix, else net sign. */
function op(r: Row): { label: string; cls: string } {
  const dn = r.doc_no.toUpperCase();
  const net = Number.parseFloat(r.net) || 0;
  if (dn.startsWith("ADJ")) return { label: "ປັບປຸງ", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50" };
  if (dn.startsWith("PMV")) return { label: "ຍ້າຍ Pallet", cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/50" };
  if (dn.startsWith("SNMV")) return { label: "ຍ້າຍ Serial", cls: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50" };
  if (dn.startsWith("DP")) return { label: "ຈ່າຍອອກ", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50" };
  if (net > 0.0001) return { label: "ຮັບເຂົ້າ", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50" };
  if (net < -0.0001) return { label: "ຈ່າຍອອກ", cls: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50" };
  return { label: "ໂອນ/ຍ້າຍ", cls: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900/50" };
}

export default function LedgerClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const ago30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [from, setFrom] = useState(ago30);
  const [to, setTo] = useState(today);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, LineRow[]>>({});

  const load = useCallback(async (pg: number) => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ from, to, type, q, page: String(pg) });
      if (wh) p.set("wh", wh);
      const res = await fetch(`/api/movements/ledger?${p}`);
      const data = (await res.json()) as { rows?: Row[]; has_more?: boolean };
      setRows(data.rows ?? []);
      setHasMore(Boolean(data.has_more));
      setPage(pg);
      setExpanded(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, type, q, wh]);

  useEffect(() => { void load(0); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type, wh]);

  async function toggle(r: Row) {
    const key = `${r.doc_no}@${r.wh_code}`;
    if (expanded === key) { setExpanded(null); return; }
    setExpanded(key);
    if (!lines[key]) {
      const res = await fetch(`/api/movements/ledger?doc=${encodeURIComponent(r.doc_no)}&wh=${encodeURIComponent(r.wh_code)}`);
      const data = (await res.json()) as { lines?: LineRow[] };
      setLines((p) => ({ ...p, [key]: data.lines ?? [] }));
    }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
              {warehouses.length !== 1 && <option value="">ທຸກສາງ</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ແຕ່ວັນທີ</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຫາວັນທີ</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດ</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຄົ້ນຫາ (doc / ສິນຄ້າ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(0)} placeholder="ເລກ doc ຫຼື ລະຫັດສິນຄ້າ..." className={`${inputCls} w-full pl-8`} />
            </div>
          </div>
          <button type="button" onClick={() => load(0)} disabled={loading} className="rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
            {loading ? "..." : "ກອງ"}
          </button>
          <a
            href={`/api/movements/ledger?${new URLSearchParams({ from, to, type, q, ...(wh ? { wh } : {}), format: "csv" })}`}
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-200 transition hover:bg-emerald-50 dark:bg-zinc-900 dark:text-emerald-400 dark:ring-emerald-900/50"
          >
            ⬇ CSV
          </a>
          <button type="button" onClick={() => window.print()} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 print:hidden">
            🖨 Print
          </button>
        </div>
      </section>

      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
              <th className="px-4 py-2.5">ວັນທີ · ເວລາ</th>
              <th className="px-4 py-2.5">ເອກະສານ</th>
              <th className="px-4 py-2.5">ປະເພດ</th>
              <th className="px-4 py-2.5">ສາງ</th>
              <th className="px-4 py-2.5 text-right">ເຂົ້າ</th>
              <th className="px-4 py-2.5 text-right">ອອກ</th>
              <th className="px-4 py-2.5 text-center">ລາຍການ</th>
              <th className="px-4 py-2.5">ຜູ້ເຮັດ</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.length === 0 && !loading && (
              <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-zinc-400">ບໍ່ມີຂໍ້ມູນໃນຊ່ວງທີ່ເລືອກ</td></tr>
            )}
            {rows.map((r) => {
              const key = `${r.doc_no}@${r.wh_code}`;
              const o = op(r);
              const isOpen = expanded === key;
              return (
                <Fragment key={key}>
                  <tr onClick={() => toggle(r)} className="cursor-pointer transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2.5 whitespace-nowrap"><span className="font-medium text-zinc-700 dark:text-zinc-300">{ddmmyyyy(r.doc_date)}</span>{r.doc_time && <span className="ml-1.5 text-[11px] text-zinc-400">{r.doc_time}</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] font-semibold text-zinc-800 dark:text-zinc-200">{r.doc_no}{r.doc_ref && <span className="ml-1 block text-[10px] font-normal text-zinc-400">← {r.doc_ref}</span>}</td>
                    <td className="px-4 py-2.5"><span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${o.cls}`}>{o.label}</span></td>
                    <td className="px-4 py-2.5 text-zinc-500">{r.wh_code}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{Number.parseFloat(r.qty_in ?? "0") > 0 ? `+${fmt(r.qty_in)}` : "—"}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{Number.parseFloat(r.qty_out ?? "0") > 0 ? `−${fmt(r.qty_out)}` : "—"}</td>
                    <td className="px-4 py-2.5 text-center text-zinc-500">{r.lines}</td>
                    <td className="px-4 py-2.5 text-[12px] text-zinc-500">{r.user_created ?? "—"}</td>
                    <td className="px-2 py-2.5"><ChevronRightIcon className={`h-4 w-4 text-zinc-300 transition-transform ${isOpen ? "rotate-90" : ""}`} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-zinc-50/60 dark:bg-zinc-950/40">
                      <td colSpan={9} className="px-4 py-2">
                        {!lines[key] ? (
                          <div className="py-2 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>
                        ) : (
                          <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                            <table className="w-full text-[12px]">
                              <thead><tr className="bg-white text-left text-[10px] uppercase text-zinc-400 dark:bg-zinc-900"><th className="px-3 py-1.5">ສິນຄ້າ</th><th className="px-3 py-1.5 text-right">ຈຳນວນ</th><th className="px-3 py-1.5">ບ່ອນ</th></tr></thead>
                              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                {lines[key].map((l, i) => (
                                  <tr key={i} className="bg-white dark:bg-zinc-900/50">
                                    <td className="px-3 py-1.5"><span className="font-mono font-semibold text-blue-600 dark:text-blue-400">{l.item_code}</span> <span className="text-zinc-600 dark:text-zinc-300">{l.item_name}</span></td>
                                    <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${l.calc_flag < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{l.calc_flag < 0 ? "−" : "+"}{fmt(l.qty)} {l.unit_code}</td>
                                    <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-500">{[l.rack, l.location, l.pallet].filter(Boolean).join(" / ") || "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" disabled={page === 0 || loading} onClick={() => load(page - 1)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:ring-zinc-800">← ກ່ອນ</button>
          <span className="text-xs text-zinc-500">ໜ້າ {page + 1}</span>
          <button type="button" disabled={!hasMore || loading} onClick={() => load(page + 1)} className="rounded-lg bg-white px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 disabled:opacity-40 dark:bg-zinc-900 dark:ring-zinc-800">ຕໍ່ໄປ →</button>
        </div>
      )}
    </div>
  );
}

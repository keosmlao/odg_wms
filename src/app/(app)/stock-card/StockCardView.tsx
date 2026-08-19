"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { KpiCard, EmptyState } from "@/components/ui/Card";
import { LayersIcon, PackageIcon, SearchIcon, TrendIcon } from "@/components/ui/Icons";
import { UNLOCATED_LABEL, directionLabel, fmtQty } from "@/lib/stockCard";

export type WarehouseOption = { code: string; name: string | null };
type Option = { code: string; name: string | null };
type Row = {
  item_code: string; item_name: string | null; unit_code: string | null;
  opening: string; in_qty: string; out_qty: string; remaining: string;
  located: string; unlocated: string; entry_count: number;
};
type Totals = { items: number; opening: number; in_qty: number; out_qty: number; remaining: number; located: number; unlocated: number };
type NodeRow = {
  rack_code: string | null; location_code: string | null;
  qty: string; opening: string; moved: string;
};
type EntryRow = {
  roworder: number; doc_no: string; calc_flag: number; qty: string;
  rack_code: string | null; location_code: string | null;
  remark: string | null; user_created: string | null; created_at: string;
};
type Breakdown = {
  summary: { opening: number; in_qty: number; out_qty: number; remaining: number; located: number; unlocated: number };
  nodes: NodeRow[]; entries: EntryRow[];
};

const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

/** Negative stock is a real state here (see the API note on why no over-issue
 *  check exists) — it must read as a warning, not as an ordinary number. */
function qtyCls(v: string | number) {
  const n = typeof v === "number" ? v : Number.parseFloat(v) || 0;
  return n < 0 ? "text-rose-600 dark:text-rose-400" : "text-zinc-800 dark:text-zinc-200";
}

export default function StockCardView({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [groups, setGroups] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [group, setGroup] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [hideZero, setHideZero] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, Breakdown>>({});

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/stock-card/filters");
        const d = (await res.json()) as { groups?: Option[]; brands?: Option[]; categories?: Option[] };
        setGroups(d.groups ?? []); setBrands(d.brands ?? []); setCategories(d.categories ?? []);
      } catch { /* filters are a convenience — the card still loads without them */ }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!wh) { setRows([]); setTotals(null); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ wh });
      if (group) p.set("group", group);
      if (brand) p.set("brand", brand);
      if (category) p.set("category", category);
      if (q.trim()) p.set("q", q.trim());
      if (hideZero) p.set("hide_zero", "1");
      const res = await fetch(`/api/stock-card/report?${p}`);
      const d = (await res.json()) as { rows?: Row[]; totals?: Totals };
      setRows(d.rows ?? []); setTotals(d.totals ?? null);
      setOpenItem(null); setBreakdown({});
    } finally { setLoading(false); }
  }, [wh, group, brand, category, q, hideZero]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wh, group, brand, category, hideZero]);

  async function toggleItem(item: string) {
    if (openItem === item) { setOpenItem(null); return; }
    setOpenItem(item);
    if (breakdown[item]) return;
    try {
      const res = await fetch(`/api/stock-card/breakdown?wh=${encodeURIComponent(wh)}&item=${encodeURIComponent(item)}`);
      const d = (await res.json()) as Breakdown;
      setBreakdown((p) => ({ ...p, [item]: d }));
    } catch { /* leave the row expanded but empty — retryable by collapsing */ }
  }

  return (
    <div className="space-y-4">
      {/* filters */}
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${inputCls} w-full`}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ໝວດຫຼັກ (group_main)</label>
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທັງໝົດ —</option>
              {groups.map((g) => <option key={g.code} value={g.code}>{g.code}{g.name ? ` · ${g.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຍີ່ຫໍ້ (item_brand)</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທັງໝົດ —</option>
              {brands.map((b) => <option key={b.code} value={b.code}>{b.code}{b.name && b.name !== b.code ? ` · ${b.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດ (item_category)</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທັງໝົດ —</option>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.code}{c.name ? ` · ${c.name}` : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຄົ້ນຫາ ລະຫັດ / ຊື່</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }}
                placeholder="ພິມແລ້ວ Enter …" className={`${inputCls} w-full pl-9`} />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 pb-2 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} className="h-4 w-4 rounded" />
            ເຊື່ອງລາຍການທີ່ຄົງເຫຼືອ = 0
          </label>
          <button type="button" onClick={() => void load()} disabled={!wh || loading}
            className="rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-5 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-50">
            {loading ? "ກຳລັງໂຫຼດ..." : "ສະແດງ"}
          </button>
        </div>
      </section>

      {totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KpiCard icon={<PackageIcon className="h-4 w-4" />} label="ລາຍການ" value={String(totals.items)} tone="brand" compact />
          <KpiCard icon={<LayersIcon className="h-4 w-4" />} label="ຍອດຕັ້ງຕົ້ນ" value={fmtQty(totals.opening)} tone="neutral" compact />
          <KpiCard icon={<TrendIcon className="h-4 w-4" />} label="ຂາເຂົ້າ" value={`+${fmtQty(totals.in_qty)}`} tone="emerald" compact />
          <KpiCard icon={<TrendIcon className="h-4 w-4" />} label="ຂາອອກ" value={`−${fmtQty(totals.out_qty)}`} tone="red" compact />
          <KpiCard icon={<PackageIcon className="h-4 w-4" />} label="ຄົງເຫຼືອ" value={fmtQty(totals.remaining)} tone="navy" highlight compact />
        </div>
      )}

      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {!wh ? <div className="py-12 text-center text-sm text-zinc-400">ເລືອກສາງເພື່ອເບິ່ງບັດສະຕັອກ</div>
        : loading ? <div className="py-12 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
        : rows.length === 0 ? (
          <EmptyState icon={<PackageIcon className="h-6 w-6" />} title="ບໍ່ມີຂໍ້ມູນ"
            description="ຍັງບໍ່ໄດ້ sync ຍອດຕັ້ງຕົ້ນ ຫຼື ບໍ່ມີລາຍການທີ່ຕົງກັບການກອງ" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2">ສິນຄ້າ</th>
                  <th className="px-4 py-2 text-right">ຍອດຕັ້ງຕົ້ນ</th>
                  <th className="px-4 py-2 text-right">ຂາເຂົ້າ</th>
                  <th className="px-4 py-2 text-right">ຂາອອກ</th>
                  <th className="px-4 py-2 text-right">ຄົງເຫຼືອ</th>
                  <th className="px-4 py-2 text-right">ຢູ່ບ່ອນເກັບ</th>
                  <th className="px-4 py-2 text-right">{UNLOCATED_LABEL}</th>
                  <th className="px-4 py-2">ໜ່ວຍ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((r) => {
                  const bd = breakdown[r.item_code];
                  return (
                    <Fragment key={r.item_code}>
                      <tr onClick={() => void toggleItem(r.item_code)}
                        className="cursor-pointer transition hover:bg-aqua-50/40 dark:hover:bg-aqua-950/10">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`shrink-0 text-zinc-400 transition-transform ${openItem === r.item_code ? "rotate-90" : ""}`}>›</span>
                            <span className="min-w-0">
                              <span className="block font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{r.item_code}</span>
                              <span className="block max-w-md truncate text-[13px] text-zinc-700 dark:text-zinc-300">{r.item_name ?? "—"}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-zinc-500">{fmtQty(r.opening)}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{Number.parseFloat(r.in_qty) ? `+${fmtQty(r.in_qty)}` : "—"}</td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">{Number.parseFloat(r.out_qty) ? `−${fmtQty(r.out_qty)}` : "—"}</td>
                        <td className={`px-4 py-2 text-right font-mono font-bold tabular-nums ${qtyCls(r.remaining)}`}>{fmtQty(r.remaining)}</td>
                        <td className={`px-4 py-2 text-right font-mono tabular-nums ${qtyCls(r.located)}`}>{fmtQty(r.located)}</td>
                        {/* normally 0 now that the sync places stock in bins — keep it visible
                            only when it isn't, so a missing shelf code stands out */}
                        <td className={`px-4 py-2 text-right font-mono tabular-nums ${qtyCls(r.unlocated)}`}>{Number.parseFloat(r.unlocated) ? fmtQty(r.unlocated) : <span className="text-zinc-300 dark:text-zinc-600">—</span>}</td>
                        <td className="px-4 py-2 text-[11px] text-zinc-400">{r.unit_code ?? "—"}</td>
                      </tr>
                      {openItem === r.item_code && (
                        <tr>
                          <td colSpan={8} className="bg-zinc-50/60 px-4 py-3 dark:bg-zinc-950/30">
                            {!bd ? <div className="text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div> : (
                              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                                <div>
                                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">ຍອດຕາມບ່ອນເກັບ (rack / location)</div>
                                  {bd.nodes.length === 0 ? (
                                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີການລະບຸບ່ອນເກັບ</div>
                                  ) : (
                                    <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                                      <table className="w-full bg-white text-xs dark:bg-zinc-900">
                                        <thead>
                                          <tr className="bg-zinc-50 text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/50">
                                            <th className="px-3 py-1 text-left">rack / location</th>
                                            <th className="px-3 py-1 text-right">ຕັ້ງຕົ້ນ</th>
                                            <th className="px-3 py-1 text-right">ບັນທຶກມື</th>
                                            <th className="px-3 py-1 text-right">ຄົງເຫຼືອ</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                          {bd.nodes.map((n, i) => (
                                            <tr key={i}>
                                              <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">{n.rack_code ?? "—"}{n.location_code ? ` / ${n.location_code}` : ""}</td>
                                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-400">{fmtQty(n.opening)}</td>
                                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-400">{Number.parseFloat(n.moved) ? fmtQty(n.moved) : "—"}</td>
                                              <td className={`px-3 py-1.5 text-right font-mono font-bold tabular-nums ${qtyCls(n.qty)}`}>{fmtQty(n.qty)}</td>
                                            </tr>
                                          ))}
                                          {/* since 028 the sync places stock in bins, so this row should read 0 —
                                              anything else means a row came through with no shelf code */}
                                          {Number(bd.summary.unlocated) !== 0 && (
                                            <tr className="bg-amber-50/60 dark:bg-amber-950/20">
                                              <td className="px-3 py-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{UNLOCATED_LABEL}</td>
                                              <td className="px-3 py-1.5" />
                                              <td className="px-3 py-1.5" />
                                              <td className={`px-3 py-1.5 text-right font-mono font-bold tabular-nums ${qtyCls(bd.summary.unlocated)}`}>{fmtQty(bd.summary.unlocated)}</td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                                <div>
                                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-500">ປະຫວັດເຄື່ອນໄຫວ ({bd.entries.length})</div>
                                  {bd.entries.length === 0 ? (
                                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-zinc-400 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີການເຄື່ອນໄຫວ — ມີແຕ່ຍອດຕັ້ງຕົ້ນ</div>
                                  ) : (
                                    <div className="max-h-64 overflow-y-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                                      <table className="w-full bg-white text-xs dark:bg-zinc-900">
                                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                          {bd.entries.map((e) => (
                                            <tr key={e.roworder}>
                                              <td className="px-3 py-1.5">
                                                <span className={`font-semibold ${e.calc_flag === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{directionLabel(e.calc_flag)}</span>
                                                <span className="ml-2 font-mono text-[10px] text-zinc-400">{e.doc_no}</span>
                                              </td>
                                              <td className="px-3 py-1.5 font-mono text-[10px] text-zinc-500">{e.rack_code ? `${e.rack_code}${e.location_code ? ` / ${e.location_code}` : ""}` : UNLOCATED_LABEL}</td>
                                              <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums">{e.calc_flag === 1 ? "+" : "−"}{fmtQty(e.qty)}</td>
                                              <td className="px-3 py-1.5 text-right text-[10px] text-zinc-400">{e.created_at}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
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
          </div>
        )}
      </section>
    </div>
  );
}

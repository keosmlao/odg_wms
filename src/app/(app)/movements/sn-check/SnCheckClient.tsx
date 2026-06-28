"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertIcon, CheckIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import ManualMoveModal from "./ManualMoveModal";

export type WarehouseOption = { code: string; name: string | null };

type Row = {
  rack: string;
  location: string;
  pallet: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  stock_qty: string;
  sn_count: number;
  diff: string;
  pallet_rack: string | null;
  pallet_location: string | null;
};

type SerialLoc = {
  sn: string;
  isn: string | null;
  rack: string | null;
  location: string | null;
  pallet: string | null;
  pallet_rack?: string | null;
  pallet_location?: string | null;
  pallet_missing?: boolean;
};
type WmsLoc = { rack: string; location: string; pallet: string; qty: string };

function locLabel(rack: string | null, location: string | null, pallet: string | null) {
  return [rack, location, pallet].filter(Boolean).join(" / ") || "(ສາງ)";
}

function fmt(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function rowKey(r: Row) {
  return `${r.item_code}@${r.rack}/${r.location}/${r.pallet}`;
}

export default function SnCheckClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [rows, setRows] = useState<Row[]>([]);
  const [itemTotals, setItemTotals] = useState<Record<string, { sml: string; wms_total: string; sn_total: number }>>({});
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // rowKey being reconciled
  const [bulkRunning, setBulkRunning] = useState(false);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // "Where are the serials really?" drill-down.
  const [snModal, setSnModal] = useState<{ item_code: string; item_name: string | null } | null>(null);
  const [snList, setSnList] = useState<SerialLoc[]>([]);
  const [snWms, setSnWms] = useState<WmsLoc[]>([]);
  const [snLoading, setSnLoading] = useState(false);
  const [manualItem, setManualItem] = useState<{ item_code: string; item_name: string | null } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  // Single-warehouse users (e.g. a warehouse manager) → run the check on load,
  // no need to press "ກວດສອບ".
  useEffect(() => {
    if (whCode && !loaded && !loading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!whCode) {
      showToast("err", "ກະລຸນາເລືອກສາງ");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ wh: whCode });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/movements/sn-check?${params}`);
      const data = (await res.json()) as {
        rows?: Row[];
        items?: { item_code: string; sml: string; wms_total: string; sn_total: number }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setRows(data.rows ?? []);
      const totals: Record<string, { sml: string; wms_total: string; sn_total: number }> = {};
      for (const it of data.items ?? []) totals[it.item_code] = { sml: it.sml, wms_total: it.wms_total, sn_total: it.sn_total };
      setItemTotals(totals);
      setLoaded(true);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  // Reconcile is per-ITEM: it relocates the item's serials in sn_inventory so they
  // sit at the same locations (and counts) as the WMS stock.
  async function reconcile(itemCode: string): Promise<{ moved: number; unfilled: number; surplus: number; doc_no: string | null }> {
    const res = await fetch(`/api/movements/sn-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wh_code: whCode, item_code: itemCode }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string; moved?: number; unfilled?: number; surplus?: number; doc_no?: string | null };
    if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
    return { moved: data.moved ?? 0, unfilled: data.unfilled ?? 0, surplus: data.surplus ?? 0, doc_no: data.doc_no ?? null };
  }

  async function reconcileOne(r: Row) {
    setBusy(r.item_code);
    try {
      const d = await reconcile(r.item_code);
      const extra = d.unfilled || d.surplus ? ` (ຍັງຕ່າງ: ${d.unfilled ? `ຂາດ SN ${d.unfilled}` : ""}${d.unfilled && d.surplus ? ", " : ""}${d.surplus ? `SN ເກີນ ${d.surplus}` : ""})` : "";
      const docPart = d.doc_no ? ` · ເອກະສານ ${d.doc_no}` : d.moved === 0 ? " (ບໍ່ມີ SN ຕ້ອງຍ້າຍ)" : "";
      showToast(d.unfilled || d.surplus ? "err" : "ok", `ຍ້າຍ ${d.moved} SN → ຕາມ WMS${docPart}${extra}`);
      await load();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(null);
    }
  }

  async function reconcileAll() {
    const items = Array.from(new Set(filtered.map((r) => r.item_code)));
    if (items.length === 0) return;
    setBulkRunning(true);
    let ok = 0;
    let fail = 0;
    let moved = 0;
    for (const item of items) {
      try {
        const d = await reconcile(item);
        moved += d.moved;
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkRunning(false);
    await load();
    showToast(fail ? "err" : "ok", `ປັບ ${ok} ສິນຄ້າ · ຍ້າຍ ${moved} SN${fail ? ` · ລົ້ມເຫຼວ ${fail}` : ""}`);
  }

  async function openSnList(r: Row) {
    setSnModal({ item_code: r.item_code, item_name: r.item_name });
    setSnLoading(true);
    setSnList([]);
    setSnWms([]);
    try {
      const res = await fetch(
        `/api/movements/sn-check?wh=${encodeURIComponent(whCode)}&item=${encodeURIComponent(r.item_code)}`,
      );
      const data = (await res.json()) as { wms?: WmsLoc[]; serials?: SerialLoc[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setSnList(data.serials ?? []);
      setSnWms(data.wms ?? []);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ໂຫຼດ SN ບໍ່ສຳເລັດ");
    } finally {
      setSnLoading(false);
    }
  }

  // Filtering by item is done server-side (the top search box → API), so the
  // loaded rows are already scoped.
  const filtered = rows;

  // Group the mismatched nodes by item so each product is one easy-to-read card.
  const byItem = useMemo(() => {
    const m = new Map<string, { item_code: string; item_name: string | null; unit_code: string | null; locs: Row[] }>();
    for (const r of filtered) {
      let g = m.get(r.item_code);
      if (!g) {
        g = { item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code, locs: [] };
        m.set(r.item_code, g);
      }
      g.locs.push(r);
    }
    return Array.from(m.values());
  }, [filtered]);

  const whName = useMemo(() => warehouses.find((w) => w.code === whCode)?.name ?? null, [warehouses, whCode]);

  const inputCls =
    "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-violet-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-5">
      {/* Controls */}
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ *</label>
            <select value={whCode} onChange={(e) => { setWhCode(e.target.value); setRows([]); setLoaded(false); }} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code}
                  {w.name ? ` · ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສິນຄ້າ (ທາງເລືອກ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") load(); }}
                placeholder="ລະຫັດ ຫຼື ຊື່ສິນຄ້າ (ວ່າງ = ທັງສາງ)"
                className={`${inputCls} w-full pl-8`}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={!whCode || loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition hover:shadow-lg disabled:opacity-50"
          >
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດສອບ"}
          </button>
        </div>
      </section>

      {loaded && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {rows.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckIcon className="h-4 w-4" /> ທຸກລາຍການ serial ຕົງກັບ stock ({whCode}{whName ? ` · ${whName}` : ""})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                  <AlertIcon className="h-4 w-4" /> ພົບ {byItem.length} ສິນຄ້າ · {rows.length} ບ່ອນບໍ່ຕົງ
                </span>
              )}
            </div>
            {rows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={reconcileAll}
                  disabled={bulkRunning || filtered.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:shadow disabled:opacity-50"
                >
                  <CheckIcon className="h-3.5 w-3.5" />
                  {bulkRunning ? "ກຳລັງປັບ..." : `ຍ້າຍ SN ໃຫ້ຕົງທັງໝົດ (${byItem.length})`}
                </button>
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
              <CheckIcon className="mx-auto h-8 w-8 text-emerald-400" />
              <p className="mt-2 text-xs font-semibold text-zinc-500">ບໍ່ມີຄວາມແຕກຕ່າງ</p>
            </div>
          ) : (
            <div className="space-y-3">
              {byItem.map((g) => {
                const working = busy === g.item_code;
                return (
                  <div key={g.item_code} className="overflow-hidden rounded-2xl ring-1 ring-zinc-200 dark:ring-zinc-800">
                    {/* item header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
                      <div className="min-w-0">
                        <div className="font-mono text-sm font-bold text-violet-600 dark:text-violet-400">{g.item_code}</div>
                        <div className="truncate text-xs text-zinc-600 dark:text-zinc-300" title={g.item_name ?? ""}>{g.item_name ?? "—"}</div>
                        {itemTotals[g.item_code] && (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
                            <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">SML {fmt(itemTotals[g.item_code].sml)}</span>
                            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">WMS {fmt(itemTotals[g.item_code].wms_total)}</span>
                            <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">SN {itemTotals[g.item_code].sn_total}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          {g.locs.length} ບ່ອນບໍ່ຕົງ
                        </span>
                        <button
                          type="button"
                          onClick={() => openSnList(g.locs[0])}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                        >
                          ເບິ່ງ SN
                        </button>
                        <button
                          type="button"
                          onClick={() => setManualItem({ item_code: g.item_code, item_name: g.item_name })}
                          disabled={working || bulkRunning}
                          className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-violet-300 dark:ring-violet-900/50 dark:hover:bg-violet-950/30"
                          title="ເລືອກເອງ ວ່າ SN ໃດ ໄປ location ໃດ"
                        >
                          ເລືອກເອງ
                        </button>
                        <button
                          type="button"
                          onClick={() => reconcileOne(g.locs[0])}
                          disabled={working || bulkRunning}
                          className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:shadow disabled:opacity-50"
                          title="ຍ້າຍ SN ໄປ location ຕາມ WMS (ອັດຕະໂນມັດ)"
                        >
                          {working ? "ກຳລັງຍ້າຍ..." : "ຍ້າຍອັດຕະໂນມັດ"}
                        </button>
                      </div>
                    </div>
                    {/* per-location comparison */}
                    <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {g.locs.map((r) => {
                        const diff = Number.parseFloat(r.diff) || 0; // sn − stock
                        const loc = [r.rack, r.location, r.pallet].filter(Boolean).join(" / ") || "(ສາງ)";
                        const palLoc = r.pallet ? ([r.pallet_rack, r.pallet_location].filter(Boolean).join(" / ") || null) : null;
                        return (
                          <div key={rowKey(r)} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-zinc-700 dark:text-zinc-200">
                              📍 {loc}
                              {r.pallet && (
                                <span className="text-[11px] text-zinc-400">
                                  · 📦 {r.pallet}
                                  {palLoc ? ` → ${palLoc}` : " (ບໍ່ມີໃນລະບົບ pallet)"}
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2 font-mono text-sm tabular-nums">
                              <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                                WMS <b>{fmt(r.stock_qty)}</b>
                              </span>
                              <span className="text-zinc-300 dark:text-zinc-600">›</span>
                              <span className="rounded-md bg-violet-50 px-2 py-1 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                                SN <b>{r.sn_count}</b>
                              </span>
                              {diff < 0 ? (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                                  ຂາດ SN {fmt(Math.abs(diff))}
                                </span>
                              ) : (
                                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">
                                  SN ເກີນ {fmt(diff)}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <PackageIcon className="h-3.5 w-3.5" />
            ການປັບຈະ <b>ຍ້າຍ location ຂອງ SN</b> ໃນ sn_inventory ໃຫ້ກະຈາຍຕາມ location ແລະ ຈຳນວນຂອງ WMS stock (ຖື location WMS ເປັນຫຼັກ) — ບໍ່ໄດ້ແຕະຍອດ stock. ກົດ "ເບິ່ງ SN" ເພື່ອເບິ່ງວ່າ SN ໃດຢູ່ບ່ອນໃດ ກ່ອນປັບ.
          </p>
        </section>
      )}

      {/* SN locations drill-down */}
      {snModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSnModal(null)}>
          <div className="flex max-h-[82vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
              <div className="min-w-0">
                <div className="font-mono text-xs font-bold text-violet-600 dark:text-violet-400">{snModal.item_code}</div>
                <div className="truncate text-xs text-zinc-500">{snModal.item_name}</div>
              </div>
              <span className="shrink-0 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50">
                WMS {fmt(snWms.reduce((n, w) => n + (Number.parseFloat(w.qty) || 0), 0))} · SN {snList.length}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {snLoading ? (
                <p className="py-8 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</p>
              ) : snList.length === 0 && snWms.length === 0 ? (
                <p className="py-8 text-center text-xs text-zinc-400">ບໍ່ມີຂໍ້ມູນ</p>
              ) : (
                (() => {
                  // Group serials by their pallet → show which pallet each ISN is
                  // on and where that pallet sits (odg_wms_pallet location).
                  const NO_PALLET = " nopallet";
                  const groups = new Map<string, SerialLoc[]>();
                  for (const s of snList) {
                    const key = (s.pallet ?? "").trim() || NO_PALLET;
                    const arr = groups.get(key);
                    if (arr) arr.push(s);
                    else groups.set(key, [s]);
                  }
                  return Array.from(groups.entries()).map(([pal, sns]) => {
                    const first = sns[0];
                    const hasPallet = pal !== NO_PALLET;
                    const palLoc = locLabel(first.pallet_rack ?? null, first.pallet_location ?? null, null);
                    const missing = !!first.pallet_missing;
                    return (
                      <div key={pal} className={`mb-3 overflow-hidden rounded-xl ring-1 ${missing ? "ring-red-300 dark:ring-red-800" : "ring-zinc-200 dark:ring-zinc-800"}`}>
                        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${missing ? "bg-red-50 dark:bg-red-950/30" : "bg-zinc-50 dark:bg-zinc-800/50"}`}>
                          <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-200">
                            📦 {hasPallet ? `Pallet ${pal}` : "ບໍ່ມີ pallet"}
                          </span>
                          <span className="flex items-center gap-2 font-mono text-[11px]">
                            {hasPallet ? (
                              missing ? (
                                <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:bg-red-950/50 dark:text-red-300">pallet ບໍ່ມີໃນລະບົບ</span>
                              ) : (
                                <span className="text-zinc-600 dark:text-zinc-300">📍 {palLoc}</span>
                              )
                            ) : (
                              <span className="text-zinc-500">📍 {locLabel(first.rack, first.location, null)}</span>
                            )}
                            <span className="font-bold text-violet-600 dark:text-violet-400">{sns.length} SN</span>
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 p-2.5">
                          {sns.map((s) => {
                            // Serial's own recorded location vs where its pallet really is.
                            const snLoc = locLabel(s.rack, s.location, null);
                            const off = hasPallet && !missing && snLoc !== palLoc;
                            return (
                              <span
                                key={s.sn}
                                className={`rounded-md px-2 py-1 font-mono text-[11px] ring-1 ${off ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50" : "bg-white text-zinc-700 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"}`}
                                title={`${s.isn ? `ISN ${s.isn}` : s.sn}${off ? ` · ບັນທຶກຢູ່ ${snLoc} ≠ pallet ${palLoc}` : ""}`}
                              >
                                {s.isn ?? s.sn}{off ? " ⚠" : ""}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()
              )}
            </div>
            <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
              <button type="button" onClick={() => setSnModal(null)} className="w-full rounded-lg bg-zinc-100 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                ປິດ
              </button>
            </div>
          </div>
        </div>
      )}

      {manualItem && (
        <ManualMoveModal
          whCode={whCode}
          item={manualItem}
          onClose={() => setManualItem(null)}
          onDone={(kind, text) => {
            showToast(kind, text);
            if (kind === "ok") void load();
          }}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
            {toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

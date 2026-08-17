"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, PackageIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import { type CalcFlag, UNLOCATED_LABEL, fmtQty } from "@/lib/stockCard";
import type { WarehouseOption } from "./StockCardView";

type Option = { code: string; name: string | null };
type Hit = {
  item_code: string; item_name: string | null; unit_code: string | null;
  group_main: string | null; item_brand: string | null; item_category: string | null; on_card: boolean;
};
type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string | null };
/** One row of the working list — not persisted until the whole batch is saved. */
type Line = {
  key: string; item_code: string; item_name: string | null; unit_code: string | null;
  calc_flag: CalcFlag; qty: string; rack_code: string; location_code: string;
};

const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

export default function StockCardEntry({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [groups, setGroups] = useState<Option[]>([]);
  const [brands, setBrands] = useState<Option[]>([]);
  const [categories, setCategories] = useState<Option[]>([]);
  const [group, setGroup] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  // Applied to every newly added row, so a 40-line batch going to one bin is
  // three clicks instead of eighty. Per-row values stay editable afterwards.
  const [defFlag, setDefFlag] = useState<CalcFlag>(1);
  const [defRack, setDefRack] = useState("");
  const [defLocation, setDefLocation] = useState("");

  const [lines, setLines] = useState<Line[]>([]);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const [saved, setSaved] = useState<{ doc_no: string; lines: number } | null>(null);

  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 3200); }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/stock-card/filters");
        const d = (await res.json()) as { groups?: Option[]; brands?: Option[]; categories?: Option[] };
        setGroups(d.groups ?? []); setBrands(d.brands ?? []); setCategories(d.categories ?? []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Bins belong to a warehouse — switching warehouse invalidates every bin the
  // form is holding, including ones already attached to working rows.
  useEffect(() => {
    setRacks([]); setLocations([]); setDefRack(""); setDefLocation("");
    setLines((p) => p.map((l) => ({ ...l, rack_code: "", location_code: "" })));
    if (!wh) return;
    void (async () => {
      try {
        const res = await fetch(`/api/stock-card/locations?wh=${encodeURIComponent(wh)}`);
        const d = (await res.json()) as { racks?: RackOption[]; locations?: LocationOption[] };
        setRacks(d.racks ?? []); setLocations(d.locations ?? []);
      } catch { /* non-fatal — bins are optional on an entry */ }
    })();
  }, [wh]);

  const search = useCallback(async () => {
    if (!group && !brand && !category && !q.trim()) {
      showToast("err", "ກະລຸນາເລືອກການກອງ ຫຼື ພິມຄຳຄົ້ນຫາ ຢ່າງໜ້ອຍ 1 ຢ່າງ");
      return;
    }
    setSearching(true);
    try {
      const p = new URLSearchParams();
      if (wh) p.set("wh", wh);
      if (group) p.set("group", group);
      if (brand) p.set("brand", brand);
      if (category) p.set("category", category);
      if (q.trim()) p.set("q", q.trim());
      const res = await fetch(`/api/stock-card/items?${p}`);
      const d = (await res.json()) as { items?: Hit[] };
      setHits(d.items ?? []); setPicked(new Set()); setSearched(true);
    } finally { setSearching(false); }
  }, [wh, group, brand, category, q]);

  function addPicked() {
    const add = hits.filter((h) => picked.has(h.item_code));
    if (add.length === 0) return;
    setLines((p) => {
      const existing = new Set(p.map((l) => l.item_code));
      const fresh = add
        .filter((h) => !existing.has(h.item_code))
        .map((h, i) => ({
          key: `${h.item_code}-${Date.now()}-${i}`,
          item_code: h.item_code, item_name: h.item_name, unit_code: h.unit_code,
          calc_flag: defFlag, qty: "", rack_code: defRack, location_code: defLocation,
        }));
      return [...p, ...fresh];
    });
    setPicked(new Set());
    setSaved(null);
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((p) => p.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!wh) { showToast("err", "ກະລຸນາເລືອກສາງ"); return; }
    if (lines.length === 0) { showToast("err", "ບໍ່ມີລາຍການໃຫ້ບັນທຶກ"); return; }
    const bad = lines.find((l) => !(Number.parseFloat(l.qty) > 0));
    if (bad) { showToast("err", `ຈຳນວນຂອງ ${bad.item_code} ຕ້ອງຫຼາຍກວ່າ 0`); return; }
    const orphan = lines.find((l) => l.location_code && !l.rack_code);
    if (orphan) { showToast("err", `${orphan.item_code}: ລະບຸ location ແລ້ວຕ້ອງລະບຸ rack ນຳ`); return; }

    setBusy(true);
    try {
      const res = await fetch("/api/stock-card/entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh, remark: remark.trim() || undefined,
          lines: lines.map((l) => ({
            item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code,
            calc_flag: l.calc_flag, qty: Number.parseFloat(l.qty),
            rack_code: l.rack_code || undefined, location_code: l.location_code || undefined,
          })),
        }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string; doc_no?: string; lines?: number };
      if (!res.ok || !d.ok) throw new Error(d.error ?? "ບໍ່ສຳເລັດ");
      setSaved({ doc_no: d.doc_no ?? "", lines: d.lines ?? 0 });
      showToast("ok", `ບັນທຶກສຳເລັດ ${d.doc_no}`);
      setLines([]); setRemark("");
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  const locForRack = (rack: string) => locations.filter((l) => !rack || l.rack_code === rack);
  const netIn = lines.filter((l) => l.calc_flag === 1).reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0);
  const netOut = lines.filter((l) => l.calc_flag === -1).reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0);

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${toast.k === "ok" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-rose-50 text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/30 dark:text-rose-300"}`}>
          {toast.t}
        </div>
      )}
      {saved && (
        <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-4 py-2.5 text-sm text-indigo-800 ring-1 ring-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300">
          <CheckIcon className="h-4 w-4" />
          ບັນທຶກເປັນໃບ <span className="font-mono font-bold">{saved.doc_no}</span> ({saved.lines} ລາຍການ)
        </div>
      )}

      {/* ① ເລືອກສາງ + ກອງສິນຄ້າ */}
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">① ເລືອກສາງ ແລະ ກອງສິນຄ້າ</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${inputCls} w-full`}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ໝວດຫຼັກ</label>
            <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທັງໝົດ —</option>
              {groups.map((g) => <option key={g.code} value={g.code}>{g.code}{g.name ? ` · ${g.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ຍີ່ຫໍ້</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທັງໝົດ —</option>
              {brands.map((b) => <option key={b.code} value={b.code}>{b.code}{b.name && b.name !== b.code ? ` · ${b.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດ</label>
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
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
                placeholder="ພິມແລ້ວ Enter …" className={`${inputCls} w-full pl-9`} />
            </div>
          </div>
          <button type="button" onClick={() => void search()} disabled={searching}
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-blue-600 px-5 py-2 text-sm font-bold text-white shadow-sm disabled:opacity-50">
            {searching ? "ກຳລັງຄົ້ນຫາ..." : "ຄົ້ນຫາ"}
          </button>
        </div>

        {searched && (
          hits.length === 0 ? (
            <div className="py-6 text-center text-sm text-zinc-400">ບໍ່ພົບສິນຄ້າທີ່ຕົງກັບການກອງ</div>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-zinc-500">
                  ພົບ {hits.length} ລາຍການ · ເລືອກແລ້ວ <span className="font-bold text-indigo-600 dark:text-indigo-400">{picked.size}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setPicked(new Set(hits.map((h) => h.item_code)))}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ເລືອກທັງໝົດ</button>
                  <button type="button" onClick={() => setPicked(new Set())}
                    className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ລ້າງ</button>
                  <button type="button" onClick={addPicked} disabled={picked.size === 0}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                    <PlusIcon className="h-3.5 w-3.5" /> ເພີ່ມເຂົ້າລາຍການ
                  </button>
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {hits.map((h) => (
                      <tr key={h.item_code} onClick={() => setPicked((p) => { const n = new Set(p); if (n.has(h.item_code)) n.delete(h.item_code); else n.add(h.item_code); return n; })}
                        className={`cursor-pointer transition ${picked.has(h.item_code) ? "bg-indigo-50 dark:bg-indigo-950/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}`}>
                        <td className="w-10 px-3 py-2"><input type="checkbox" readOnly checked={picked.has(h.item_code)} className="h-4 w-4 rounded" /></td>
                        <td className="px-3 py-2">
                          <span className="block font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{h.item_code}</span>
                          <span className="block max-w-lg truncate text-[13px] text-zinc-700 dark:text-zinc-300">{h.item_name ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-[10px] text-zinc-400">{[h.group_main, h.item_brand, h.item_category].filter(Boolean).join(" · ")}</td>
                        <td className="px-3 py-2 text-right">
                          {h.on_card && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">ມີໃນບັດແລ້ວ</span>}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-zinc-400">{h.unit_code ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        )}
      </section>

      {/* ② ຄ່າເລີ່ມຕົ້ນສຳລັບລາຍການທີ່ເພີ່ມໃໝ່ */}
      <section className="shadow-card space-y-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">② ຄ່າເລີ່ມຕົ້ນ (ໃຊ້ກັບລາຍການທີ່ເພີ່ມໃໝ່)</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ປະເພດການເພີ່ມຂໍ້ມູນ</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDefFlag(1)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${defFlag === 1 ? "bg-emerald-600 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"}`}>+ ຂາເຂົ້າ</button>
              <button type="button" onClick={() => setDefFlag(-1)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${defFlag === -1 ? "bg-rose-600 text-white" : "bg-white text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"}`}>− ຂາອອກ</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Rack</label>
            <select value={defRack} onChange={(e) => { setDefRack(e.target.value); setDefLocation(""); }} className={`${inputCls} w-full`} disabled={!wh}>
              <option value="">— {UNLOCATED_LABEL} —</option>
              {racks.map((r) => <option key={r.code} value={r.code}>{r.code}{r.name ? ` · ${r.name}` : ""}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">Location</label>
            <select value={defLocation} onChange={(e) => setDefLocation(e.target.value)} className={`${inputCls} w-full`} disabled={!defRack}>
              <option value="">— ບໍ່ລະບຸ —</option>
              {locForRack(defRack).map((l) => <option key={l.code} value={l.code}>{l.code}{l.name ? ` · ${l.name}` : ""}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ③ ລາຍການທີ່ຈະບັນທຶກ */}
      <section className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
          <div className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">③ ລາຍການທີ່ຈະບັນທຶກ ({lines.length})</div>
          {lines.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">+{fmtQty(netIn)}</span>
              <span className="font-mono font-bold text-rose-600 dark:text-rose-400">−{fmtQty(netOut)}</span>
            </div>
          )}
        </div>
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <PackageIcon className="h-6 w-6 text-zinc-300" />
            <div className="text-sm text-zinc-400">ຍັງບໍ່ມີລາຍການ — ກອງແລ້ວເລືອກສິນຄ້າຂ້າງເທິງ</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2">ປະເພດ</th>
                  <th className="px-4 py-2">ສິນຄ້າ</th>
                  <th className="px-4 py-2">Rack</th>
                  <th className="px-4 py-2">Location</th>
                  <th className="px-4 py-2 text-right">ຈຳນວນ</th>
                  <th className="px-4 py-2">ໜ່ວຍ</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => updateLine(l.key, { calc_flag: 1 })}
                          className={`rounded px-2 py-1 text-xs font-bold transition ${l.calc_flag === 1 ? "bg-emerald-600 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>+</button>
                        <button type="button" onClick={() => updateLine(l.key, { calc_flag: -1 })}
                          className={`rounded px-2 py-1 text-xs font-bold transition ${l.calc_flag === -1 ? "bg-rose-600 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>−</button>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <span className="block font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{l.item_code}</span>
                      <span className="block max-w-xs truncate text-[13px] text-zinc-700 dark:text-zinc-300">{l.item_name ?? "—"}</span>
                    </td>
                    <td className="px-4 py-2">
                      <select value={l.rack_code} onChange={(e) => updateLine(l.key, { rack_code: e.target.value, location_code: "" })}
                        className={`${inputCls} w-36 !px-2 !py-1 text-xs`}>
                        <option value="">— ບໍ່ລະບຸ —</option>
                        {racks.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select value={l.location_code} onChange={(e) => updateLine(l.key, { location_code: e.target.value })}
                        disabled={!l.rack_code} className={`${inputCls} w-40 !px-2 !py-1 text-xs disabled:opacity-40`}>
                        <option value="">— ບໍ່ລະບຸ —</option>
                        {locForRack(l.rack_code).map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input type="number" min="0" step="any" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                        className={`${inputCls} w-28 text-right font-mono !px-2 !py-1`} placeholder="0" />
                    </td>
                    <td className="px-4 py-2 text-[11px] text-zinc-400">{l.unit_code ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <button type="button" onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                        className="rounded p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30">🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="shadow-card flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="min-w-[260px] flex-1">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ໝາຍເຫດ (ທັງໃບ)</label>
            <input value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200}
              placeholder="ເຫດຜົນ / ອ້າງອີງ …" className={`${inputCls} w-full`} />
          </div>
          <button type="button" onClick={() => void submit()} disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-7 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
            <CheckIcon className="h-4 w-4" />
            {busy ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກ ${lines.length} ລາຍການ`}
          </button>
        </section>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, LayersIcon, PackageIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import AdjustSerialModal, { type SerialPlan } from "../adjust/AdjustSerialModal";

export type WarehouseOption = { code: string; name: string | null };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };
type Hit = { item_code: string; item_name: string | null; unit_code: string | null; balance_qty: string | null; is_isn: number | null };

type Line = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  before: number;
  addQty: string; // non-serial
  serialized: boolean;
  serialsAdd: string[];
  serialsGenerate: number;
};

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}
function addedOf(l: Line): number {
  return l.serialized ? l.serialsAdd.length + l.serialsGenerate : Math.max(0, Number.parseFloat(l.addQty) || 0);
}

export default function PalletLoadClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [palletCode, setPalletCode] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [serialItem, setSerialItem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  const pallet = useMemo(() => pallets.find((p) => p.code === palletCode) ?? null, [pallets, palletCode]);
  const rack = pallet?.rack ?? "";
  const loc = pallet?.location ?? "";

  useEffect(() => {
    setPallets([]); setPalletCode(""); setLines([]);
    if (!whCode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(whCode)}`);
        const data = (await res.json()) as { pallets?: PalletOption[] };
        if (!cancelled) setPallets(data.pallets ?? []);
      } catch {
        if (!cancelled) showToast("err", "ໂຫຼດ pallet ບໍ່ສຳເລັດ");
      }
    })();
    return () => { cancelled = true; };
  }, [whCode]);

  // item search at the pallet node
  useEffect(() => {
    if (!search.trim() || !whCode) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ warehouse: whCode, rack, location: loc, pallet: palletCode, q: search.trim() });
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: Hit[] };
        setHits(data.items ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, whCode, rack, loc, palletCode]);

  // Scanner types the code then sends Enter: add the exact match (or the sole
  // hit). If the debounce hasn't fetched yet, look it up directly.
  async function handleScanEnter() {
    const term = search.trim();
    if (!term) return;
    const pick = (items: Hit[]) =>
      items.find((h) => h.item_code.toLowerCase() === term.toLowerCase()) ?? (items.length === 1 ? items[0] : null);
    let h = pick(hits);
    if (!h) {
      try {
        const params = new URLSearchParams({ warehouse: whCode, rack, location: loc, pallet: palletCode, q: term });
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: Hit[] };
        h = pick(data.items ?? []);
      } catch { /* ignore */ }
    }
    if (h) addHit(h);
    else showToast("err", "ບໍ່ພົບ — ກະລຸນາເລືອກຈາກລາຍການ");
  }

  function addHit(h: Hit) {
    setHits([]); setSearch("");
    if (lines.some((l) => l.item_code === h.item_code)) { showToast("err", "ມີໃນລາຍການແລ້ວ"); return; }
    setLines((p) => [
      { item_code: h.item_code, item_name: h.item_name, unit_code: h.unit_code, before: Number.parseFloat(h.balance_qty ?? "0") || 0, addQty: "", serialized: (h.is_isn ?? 0) === 1, serialsAdd: [], serialsGenerate: 0 },
      ...p,
    ]);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  const ready = useMemo(() => lines.filter((l) => addedOf(l) > 0), [lines]);

  async function submit() {
    if (!palletCode) { showToast("err", "ກະລຸນາເລືອກ pallet"); return; }
    if (ready.length === 0) { showToast("err", "ກະລຸນາເພີ່ມສິນຄ້າ"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          shelf_code: rack,
          shelf_code1: loc,
          pallet: palletCode,
          reason: "found",
          note: `ປະກອບ pallet ${palletCode}`,
          lines: ready.map((l) =>
            l.serialized
              ? { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, serials_add: l.serialsAdd, serials_generate: l.serialsGenerate }
              : { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, counted_qty: l.before + addedOf(l) },
          ),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; adjust_code?: string; changed?: number; sn_generated?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ໂຫລດເຂົ້າ pallet ${palletCode} ແລ້ວ · ${data.changed} ລາຍການ${data.sn_generated ? ` · gen ${data.sn_generated} ISN` : ""} (${data.adjust_code})`);
      setLines([]);
    } catch (e) {
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>ສາງ *</label>
            <select value={whCode} onChange={(e) => setWhCode(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (<option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Pallet *</label>
            <select value={palletCode} onChange={(e) => { setPalletCode(e.target.value); setLines([]); }} disabled={!whCode} className={`${inputCls} w-full`}>
              <option value="">— ເລືອກ pallet —</option>
              {pallets.map((p) => (<option key={p.code} value={p.code}>{p.code}{p.location ? ` @ ${p.location}` : " (ສาง)"}</option>))}
            </select>
          </div>
        </div>
        {pallet && (
          <p className="mt-2 text-[11px] text-zinc-500">📦 {pallet.code} · ບ່ອນ: <span className="font-mono text-emerald-600 dark:text-emerald-400">{[rack, loc].filter(Boolean).join(" / ") || "(ສาง)"}</span></p>
        )}
      </section>

      {palletCode && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input ref={searchRef} type="text" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleScanEnter(); } }} placeholder="ສະແກນ / ພິມ ລະຫັດ ຫຼື ຊື່ ສິນຄ້າ ແລ້ວ Enter..." className={`${inputCls} w-full pl-9`} />
            {(hits.length > 0 || searching) && (
              <div className="absolute inset-x-0 top-[calc(100%+0.3rem)] z-30 max-h-72 overflow-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                {searching && <div className="p-3 text-center text-xs text-zinc-400">ກຳລັງຄົ້ນຫາ...</div>}
                {hits.map((h) => (
                  <button key={h.item_code} type="button" onClick={() => addHit(h)} className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/70">
                    <PlusIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{h.item_code}</span>{(h.is_isn ?? 0) === 1 && <span className="rounded bg-aqua-100 px-1 py-0.5 text-[9px] font-bold text-aqua-700 dark:bg-aqua-950/50 dark:text-aqua-300">SN</span>}</div>
                      <div className="truncate text-xs">{h.item_name}</div>
                    </div>
                    <div className="shrink-0 text-right text-[10px] text-zinc-400">ນີ້ {fmt(h.balance_qty)} · {h.unit_code}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center dark:border-zinc-800">
              <PackageIcon className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-xs font-semibold text-zinc-500">ສະແກນ/ເພີ່ມ ສິນຄ້າ ເຂົ້າ pallet</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2.5">ສິນຄ້າ</th><th className="px-4 py-2.5 text-right">ມີຢູ່</th><th className="px-4 py-2.5 text-center">ເພີ່ມ</th><th className="w-8" /></tr></thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {lines.map((l) => (
                    <tr key={l.item_code}>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5"><span className="font-mono text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{l.item_code}</span>{l.serialized && <span className="rounded bg-aqua-100 px-1 py-0.5 text-[9px] font-bold text-aqua-700 dark:bg-aqua-950/50 dark:text-aqua-300">SN</span>}</div>
                        <div className="max-w-md truncate text-sm text-zinc-800 dark:text-zinc-200" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-500">{fmt(l.before)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span></td>
                      <td className="px-4 py-2.5">
                        {l.serialized ? (
                          <div className="flex justify-center">
                            <button type="button" onClick={() => setSerialItem(l.item_code)} className="inline-flex items-center gap-1.5 rounded-lg bg-aqua-50 px-3 py-1.5 text-xs font-semibold text-aqua-700 ring-1 ring-aqua-200 hover:bg-aqua-100 dark:bg-aqua-950/40 dark:text-aqua-300 dark:ring-aqua-900/50"><LayersIcon className="h-3.5 w-3.5" />{addedOf(l) > 0 ? `+${addedOf(l)} SN` : "ຈັດການ SN"}</button>
                          </div>
                        ) : (
                          <div className="flex justify-center">
                            <input type="number" inputMode="decimal" value={l.addQty} placeholder="0" onChange={(e) => setLines((p) => p.map((x) => x.item_code === l.item_code ? { ...x, addQty: e.target.value } : x))} className="w-24 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:ring-zinc-800" />
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-right"><button type="button" onClick={() => setLines((p) => p.filter((x) => x.item_code !== l.item_code))} className="rounded p-1 text-zinc-300 hover:text-rose-500">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-3">
            {ready.length > 0 && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{ready.length} ລາຍການ</span>}
            <button type="button" onClick={submit} disabled={submitting || ready.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"><CheckIcon className="h-4 w-4" />{submitting ? "ກຳລັງບັນທຶກ..." : "ໂຫລດເຂົ້າ pallet"}</button>
          </div>
        </section>
      )}

      {serialItem && (() => {
        const it = lines.find((x) => x.item_code === serialItem);
        if (!it) return null;
        return (
          <AdjustSerialModal
            whCode={whCode}
            rack={rack}
            location={loc}
            pallet={palletCode}
            item={{ item_code: it.item_code, item_name: it.item_name, before: it.before }}
            initial={{ serialsRemove: [], serialsAdd: it.serialsAdd, serialsGenerate: it.serialsGenerate }}
            onClose={() => setSerialItem(null)}
            onDone={(plan: SerialPlan) => {
              setLines((p) => p.map((x) => x.item_code === serialItem ? { ...x, serialsAdd: plan.serialsAdd, serialsGenerate: plan.serialsGenerate } : x));
              setSerialItem(null);
            }}
          />
        );
      })()}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.text}</div>
        </div>
      )}
    </div>
  );
}

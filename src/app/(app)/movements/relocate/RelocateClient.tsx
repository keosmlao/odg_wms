"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, LayersIcon, MapPinIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { locLabel, nameBookOf, nodePath, type NameBook } from "@/lib/locationLabel";
import AdjustMoveSnModal from "../adjust/AdjustMoveSnModal";

export type WarehouseOption = { code: string; name: string | null; sn_move: boolean };

type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };

/** A storage node in the warehouse that currently holds stock of an item. */
type StockNode = { rack: string; location: string; pallet: string; qty: string };

type ItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  wh_balance: string | null;
  is_isn: number | null;
  locations?: StockNode[];
};

type Node = { rack: string; location: string; pallet: string };

function sameNode(a: Node, b: Node): boolean {
  return a.rack === b.rack && a.location === b.location && a.pallet === b.pallet;
}
function emptyNode(): Node {
  return { rack: "", location: "", pallet: "" };
}
function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function knownNodeQty(nodes: StockNode[], node: Node) {
  const hit = nodes.find((n) => sameNode(n, node));
  return hit ? Number.parseFloat(hit.qty) || 0 : null;
}

const fieldLabel = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400";
const smallSelect =
  "w-full rounded-lg bg-white px-2 py-1.5 text-xs text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

/**
 * ຍ້າຍບ່ອນເກັບ — ຍ້າຍສິນຄ້າ 1 ລາຍການ ຈາກ ຈຸດທີ 1 → ຈຸດທີ 2 ພາຍໃນສາງດຽວກັນ.
 * ສິນຄ້າ serial (is_isn=1) ຕ້ອງເລືອກ SN ໃຫ້ຄົບຈຳນວນ — SN ຈະຍ້າຍໄປນຳ.
 * ບໍ່ກ່ຽວກັບ "ປັບປຸງ stock" (Adjust) — ໜ້ານີ້ບໍ່ນັບ/ບໍ່ແກ້ຍອດ, ພຽງແຕ່ຍ້າຍທີ່ຢູ່.
 */
export default function RelocateClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ItemHit[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const [item, setItem] = useState<ItemHit | null>(null);
  const [from, setFrom] = useState<Node>(emptyNode());
  const [to, setTo] = useState<Node>(emptyNode());
  const [qty, setQty] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [showSnModal, setShowSnModal] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  // ໂຫຼດ rack + location + pallet ຂອງສາງທີ່ເລືອກ.
  useEffect(() => {
    setRacks([]);
    setLocations([]);
    setPallets([]);
    resetItem();
    if (!whCode) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stocktake/locations?wh=${encodeURIComponent(whCode)}`);
        const data = (await res.json()) as { racks?: RackOption[]; locations?: LocationOption[]; pallets?: PalletOption[] };
        if (cancelled) return;
        setRacks(data.racks ?? []);
        setLocations(data.locations ?? []);
        setPallets(data.pallets ?? []);
      } catch {
        if (!cancelled) showToast("err", "ບໍ່ສາມາດໂຫຼດພື້ນທີ່ຈັດເກັບ");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whCode]);

  // ຄົ້ນຫາສິນຄ້າ (debounce ນ້ອຍໆ).
  useEffect(() => {
    if (!whCode || search.trim().length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ warehouse: whCode, q: search.trim(), locations: "1", limit: "15" });
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: ItemHit[] };
        if (!cancelled) setHits(data.items ?? []);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [whCode, search]);

  function resetItem() {
    setItem(null);
    setSearch("");
    setHits([]);
    setFrom(emptyNode());
    setTo(emptyNode());
    setQty("");
    setSerials([]);
  }

  function pickItem(hit: ItemHit) {
    setItem(hit);
    setHits([]);
    setSearch("");
    const nodes = hit.locations ?? [];
    setFrom(nodes[0] ? { rack: nodes[0].rack, location: nodes[0].location, pallet: nodes[0].pallet } : emptyNode());
    setTo(emptyNode());
    setQty("");
    setSerials([]);
  }

  const locationsForRack = (rack: string) => (rack ? locations.filter((l) => l.rack_code === rack) : locations);
  const nameBook = useMemo<NameBook>(() => nameBookOf(racks, locations), [racks, locations]);
  const nodes = item?.locations ?? [];
  const fromKnownQty = item ? knownNodeQty(nodes, from) : null;
  const serialized = (item?.is_isn ?? 0) === 1;
  const snOn = warehouses.find((w) => w.code === whCode)?.sn_move ?? true;
  const needsSn = serialized && snOn;

  const qtyNum = Number.parseFloat(qty);
  const qtyValid = Number.isFinite(qtyNum) && qtyNum > 0;
  const hasNodes = !!(from.rack || from.location || from.pallet) && !!(to.rack || to.location || to.pallet);
  const sameAsFrom = hasNodes && sameNode(from, to);
  const snReady = !needsSn || (qtyValid && serials.length === Math.round(qtyNum));

  const blockingIssue = !item
    ? "ຄົ້ນຫາ ແລະ ເລືອກສິນຄ້າກ່ອນ"
    : !qtyValid
      ? "ໃສ່ຈຳນວນທີ່ຈະຍ້າຍ"
      : !(from.rack || from.location || from.pallet)
        ? "ເລືອກ ຈຸດທີ 1"
        : !(to.rack || to.location || to.pallet)
          ? "ເລືອກ ຈຸດທີ 2"
          : sameAsFrom
            ? "ຈຸດທີ 2 ຄືກັນກັບ ຈຸດທີ 1 — ບໍ່ມີຫຍັງໃຫ້ຍ້າຍ"
            : needsSn && serials.length !== Math.round(qtyNum)
              ? `ເລືອກ SN ໃຫ້ຄົບ ${formatQty(qtyNum)} ໜ່ວຍ (ຕອນນີ້ ${serials.length})`
              : null;

  async function submit() {
    if (blockingIssue || !item) {
      showToast("err", blockingIssue ?? "ຂໍ້ມູນບໍ່ຄົບ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/movements/relocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          item_code: item.item_code,
          item_name: item.item_name,
          unit_code: item.unit_code,
          from_rack: from.rack,
          from_location: from.location,
          from_pallet: from.pallet,
          to_rack: to.rack,
          to_location: to.location,
          to_pallet: to.pallet,
          qty: qtyNum,
          serials: needsSn ? serials : [],
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; doc_no?: string; serials?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ຍ້າຍແລ້ວ ${data.doc_no}${data.serials ? ` · ${data.serials} SN` : ""}`);
      resetItem();
      setTimeout(() => searchRef.current?.focus(), 50);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 rounded-lg px-4 py-2.5 text-sm font-semibold shadow-lg ${
            toast.kind === "ok" ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
          }`}
        >
          {toast.text}
        </div>
      )}

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <span className={fieldLabel}>ສາງ</span>
            <select value={whCode} onChange={(e) => setWhCode(e.target.value)} className={smallSelect}>
              <option value="">— ເລືອກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {locLabel(w.code, w.name)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!whCode ? (
          <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center dark:border-zinc-800">
            <PackageIcon className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-xs font-semibold text-zinc-500">ເລືອກສາງກ່ອນ</p>
          </div>
        ) : !item ? (
          <div>
            <span className={fieldLabel}>ຄົ້ນຫາສິນຄ້າ</span>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ລະຫັດ / ຊື່ສິນຄ້າ..."
                className="w-full rounded-lg bg-white py-2 pr-3 pl-9 text-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
              />
            </div>
            {searching && <p className="mt-2 text-xs text-zinc-400">ກຳລັງຄົ້ນຫາ...</p>}
            {hits.length > 0 && (
              <div className="mt-2 max-h-72 space-y-1 overflow-auto rounded-xl border border-zinc-100 p-1.5 dark:border-zinc-800">
                {hits.map((h) => (
                  <button
                    key={h.item_code}
                    type="button"
                    onClick={() => pickItem(h)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{h.item_code}</div>
                      <div className="truncate text-xs text-zinc-700 dark:text-zinc-300">{h.item_name ?? "—"}</div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-xs text-zinc-500">
                      {formatQty(h.wh_balance)}
                      {(h.is_isn ?? 0) === 1 && (
                        <span className="ml-1 rounded bg-aqua-50 px-1 text-[9px] font-semibold text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">
                          SN
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3 rounded-xl bg-zinc-50/60 p-3 ring-1 ring-zinc-200 dark:bg-zinc-800/30 dark:ring-zinc-800">
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{item.item_code}</div>
                <div className="truncate text-sm text-zinc-800 dark:text-zinc-200">{item.item_name ?? "—"}</div>
                {serialized && (
                  <span className="mt-1 inline-block rounded bg-aqua-50 px-1.5 py-0.5 text-[9px] font-semibold text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">
                    ສິນຄ້າ Serial{!snOn && " · ສາງນີ້ປິດການຍ້າຍ SN"}
                  </span>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">ຍອດທັງສາງ</div>
                <div className="font-mono text-sm font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                  {formatQty(item.wh_balance)} <span className="text-[10px] uppercase text-zinc-400">{item.unit_code}</span>
                </div>
              </div>
              <button type="button" onClick={resetItem} className="shrink-0 text-xs font-semibold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                ປ່ຽນສິນຄ້າ
              </button>
            </div>

            {nodes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                  <MapPinIcon className="h-3 w-3" />
                  ຢູ່ປະຈຸບັນ
                </span>
                {nodes.map((n) => {
                  const active = sameNode(from, n);
                  return (
                    <button
                      key={nodePath(n)}
                      type="button"
                      onClick={() => {
                        setFrom({ rack: n.rack, location: n.location, pallet: n.pallet });
                        setSerials([]);
                      }}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] transition ${
                        active
                          ? "bg-brand-600 text-white shadow-sm"
                          : "bg-brand-50 text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900/50"
                      }`}
                    >
                      {nodePath(n)}
                      <span className={`tabular-nums ${active ? "text-white/80" : "text-brand-500/80 dark:text-brand-400/80"}`}>{formatQty(n.qty)}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl bg-rose-50/40 p-3 ring-1 ring-rose-100 dark:bg-rose-950/10 dark:ring-rose-900/40">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">ຈຸດທີ 1 (ອອກ)</span>
                  <span className="font-mono text-xs tabular-nums text-zinc-500">{fromKnownQty !== null ? formatQty(fromKnownQty) : "—"}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className={fieldLabel}>Rack</span>
                    <select
                      value={from.rack}
                      onChange={(e) => {
                        setFrom({ ...from, rack: e.target.value, location: "" });
                        setSerials([]);
                      }}
                      className={smallSelect}
                    >
                      <option value="">— ທຸກ rack —</option>
                      {from.rack && !racks.some((r) => r.code === from.rack) && <option value={from.rack}>{from.rack}</option>}
                      {racks.map((r) => (
                        <option key={r.code} value={r.code}>
                          {locLabel(r.code, r.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className={fieldLabel}>Location</span>
                    <select
                      value={from.location}
                      onChange={(e) => {
                        setFrom({ ...from, location: e.target.value });
                        setSerials([]);
                      }}
                      disabled={!from.rack && !from.location}
                      className={smallSelect}
                    >
                      <option value="">{from.rack ? "— ທຸກ location —" : "ເລືອກ rack"}</option>
                      {from.location && !locationsForRack(from.rack).some((l) => l.code === from.location) && (
                        <option value={from.location}>{from.location}</option>
                      )}
                      {locationsForRack(from.rack).map((l) => (
                        <option key={l.code} value={l.code}>
                          {locLabel(l.code, l.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className={fieldLabel}>Pallet</span>
                    <select
                      value={from.pallet}
                      onChange={(e) => {
                        const code = e.target.value;
                        const p = pallets.find((x) => x.code === code);
                        setFrom({ pallet: code, rack: p?.rack || from.rack, location: p?.location || from.location });
                        setSerials([]);
                      }}
                      className={smallSelect}
                    >
                      <option value="">— ບໍ່ມີ —</option>
                      {from.pallet && !pallets.some((p) => p.code === from.pallet) && <option value={from.pallet}>{from.pallet}</option>}
                      {pallets.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code}
                          {p.location ? ` → ${p.location}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-emerald-50/40 p-3 ring-1 ring-emerald-100 dark:bg-emerald-950/10 dark:ring-emerald-900/40">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">ຈຸດທີ 2 (ເຂົ້າ)</span>
                  <span className="font-mono text-xs tabular-nums text-zinc-500">
                    {hasNodes ? formatQty(knownNodeQty(nodes, to) ?? 0) : "—"}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <span className={fieldLabel}>Rack</span>
                    <select value={to.rack} onChange={(e) => setTo({ ...to, rack: e.target.value, location: "" })} className={smallSelect}>
                      <option value="">— ເລືອກ rack —</option>
                      {to.rack && !racks.some((r) => r.code === to.rack) && <option value={to.rack}>{to.rack}</option>}
                      {racks.map((r) => (
                        <option key={r.code} value={r.code}>
                          {locLabel(r.code, r.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className={fieldLabel}>Location</span>
                    <select
                      value={to.location}
                      onChange={(e) => setTo({ ...to, location: e.target.value })}
                      disabled={!to.rack && !to.location}
                      className={smallSelect}
                    >
                      <option value="">{to.rack ? "— ທຸກ location —" : "ເລືອກ rack"}</option>
                      {to.location && !locationsForRack(to.rack).some((l) => l.code === to.location) && (
                        <option value={to.location}>{to.location}</option>
                      )}
                      {locationsForRack(to.rack).map((l) => (
                        <option key={l.code} value={l.code}>
                          {locLabel(l.code, l.name)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span className={fieldLabel}>Pallet</span>
                    <select
                      value={to.pallet}
                      onChange={(e) => {
                        const code = e.target.value;
                        const p = pallets.find((x) => x.code === code);
                        setTo({ pallet: code, rack: p?.rack || to.rack, location: p?.location || to.location });
                      }}
                      className={smallSelect}
                    >
                      <option value="">— ບໍ່ມີ —</option>
                      {to.pallet && !pallets.some((p) => p.code === to.pallet) && <option value={to.pallet}>{to.pallet}</option>}
                      {pallets.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.code}
                          {p.location ? ` → ${p.location}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {hasNodes && (
                  <p className="mt-2 text-[10px] text-zinc-400">
                    {nodePath(from)} <span className="mx-1">→</span> {nodePath(to)}
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div>
                <span className={fieldLabel}>ຈຳນວນທີ່ຈະຍ້າຍ</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={qty}
                  onChange={(e) => {
                    setQty(e.target.value);
                    if (!needsSn) return;
                  }}
                  placeholder="0"
                  className="w-full rounded-lg bg-white px-3 py-2 text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
                />
              </div>
              {needsSn && (
                <button
                  type="button"
                  onClick={() => setShowSnModal(true)}
                  disabled={!from.rack && !from.location && !from.pallet}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-100 disabled:opacity-50 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900/50"
                >
                  <LayersIcon className="h-3.5 w-3.5" />
                  {serials.length > 0 ? `ເລືອກແລ້ວ ${serials.length} SN` : "ເລືອກ SN ທີ່ຈະຍ້າຍ"}
                </button>
              )}
            </div>

            {blockingIssue && (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                <AlertIcon className="h-3.5 w-3.5" />
                {blockingIssue}
              </p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={resetItem} className={ghostBtn}>
                ຍົກເລີກ
              </button>
              <button type="button" onClick={submit} disabled={!!blockingIssue || submitting} className={primaryBtn}>
                <CheckIcon className="h-4 w-4" />
                {submitting ? "ກຳລັງຍ້າຍ..." : "ຍ້າຍ"}
              </button>
            </div>
          </div>
        )}
      </section>

      {showSnModal && item && (
        <AdjustMoveSnModal
          whCode={whCode}
          from={from}
          to={to}
          item={{ item_code: item.item_code, item_name: item.item_name }}
          initial={serials}
          onClose={() => setShowSnModal(false)}
          onDone={(picked) => {
            setSerials(picked);
            setShowSnModal(false);
          }}
        />
      )}
    </div>
  );
}

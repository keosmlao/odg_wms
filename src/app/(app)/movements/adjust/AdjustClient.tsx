"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertIcon,
  BuildingIcon,
  CheckIcon,
  LayersIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import AdjustSerialModal, { type SerialPlan } from "./AdjustSerialModal";

export type WarehouseOption = { code: string; name: string | null; sn_adjust: boolean };

type RackOption = { code: string; name: string | null };
type LocationOption = { code: string; name: string | null; rack_code: string };
type PalletOption = { code: string; name: string | null; location: string | null; rack: string | null };

type ItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  balance_qty: string | null; // balance at the selected node
  wh_balance: string | null; // total balance in the warehouse
  is_isn: number | null;
};

type WorkingItem = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  before_qty: number; // balance at the node (basis for delta)
  wh_balance: number | null; // total in warehouse (info only)
  counted: string; // raw input (qty mode)
  serialized: boolean; // item is ISN-tracked (is_isn)
  // Serial items adjust by serial: ISN to remove, scanned ISN to add, # to generate.
  serialsRemove: string[];
  serialsAdd: string[];
  serialsGenerate: number;
};

const REASONS: { code: string; label: string }[] = [
  { code: "count", label: "ນັບສິນຄ້າ" },
  { code: "damaged", label: "ເສຍຫາຍ" },
  { code: "lost", label: "ສູນຫາຍ" },
  { code: "found", label: "ພົບເພີ່ມ" },
  { code: "other", label: "ອື່ນໆ" },
];

const STEPS = [
  { n: 1, label: "ບ່ອນຈັດເກັບ" },
  { n: 2, label: "ນັບສິນຄ້າ" },
  { n: 3, label: "ຢືນຢັນ" },
] as const;

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

/** Parsed counted value, or null if the field is blank / invalid. */
function parsedCount(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Number of serial changes queued on a serial line. */
function serialActivity(item: WorkingItem): number {
  return item.serialsRemove.length + item.serialsAdd.length + item.serialsGenerate;
}

/**
 * A line is counted by serial only when the item is ISN-tracked AND the
 * warehouse has SN on for the adjust menu. With SN off every line — serial
 * items included — is counted by typing a quantity, matching what the server
 * accepts (it drops serial payloads when the flag is off).
 */
function bySerial(item: WorkingItem, snOn: boolean): boolean {
  return item.serialized && snOn;
}

function deltaOf(item: WorkingItem, snOn: boolean): number | null {
  if (bySerial(item, snOn)) {
    return item.serialsAdd.length + item.serialsGenerate - item.serialsRemove.length;
  }
  const c = parsedCount(item.counted);
  if (c === null) return null;
  return Math.round((c - item.before_qty) * 1e6) / 1e6;
}

export default function AdjustClient({
  warehouses,
}: {
  warehouses: WarehouseOption[];
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [rackCode, setRackCode] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [palletCode, setPalletCode] = useState("");

  const [items, setItems] = useState<WorkingItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const [reason, setReason] = useState("count");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ItemHit[]>([]);

  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [serialItem, setSerialItem] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  // Load racks + locations when warehouse changes.
  useEffect(() => {
    setRacks([]);
    setLocations([]);
    setPallets([]);
    setRackCode("");
    setLocationCode("");
    setPalletCode("");
    setItems([]);
    setLoaded(false);
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
  }, [whCode]);

  const availableLocations = useMemo(
    () => (rackCode ? locations.filter((l) => l.rack_code === rackCode) : locations),
    [locations, rackCode],
  );

  // Reset selected location if it no longer belongs to the chosen rack.
  useEffect(() => {
    if (locationCode && rackCode && !availableLocations.find((l) => l.code === locationCode)) {
      setLocationCode("");
    }
  }, [rackCode, locationCode, availableLocations]);

  // Selecting a different node invalidates the loaded item list.
  useEffect(() => {
    setItems([]);
    setLoaded(false);
  }, [rackCode, locationCode, palletCode]);

  const nodeLabel = useMemo(() => {
    const parts = [whCode || "—"];
    if (rackCode) parts.push(rackCode);
    if (locationCode) parts.push(locationCode);
    if (palletCode) parts.push(`pallet:${palletCode}`);
    return parts.join(" / ");
  }, [whCode, rackCode, locationCode, palletCode]);

  const whName = useMemo(
    () => warehouses.find((w) => w.code === whCode)?.name ?? null,
    [warehouses, whCode],
  );

  /** SN handling for the adjust menu at the selected warehouse (default on). */
  const snOn = useMemo(
    () => warehouses.find((w) => w.code === whCode)?.sn_adjust ?? true,
    [warehouses, whCode],
  );

  function nodeParams() {
    return new URLSearchParams({
      warehouse: whCode,
      rack: rackCode,
      location: locationCode,
      pallet: palletCode,
    });
  }

  async function loadItems() {
    if (!whCode) {
      showToast("err", "ກະລຸນາເລືອກສາງ");
      return;
    }
    setLoading(true);
    try {
      const params = nodeParams();
      params.set("limit", "200");
      const res = await fetch(`/api/movements/balance-items?${params}`);
      const data = (await res.json()) as {
        items?: { ic_code: string; ic_name: string | null; ic_unit_code: string | null; balance_qty: string | null; is_isn: number | null }[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const loadedItems: WorkingItem[] = (data.items ?? []).map((r) => {
        const before = Number.parseFloat(r.balance_qty ?? "0") || 0;
        return {
          item_code: r.ic_code,
          item_name: r.ic_name,
          unit_code: r.ic_unit_code,
          before_qty: before,
          wh_balance: null,
          counted: String(before),
          serialized: (r.is_isn ?? 0) === 1,
          serialsRemove: [],
          serialsAdd: [],
          serialsGenerate: 0,
        };
      });
      setItems(loadedItems);
      setLoaded(true);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load the node's items the first time we land on step 2.
  useEffect(() => {
    if (step === 2 && whCode && !loaded && !loading) {
      void loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Debounced item search (node-aware).
  useEffect(() => {
    if (search.trim().length === 0) {
      setHits([]);
      return;
    }
    if (!whCode) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = nodeParams();
        params.set("q", search.trim());
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: ItemHit[] };
        setHits(data.items ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, whCode, rackCode, locationCode, palletCode]);

  function addHit(hit: ItemHit) {
    setHits([]);
    setSearch("");
    if (items.find((i) => i.item_code === hit.item_code)) {
      showToast("err", "ສິນຄ້ານີ້ມີໃນລາຍການແລ້ວ");
      return;
    }
    const before = Number.parseFloat(hit.balance_qty ?? "0") || 0;
    const whBal = hit.wh_balance === null ? null : Number.parseFloat(hit.wh_balance) || 0;
    setItems((prev) => [
      {
        item_code: hit.item_code,
        item_name: hit.item_name,
        unit_code: hit.unit_code,
        before_qty: before,
        wh_balance: whBal,
        counted: String(before),
        serialized: (hit.is_isn ?? 0) === 1,
        serialsRemove: [],
        serialsAdd: [],
        serialsGenerate: 0,
      },
      ...prev,
    ]);
    setLoaded(true);
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  function setCounted(itemCode: string, value: string) {
    setItems((prev) => prev.map((i) => (i.item_code === itemCode ? { ...i, counted: value } : i)));
  }

  /** Step the counted value by ±1 (clamped at 0); blank field starts from current balance. */
  function stepCount(itemCode: string, delta: number) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.item_code !== itemCode) return i;
        const cur = parsedCount(i.counted);
        const base = cur === null ? i.before_qty : cur;
        const next = Math.max(0, Math.round((base + delta) * 1e6) / 1e6);
        return { ...i, counted: String(next) };
      }),
    );
  }

  function removeItem(itemCode: string) {
    setItems((prev) => prev.filter((i) => i.item_code !== itemCode));
  }

  const changedItems = useMemo(
    () =>
      items.filter((i) => {
        if (bySerial(i, snOn)) return serialActivity(i) > 0;
        const d = deltaOf(i, snOn);
        return d !== null && d !== 0;
      }),
    [items, snOn],
  );

  async function submit() {
    if (changedItems.length === 0) {
      showToast("err", "ບໍ່ມີການປ່ຽນແປງໃຫ້ບັນທຶກ");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          shelf_code: rackCode,
          shelf_code1: locationCode,
          pallet: palletCode,
          reason,
          note,
          lines: changedItems.map((i) =>
            bySerial(i, snOn)
              ? {
                  item_code: i.item_code,
                  item_name: i.item_name,
                  unit_code: i.unit_code,
                  serials_remove: i.serialsRemove,
                  serials_add: i.serialsAdd,
                  serials_generate: i.serialsGenerate,
                }
              : {
                  item_code: i.item_code,
                  item_name: i.item_name,
                  unit_code: i.unit_code,
                  counted_qty: parsedCount(i.counted),
                },
          ),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; adjust_code?: string; changed?: number; sn_generated?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ບັນທຶກແລ້ວ ${data.adjust_code} · ${data.changed} ລາຍການ${data.sn_generated ? ` · gen ${data.sn_generated} ISN` : ""}`);
      setNote("");
      await loadItems(); // refresh balances after posting
      setStep(2); // counts now match balances — back to counting
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  // ----- step navigation -----
  function canGoTo(n: number) {
    if (n === 1) return true;
    if (n === 2) return !!whCode;
    if (n === 3) return items.length > 0;
    return false;
  }
  function goTo(n: 1 | 2 | 3) {
    if (canGoTo(n)) setStep(n);
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
  const primaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <Stepper step={step} canGoTo={canGoTo} onJump={goTo} />

      {/* STEP 1 — location */}
      {step === 1 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <MapPinIcon className="h-4 w-4 text-indigo-500" />
            ເລືອກບ່ອນຈັດເກັບທີ່ຈະປັບປຸງ
          </h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>ສາງ *</label>
              <select value={whCode} onChange={(e) => setWhCode(e.target.value)} className={inputCls}>
                <option value="">— ເລືອກສາງ —</option>
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code}
                    {w.name ? ` · ${w.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Rack (ຊັ້ນວາງ)</label>
              <select value={rackCode} onChange={(e) => setRackCode(e.target.value)} disabled={!whCode} className={inputCls}>
                <option value="">— ທຸກ rack —</option>
                {racks.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.code}
                    {r.name ? ` · ${r.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Location (ພື້ນທີ່)</label>
              <select value={locationCode} onChange={(e) => setLocationCode(e.target.value)} disabled={!whCode || !rackCode} className={inputCls}>
                <option value="">{rackCode ? "— ທຸກ location —" : "ເລືອກ rack ກ່ອນ"}</option>
                {availableLocations.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code}
                    {l.name ? ` · ${l.name}` : ""}
                  </option>
                ))}
              </select>
              {locationCode && pallets.some((p) => p.location === locationCode) && (
                <p className="mt-1 text-[10px] text-zinc-400">📦 pallet ຢູ່ບ່ອນນີ້: {pallets.filter((p) => p.location === locationCode).map((p) => p.code).join(", ")}</p>
              )}
            </div>
            <div>
              <label className={labelCls}>Pallet (ທາງເລືອກ)</label>
              <select
                value={palletCode}
                onChange={(e) => {
                  const code = e.target.value;
                  setPalletCode(code);
                  // pallet → location: a pallet lives at a fixed rack/location.
                  const p = pallets.find((x) => x.code === code);
                  if (p) {
                    if (p.rack) setRackCode(p.rack);
                    if (p.location) setLocationCode(p.location);
                  }
                }}
                disabled={!whCode}
                className={inputCls}
              >
                <option value="">— ບໍ່ມີ pallet —</option>
                {pallets.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.code}
                    {p.location ? ` → ${p.location}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <BuildingIcon className="h-3.5 w-3.5" />
            <span className="font-mono">{nodeLabel}</span>
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" onClick={() => goTo(2)} disabled={!whCode} className={primaryBtn}>
              ຕໍ່ໄປ → ນັບສິນຄ້າ
            </button>
          </div>
        </section>
      )}

      {/* STEP 2 — count */}
      {step === 2 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          {/* node summary */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/40">
            <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <MapPinIcon className="h-3.5 w-3.5 text-indigo-500" />
              <span className="font-mono">{nodeLabel}</span>
              {whName && <span className="text-zinc-400">· {whName}</span>}
              {!snOn && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  SN ປິດ · ປ້ອນຈຳນວນ
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => loadItems()}
              disabled={loading}
              className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
            >
              {loading ? "ກຳລັງໂຫຼດ..." : "↻ ໂຫຼດຄືນ"}
            </button>
          </div>

          {/* Add / scan item search */}
          <div className="relative mb-4">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ສະແກນ / ພິມ ລະຫັດ ຫຼື ຊື່ ເພື່ອເພີ່ມສິນຄ້າ..."
              className={`${inputCls} pl-9`}
            />
            {(hits.length > 0 || searching) && (
              <div className="absolute inset-x-0 top-[calc(100%+0.3rem)] z-30 max-h-72 overflow-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                {searching && <div className="p-3 text-center text-xs text-zinc-400">ກຳລັງຄົ້ນຫາ...</div>}
                {hits.map((h) => (
                  <button
                    key={h.item_code}
                    type="button"
                    onClick={() => addHit(h)}
                    className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
                  >
                    <PlusIcon className="h-4 w-4 shrink-0 text-indigo-500" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{h.item_code}</div>
                      <div className="truncate text-xs">{h.item_name}</div>
                    </div>
                    <div className="shrink-0 text-right text-[10px]">
                      <div className="font-mono font-bold tabular-nums text-zinc-700 dark:text-zinc-200">ສາງ {formatQty(h.wh_balance)}</div>
                      <div className="text-zinc-400">ນີ້ {formatQty(h.balance_qty)} · {h.unit_code}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Item list */}
          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center dark:border-zinc-800">
              <PackageIcon className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-xs font-semibold text-zinc-500">
                {loading ? "ກຳລັງໂຫຼດສິນຄ້າ..." : loaded ? "ບໍ່ມີສິນຄ້າຢູ່ພື້ນທີ່ນີ້" : "ໃຊ້ຊ່ອງຄົ້ນຫາຂ້າງເທິງເພື່ອເພີ່ມສິນຄ້າ"}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <th className="px-4 py-2.5">ສິນຄ້າ</th>
                    <th className="px-4 py-2.5 text-right">ຍອດລະບົບ</th>
                    <th className="px-4 py-2.5 text-center">ນັບໄດ້</th>
                    <th className="px-4 py-2.5 text-right">ປ່ຽນແປງ</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {items.map((i) => {
                    const d = deltaOf(i, snOn);
                    const dColor =
                      d === null || d === 0
                        ? "text-zinc-400"
                        : d > 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400";
                    return (
                      <tr key={i.item_code} className="align-middle transition hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{i.item_code}</div>
                          <div className="max-w-md truncate text-sm text-zinc-800 dark:text-zinc-200" title={i.item_name ?? ""}>
                            {i.item_name ?? "—"}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                          {formatQty(i.before_qty)}
                          <span className="ml-1 text-[10px] uppercase text-zinc-400">{i.unit_code}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {bySerial(i, snOn) ? (
                            // SN on → the count is whatever the serials say; the
                            // field is locked and only the SN modal moves it.
                            <div className="flex items-center justify-center gap-2">
                              <input
                                type="text"
                                readOnly
                                tabIndex={-1}
                                value={formatQty(i.before_qty + (d ?? 0))}
                                title="ນັບຈາກ ISN — ແກ້ດ້ວຍປຸ່ມ ຈັດການ SN"
                                className="w-20 cursor-not-allowed rounded-lg bg-zinc-100 px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums text-zinc-500 ring-1 ring-zinc-200 outline-none dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
                              />
                              <button
                                type="button"
                                onClick={() => setSerialItem(i.item_code)}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 ring-1 ring-violet-200 transition hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/50"
                              >
                                <LayersIcon className="h-3.5 w-3.5" />
                                {serialActivity(i) > 0 ? `ອອກ ${i.serialsRemove.length} · ເພີ່ມ ${i.serialsAdd.length + i.serialsGenerate}` : "ຈັດການ SN"}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => stepCount(i.item_code, -1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                                aria-label="ຫຼຸດ"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="decimal"
                                value={i.counted}
                                onChange={(e) => setCounted(i.item_code, e.target.value)}
                                className="w-24 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:ring-zinc-800"
                              />
                              <button
                                type="button"
                                onClick={() => stepCount(i.item_code, 1)}
                                className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                                aria-label="ເພີ່ມ"
                              >
                                +
                              </button>
                            </div>
                          )}
                        </td>
                        <td className={`px-4 py-2.5 text-right font-mono text-base font-bold tabular-nums ${dColor}`}>
                          {d === null ? "—" : d === 0 ? "0" : `${d > 0 ? "+" : ""}${formatQty(d)}`}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => removeItem(i.item_code)}
                            className="rounded p-1 text-zinc-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-600 dark:hover:bg-rose-500/10"
                            aria-label="ລຶບອອກ"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}>
                              <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" onClick={() => goTo(1)} className={ghostBtn}>
              ← ກັບ
            </button>
            <div className="flex items-center gap-3">
              {changedItems.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
                  <AlertIcon className="h-3.5 w-3.5" />
                  {changedItems.length} ປ່ຽນແປງ
                </span>
              )}
              <button type="button" onClick={() => goTo(3)} disabled={items.length === 0} className={primaryBtn}>
                ກວດ + ຢືນຢັນ →
              </button>
            </div>
          </div>
        </section>
      )}

      {/* STEP 3 — confirm */}
      {step === 3 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <CheckIcon className="h-4 w-4 text-emerald-500" />
            ກວດສອບ ແລະ ຢືນຢັນການປັບປຸງ
          </h3>
          <p className="mb-4 text-xs text-zinc-500">
            ບ່ອນຈັດເກັບ: <span className="font-mono">{nodeLabel}</span>
          </p>

          {changedItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-8 text-center dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500">ຍັງບໍ່ມີລາຍການທີ່ປ່ຽນແປງ</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">ກັບໄປຂັ້ນຕອນນັບສິນຄ້າ ເພື່ອປ້ອນຈຳນວນທີ່ນັບໄດ້</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                    <th className="px-3 py-2">ສິນຄ້າ</th>
                    <th className="px-3 py-2 text-right">ກ່ອນ</th>
                    <th className="px-3 py-2 text-right">ຫຼັງ</th>
                    <th className="px-3 py-2 text-right">ປ່ຽນແປງ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {changedItems.map((i) => {
                    const d = deltaOf(i, snOn) ?? 0;
                    const dColor = d > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
                    return (
                      <tr key={i.item_code}>
                        <td className="px-3 py-2">
                          <div className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{i.item_code}</div>
                          <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={i.item_name ?? ""}>{i.item_name ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">{formatQty(i.before_qty)}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{formatQty(i.before_qty + d)}</td>
                        <td className={`px-3 py-2 text-right font-mono text-xs font-bold tabular-nums ${dColor}`}>{d > 0 ? "+" : ""}{formatQty(d)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <label className={labelCls}>ເຫດຜົນ *</label>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls}>
                {REASONS.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>ໝາຍເຫດ (ທາງເລືອກ)</label>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ລາຍລະອຽດເພີ່ມເຕີມ..." className={inputCls} />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-2">
            <button type="button" onClick={() => goTo(2)} className={ghostBtn}>
              ← ກັບໄປແກ້ໄຂ
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || changedItems.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-50"
            >
              <CheckIcon className="h-4 w-4" />
              {submitting ? "ກຳລັງບັນທຶກ..." : `ບັນທຶກ ${changedItems.length} ລາຍການ`}
            </button>
          </div>
        </section>
      )}

      {/* Toast */}
      {serialItem && (() => {
        const it = items.find((x) => x.item_code === serialItem);
        if (!it) return null;
        return (
          <AdjustSerialModal
            whCode={whCode}
            rack={rackCode}
            location={locationCode}
            pallet={palletCode}
            item={{ item_code: it.item_code, item_name: it.item_name, before: it.before_qty }}
            initial={{ serialsRemove: it.serialsRemove, serialsAdd: it.serialsAdd, serialsGenerate: it.serialsGenerate }}
            onClose={() => setSerialItem(null)}
            onDone={(plan: SerialPlan) => {
              setItems((prev) => prev.map((x) => (x.item_code === serialItem ? { ...x, ...plan } : x)));
              setSerialItem(null);
            }}
          />
        );
      })()}

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

function Stepper({
  step,
  canGoTo,
  onJump,
}: {
  step: number;
  canGoTo: (n: number) => boolean;
  onJump: (n: 1 | 2 | 3) => void;
}) {
  return (
    <nav className="shadow-card rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <ol className="flex items-center">
        {STEPS.map((s, idx) => {
          const active = step === s.n;
          const done = step > s.n;
          const reachable = canGoTo(s.n);
          return (
            <li key={s.n} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                onClick={() => onJump(s.n as 1 | 2 | 3)}
                disabled={!reachable}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 transition ${reachable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : "cursor-not-allowed"}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                    active
                      ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/30"
                      : done
                        ? "bg-emerald-500 text-white"
                        : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                  }`}
                >
                  {done ? "✓" : s.n}
                </span>
                <span
                  className={`hidden text-sm font-semibold sm:inline ${
                    active ? "text-zinc-900 dark:text-zinc-50" : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {idx < STEPS.length - 1 && (
                <span className={`mx-1.5 h-0.5 flex-1 rounded-full sm:mx-3 ${step > s.n ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

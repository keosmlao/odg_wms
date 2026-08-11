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

/** A storage node in the warehouse that currently holds stock of an item. */
type StockNode = { rack: string; location: string; pallet: string; qty: string };

type ItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  balance_qty: string | null; // balance at the queried node
  wh_balance: string | null; // total balance in the warehouse
  is_isn: number | null;
  locations?: StockNode[]; // where the item sits now (product-first search only)
};

/** The fields every counted line shares — enough to compute a delta. */
type CountLine = {
  before_qty: number;
  counted: string;
  serialized: boolean;
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

type StepDef = { n: number; label: string };
const PRODUCT_STEPS: StepDef[] = [
  { n: 1, label: "ນັບສິນຄ້າ" },
  { n: 2, label: "ຢືນຢັນ" },
];
const LOCATION_STEPS: StepDef[] = [
  { n: 1, label: "ບ່ອນຈັດເກັບ" },
  { n: 2, label: "ນັບສິນຄ້າ" },
  { n: 3, label: "ຢືນຢັນ" },
];

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
function serialActivity(item: CountLine): number {
  return item.serialsRemove.length + item.serialsAdd.length + item.serialsGenerate;
}

/**
 * A line is counted by serial only when the item is ISN-tracked AND the
 * warehouse has SN on for the adjust menu. With SN off every line — serial
 * items included — is counted by typing a quantity, matching what the server
 * accepts (it drops serial payloads when the flag is off).
 */
function bySerial(item: CountLine, snOn: boolean): boolean {
  return item.serialized && snOn;
}

function deltaOf(item: CountLine, snOn: boolean): number | null {
  if (bySerial(item, snOn)) {
    return item.serialsAdd.length + item.serialsGenerate - item.serialsRemove.length;
  }
  const c = parsedCount(item.counted);
  if (c === null) return null;
  return Math.round((c - item.before_qty) * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Wrapper: choose where the adjustment starts.
//   • product  — start from the item, enter qty, then pick location per line
//   • location — pick a location first, then count what's there (classic flow)
// ---------------------------------------------------------------------------
export default function AdjustClient({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [mode, setMode] = useState<"product" | "location">("product");

  return (
    <div className="space-y-5">
      <ModeToggle mode={mode} onChange={setMode} />
      {mode === "product" ? (
        <ProductAdjust warehouses={warehouses} />
      ) : (
        <LocationAdjust warehouses={warehouses} />
      )}
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: "product" | "location"; onChange: (m: "product" | "location") => void }) {
  const opts: { key: "product" | "location"; label: string; hint: string; icon: React.ReactNode }[] = [
    { key: "product", label: "ເລີ່ມຈາກສິນຄ້າ", hint: "ສິນຄ້າ → ຈຳນວນ → location", icon: <PackageIcon className="h-4 w-4" /> },
    { key: "location", label: "ເລີ່ມຈາກບ່ອນຈັດເກັບ", hint: "location → ນັບສິນຄ້າ", icon: <MapPinIcon className="h-4 w-4" /> },
  ];
  return (
    <nav className="shadow-card flex flex-wrap items-center gap-2 rounded-2xl bg-white p-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <span className="px-2 text-xs font-semibold text-zinc-400">ເລີ່ມຈາກ:</span>
      {opts.map((o) => {
        const active = mode === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${
              active
                ? "bg-gradient-to-r from-brand-500 to-aqua-600 text-white shadow-md shadow-brand-500/20"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
            }`}
          >
            {o.icon}
            <span>{o.label}</span>
            <span className={`hidden text-[10px] font-normal sm:inline ${active ? "text-white/80" : "text-zinc-400"}`}>· {o.hint}</span>
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------
const inputCls =
  "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-brand-500 to-aqua-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:shadow-lg disabled:opacity-50";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

function Toast({ toast }: { toast: { kind: "ok" | "err"; text: string } | null }) {
  if (!toast) return null;
  return (
    <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
      <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
        {toast.kind === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}
        {toast.text}
      </div>
    </div>
  );
}

function Stepper({
  steps,
  step,
  canGoTo,
  onJump,
}: {
  steps: StepDef[];
  step: number;
  canGoTo: (n: number) => boolean;
  onJump: (n: number) => void;
}) {
  return (
    <nav className="shadow-card rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <ol className="flex items-center">
        {steps.map((s, idx) => {
          const active = step === s.n;
          const done = step > s.n;
          const reachable = canGoTo(s.n);
          return (
            <li key={s.n} className="flex flex-1 items-center last:flex-none">
              <button
                type="button"
                onClick={() => onJump(s.n)}
                disabled={!reachable}
                className={`flex items-center gap-2 rounded-lg px-2 py-1 transition ${reachable ? "cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/60" : "cursor-not-allowed"}`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                    active
                      ? "bg-brand-600 text-white shadow-md shadow-brand-500/30"
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
              {idx < steps.length - 1 && (
                <span className={`mx-1.5 h-0.5 flex-1 rounded-full sm:mx-3 ${step > s.n ? "bg-emerald-400" : "bg-zinc-200 dark:bg-zinc-800"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ===========================================================================
// PRODUCT-FIRST FLOW (new)
//   Add product → enter qty → choose Rack/Location/Pallet per line.
//   Warehouse-wide total shown on add; the location's balance drives the delta.
// ===========================================================================
type PWorking = CountLine & {
  id: string; // stable per-line id (same item may appear at several nodes)
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  wh_balance: number | null; // total in the warehouse (info only)
  rack: string;
  location: string;
  pallet: string;
  balLoading: boolean; // fetching before_qty for the current node
  locations: StockNode[]; // where the item sits now, biggest holding first
};

function pNodeKey(i: { item_code: string; rack: string; location: string; pallet: string }) {
  return `${i.item_code}|${i.rack}|${i.location}|${i.pallet}`;
}
function pNodePath(i: { rack: string; location: string; pallet: string }) {
  const parts = [i.rack, i.location].filter(Boolean);
  if (i.pallet) parts.push(`pallet:${i.pallet}`);
  return parts.length ? parts.join(" / ") : "ບໍ່ລະບຸ (ສາງລວມ)";
}
/** Same node? — compares only the three storage fields. */
function sameNode(a: { rack: string; location: string; pallet: string }, b: { rack: string; location: string; pallet: string }) {
  return a.rack === b.rack && a.location === b.location && a.pallet === b.pallet;
}
/**
 * Balance the "ຢູ່ປະຈຸບັນ" chips already report for a node — lets the line's
 * ຍອດບ່ອນນີ້ follow a chip click instantly, before the server confirms it.
 * null = this node is not one of the item's known holdings.
 */
function knownNodeQty(nodes: StockNode[], node: { rack: string; location: string; pallet: string }) {
  const hit = nodes.find((n) => sameNode(n, node));
  return hit ? Number.parseFloat(hit.qty) || 0 : null;
}

/**
 * ຜົນກະທົບຕໍ່ **ຍອດທັງສາງ** ຂອງສິນຄ້າໜຶ່ງ — ລວມ delta ຂອງທຸກແຖວທີ່ເປັນລະຫັດນີ້.
 * ນັບຄົບທຸກບ່ອນຈັດເກັບແລ້ວ ຍອດໃໝ່ທັງສາງຈະເທົ່າກັບຜົນລວມທີ່ປ້ອນເຂົ້າພໍດີ;
 * `uncounted` ບອກວ່າຍັງເຫຼືອບ່ອນທີ່ມີເຄື່ອງຢູ່ແຕ່ຍັງບໍ່ໄດ້ໃສ່ຈຳນວນຈັກບ່ອນ.
 */
function whProjection(rows: PWorking[], itemCode: string, snOn: boolean) {
  const mine = rows.filter((r) => r.item_code === itemCode);
  const base = mine[0]?.wh_balance ?? null;
  let delta = 0;
  let entered = 0;
  const covered = new Set<string>();
  for (const r of mine) {
    const d = deltaOf(r, snOn);
    if (d === null) continue;
    delta += d;
    entered += 1;
    covered.add(pNodeKey(r));
  }
  const nodes = mine[0]?.locations ?? [];
  const uncounted = nodes.filter((n) => !covered.has(pNodeKey({ item_code: itemCode, ...n }))).length;
  // /api/movements/items/search ຄືນ location ໃຫ້ສູງສຸດ 8 ບ່ອນຕໍ່ສິນຄ້າ. ຖ້າຜົນລວມ
  // ຂອງບ່ອນທີ່ຮູ້ບໍ່ເທົ່າຍອດທັງສາງ ແປວ່າຍັງມີບ່ອນອື່ນທີ່ບໍ່ໄດ້ສະແດງ — ຫ້າມບອກວ່າ "ນັບຄົບ".
  const sumNodes = nodes.reduce((s, n) => s + (Number.parseFloat(n.qty) || 0), 0);
  const partial = base !== null && Math.abs(base - sumNodes) > 1e-6;
  return {
    newTotal: base === null || entered === 0 ? null : Math.round((base + delta) * 1e6) / 1e6,
    uncounted,
    partial,
  };
}

/** ບ່ອນຈັດເກັບທີ່ຍັງຖືເຄື່ອງຢູ່ ແຕ່ຜູ້ໃຊ້ບໍ່ໄດ້ນັບ — ຕົວທີ່ເຮັດໃຫ້ຍອດທັງສາງບໍ່ເທົ່າຜົນລວມທີ່ນັບ. */
export type FillGap = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  /** ຜົນລວມຈຳນວນທີ່ຜູ້ໃຊ້ປ້ອນເຂົ້າ. */
  countedSum: number;
  /** ຍອດທັງສາງທີ່ຈະໄດ້ ຖ້າບັນທຶກຕາມທີ່ປ້ອນ (ບ່ອນທີ່ບໍ່ນັບຍັງຄືເກົ່າ). */
  projected: number;
  /** ບ່ອນທີ່ຕ້ອງປັບເປັນ 0 ຖ້າຢືນຢັນໃຫ້ຍອດເທົ່າກັບຜົນລວມທີ່ນັບ. */
  bins: { rack: string; location: string; pallet: string; qty: number }[];
  /** ຍັງມີບ່ອນເກັບທີ່ API ບໍ່ໄດ້ສົ່ງມາ (ເກີນ 8 ບ່ອນ) → ປັບໃຫ້ຄົບບໍ່ໄດ້. */
  partial: boolean;
};

/**
 * ນັບແຕ່ບາງບ່ອນ → ຍອດທັງສາງໃໝ່ຈະບໍ່ເທົ່າກັບຜົນລວມທີ່ນັບໄດ້ ເພາະບ່ອນທີ່ບໍ່ໄດ້ນັບຍັງຖືເຄື່ອງຢູ່.
 * ຕົວຢ່າງ: ທັງສາງ 100 (lo1 60 · lo2 30 · lo3 10) ນັບ lo1=20, lo2=30 → ຜົນລວມ 50
 * ແຕ່ຍອດທັງສາງຈະເປັນ 60 ເພາະ lo3 ຍັງມີ 10. ຄືນລາຍການເຫຼົ່ານີ້ໃຫ້ຖາມຜູ້ໃຊ້ຕອນບັນທຶກ.
 *
 * ຂ້າມລາຍການທີ່ນັບດ້ວຍ serial — ຈຳນວນມາຈາກການສະແກນ ບໍ່ແມ່ນການພິມ.
 */
function computeFillGaps(rows: PWorking[], snOn: boolean): FillGap[] {
  const byItem = new Map<string, PWorking[]>();
  for (const r of rows) {
    const list = byItem.get(r.item_code);
    if (list) list.push(r);
    else byItem.set(r.item_code, [r]);
  }
  const out: FillGap[] = [];
  for (const [code, mine] of byItem) {
    if (mine.some((r) => bySerial(r, snOn))) continue;
    const counted = mine.filter((r) => parsedCount(r.counted) !== null);
    if (counted.length === 0) continue;
    const base = mine[0].wh_balance;
    if (base === null) continue;

    const countedSum = counted.reduce((s, r) => s + (parsedCount(r.counted) ?? 0), 0);
    const delta = counted.reduce((s, r) => s + (deltaOf(r, snOn) ?? 0), 0);
    const projected = Math.round((base + delta) * 1e6) / 1e6;
    if (Math.abs(projected - countedSum) < 1e-6) continue; // ຕົງກັນຢູ່ແລ້ວ

    const coveredKeys = new Set(counted.map((r) => pNodeKey(r)));
    const nodes = mine[0].locations ?? [];
    const bins = nodes
      .filter((n) => !coveredKeys.has(pNodeKey({ item_code: code, ...n })))
      .map((n) => ({ rack: n.rack, location: n.location, pallet: n.pallet, qty: Number.parseFloat(n.qty) || 0 }))
      .filter((n) => n.qty !== 0);
    const sumNodes = nodes.reduce((s, n) => s + (Number.parseFloat(n.qty) || 0), 0);
    out.push({
      item_code: code,
      item_name: mine[0].item_name,
      unit_code: mine[0].unit_code,
      countedSum,
      projected,
      bins,
      partial: Math.abs(base - sumNodes) > 1e-6,
    });
  }
  return out;
}

/** Read-only "where it sits now" summary, shown on each search result. */
function NodeSummary({ nodes, unit }: { nodes: StockNode[]; unit: string | null }) {
  if (nodes.length === 0) {
    return <span className="text-[10px] text-zinc-400">ຍັງບໍ່ມີໃນສາງນີ້</span>;
  }
  const shown = nodes.slice(0, 3);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <MapPinIcon className="h-3 w-3 shrink-0 text-brand-400" />
      {shown.map((n) => (
        <span
          key={pNodePath(n)}
          className="rounded bg-brand-50 px-1.5 py-0.5 font-mono text-[10px] text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"
        >
          {pNodePath(n)}
          <span className="ml-1 tabular-nums opacity-70">
            {formatQty(n.qty)}
            {unit ? ` ${unit}` : ""}
          </span>
        </span>
      ))}
      {nodes.length > shown.length && (
        <span className="text-[10px] text-zinc-400">+{nodes.length - shown.length}</span>
      )}
    </span>
  );
}

function ProductAdjust({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [step, setStep] = useState<1 | 2>(1);

  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);

  const [items, setItems] = useState<PWorking[]>([]);

  const [reason, setReason] = useState("count");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ItemHit[]>([]);

  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [serialLine, setSerialLine] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const lineSeq = useRef(0);

  function newLineId() {
    lineSeq.current += 1;
    return `L${lineSeq.current}`;
  }
  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }

  // Load racks + locations + pallets when the warehouse changes; reset the list.
  useEffect(() => {
    setRacks([]);
    setLocations([]);
    setPallets([]);
    setItems([]);
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

  const whName = useMemo(() => warehouses.find((w) => w.code === whCode)?.name ?? null, [warehouses, whCode]);
  const snOn = useMemo(() => warehouses.find((w) => w.code === whCode)?.sn_adjust ?? true, [warehouses, whCode]);
  const locationsForRack = (rack: string) => (rack ? locations.filter((l) => l.rack_code === rack) : locations);

  // Debounced item search (warehouse-wide — location is chosen per line later).
  useEffect(() => {
    if (search.trim().length === 0) {
      setHits([]);
      return;
    }
    if (!whCode) return;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        // locations=1 → each hit also reports where it currently sits, so the
        // user can see the item's node before committing to one.
        const params = new URLSearchParams({ warehouse: whCode, q: search.trim(), locations: "1" });
        const res = await fetch(`/api/movements/items/search?${params}`);
        const data = (await res.json()) as { items?: ItemHit[] };
        setHits(data.items ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, whCode]);

  /**
   * Fetch the system balance of an item AT a given node and store it as the
   * line's before_qty. Node + item passed explicitly (not read from `items`)
   * so callers can fire this right after a state update. Race-guarded.
   */
  async function loadBalance(
    lineId: string,
    node: { rack: string; location: string; pallet: string },
    itemCode: string,
    // quiet = the chips already gave us this node's balance, so keep showing it
    // and let the server value replace it silently instead of flashing "…".
    quiet = false,
  ) {
    if (!whCode) return;
    const reqKey = pNodeKey({ item_code: itemCode, ...node });
    if (!quiet) setItems((prev) => prev.map((i) => (i.id === lineId ? { ...i, balLoading: true } : i)));
    try {
      const params = new URLSearchParams({
        warehouse: whCode,
        rack: node.rack,
        location: node.location,
        pallet: node.pallet,
        q: itemCode,
        limit: "5",
      });
      const res = await fetch(`/api/movements/items/search?${params}`);
      const data = (await res.json()) as { items?: ItemHit[] };
      const hit = (data.items ?? []).find((h) => h.item_code === itemCode);
      const before = Number.parseFloat(hit?.balance_qty ?? "0") || 0;
      setItems((prev) =>
        prev.map((i) => {
          if (i.id !== lineId) return i;
          if (pNodeKey(i) === reqKey) return { ...i, before_qty: before, balLoading: false };
          return { ...i, balLoading: false };
        }),
      );
    } catch {
      setItems((prev) => prev.map((i) => (i.id === lineId ? { ...i, balLoading: false } : i)));
    }
  }

  function addHit(hit: ItemHit) {
    setHits([]);
    setSearch("");
    const whBal = hit.wh_balance === null ? null : Number.parseFloat(hit.wh_balance) || 0;
    const nodes = hit.locations ?? [];

    // ໜຶ່ງແຖວຕໍ່ໜຶ່ງບ່ອນຈັດເກັບ: ສິນຄ້າທີ່ຢູ່ຫຼາຍບ່ອນຕ້ອງປ້ອນຈຳນວນໃໝ່ໄດ້ທຸກບ່ອນ
    // ໃນເທື່ອດຽວ — ບໍ່ຕ້ອງກົດ "+ ບ່ອນຈັດເກັບ" ແລ້ວເລືອກ location ຄືນເອງ.
    // ບໍ່ມີໃນສາງເລີຍ → ແຖວຫວ່າງ 1 ແຖວໃຫ້ເລືອກບ່ອນເອງ.
    const already = new Set(items.filter((i) => i.item_code === hit.item_code).map((i) => pNodeKey(i)));
    const targets = (nodes.length > 0
      ? nodes.map((n) => ({ rack: n.rack, location: n.location, pallet: n.pallet }))
      : [{ rack: "", location: "", pallet: "" }]
    ).filter((n) => !already.has(pNodeKey({ item_code: hit.item_code, ...n })));

    if (targets.length === 0) {
      showToast("err", `${hit.item_code} ເພີ່ມຄົບທຸກບ່ອນຈັດເກັບແລ້ວ`);
      setTimeout(() => searchRef.current?.focus(), 50);
      return;
    }

    const rows: PWorking[] = targets.map((node) => ({
      id: newLineId(),
      item_code: hit.item_code,
      item_name: hit.item_name,
      unit_code: hit.unit_code,
      wh_balance: whBal,
      ...node,
      before_qty: knownNodeQty(nodes, node) ?? 0,
      balLoading: knownNodeQty(nodes, node) === null,
      locations: nodes,
      counted: "",
      serialized: (hit.is_isn ?? 0) === 1,
      serialsRemove: [],
      serialsAdd: [],
      serialsGenerate: 0,
    }));

    setItems((prev) => [...rows, ...prev]);
    for (const r of rows) {
      const node = { rack: r.rack, location: r.location, pallet: r.pallet };
      void loadBalance(r.id, node, hit.item_code, knownNodeQty(nodes, node) !== null);
    }
    setTimeout(() => searchRef.current?.focus(), 50);
  }

  /** ໄປທີ່ແຖວທີ່ນັບບ່ອນຈັດເກັບນີ້ຢູ່ແລ້ວ ແລ້ວ focus ຊ່ອງຈຳນວນ. */
  function focusNodeRow(itemCode: string, node: { rack: string; location: string; pallet: string }) {
    const row = items.find((i) => i.item_code === itemCode && sameNode(i, node));
    if (!row) return;
    const el = document.getElementById(`padj-qty-${row.id}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    (el as HTMLInputElement | null)?.focus();
  }

  function updateLine(lineId: string, patch: Partial<PWorking>) {
    setItems((prev) => prev.map((i) => (i.id === lineId ? { ...i, ...patch } : i)));
  }

  /**
   * Count the same item at a second (third, …) node: clone the line's identity
   * into a fresh row right below it, preselected to the item's next-biggest node
   * that no other row of this item has taken yet.
   */
  function addNodeRow(lineId: string) {
    const src = items.find((i) => i.id === lineId);
    if (!src) return;
    const taken = new Set(items.filter((i) => i.item_code === src.item_code).map((i) => pNodeKey(i)));
    const free = src.locations.find((n) => !taken.has(pNodeKey({ item_code: src.item_code, ...n })));
    const node = { rack: free?.rack ?? "", location: free?.location ?? "", pallet: free?.pallet ?? "" };
    const known = knownNodeQty(src.locations, node);
    const id = newLineId();
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === lineId);
      if (idx < 0) return prev;
      const row: PWorking = {
        ...src,
        id,
        ...node,
        before_qty: known ?? 0,
        balLoading: known === null,
        counted: "",
        serialsRemove: [],
        serialsAdd: [],
        serialsGenerate: 0,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, row);
      return next;
    });
    void loadBalance(id, node, src.item_code, known !== null);
  }

  /** Change one node field on a line, then refresh its system balance. */
  function setLineNode(lineId: string, patch: Partial<Pick<PWorking, "rack" | "location" | "pallet">>) {
    const line = items.find((i) => i.id === lineId);
    if (!line) return;
    const nextNode = { rack: line.rack, location: line.location, pallet: line.pallet, ...patch };
    // The chips carry each node's balance already — move ຍອດບ່ອນນີ້ in the same
    // paint as the node itself; the fetch below only confirms it.
    const known = knownNodeQty(line.locations, nextNode);
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== lineId) return i;
        const next = { ...i, ...nextNode, before_qty: known ?? 0, balLoading: known === null };
        if (bySerial(i, snOn)) {
          next.serialsRemove = [];
          next.serialsAdd = [];
          next.serialsGenerate = 0;
        }
        return next;
      }),
    );
    void loadBalance(lineId, nextNode, line.item_code, known !== null);
  }

  function setCounted(lineId: string, value: string) {
    updateLine(lineId, { counted: value });
  }
  function stepCount(lineId: string, delta: number) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== lineId) return i;
        const cur = parsedCount(i.counted);
        const base = cur === null ? i.before_qty : cur;
        const next = Math.max(0, Math.round((base + delta) * 1e6) / 1e6);
        return { ...i, counted: String(next) };
      }),
    );
  }
  function removeItem(lineId: string) {
    setItems((prev) => prev.filter((i) => i.id !== lineId));
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

  /** Every (item, node) a row already occupies — used to grey out taken chips. */
  const takenNodes = useMemo(() => new Set(items.map((i) => pNodeKey(i))), [items]);

  /** ລາຍການທີ່ນັບບໍ່ຄົບທຸກບ່ອນ → ຖາມຕອນບັນທຶກ. */
  const fillGaps = useMemo(() => computeFillGaps(items, snOn), [items, snOn]);
  const [askFill, setAskFill] = useState(false);

  const duplicateNode = useMemo(() => {
    const seen = new Set<string>();
    for (const i of changedItems) {
      const k = pNodeKey(i);
      if (seen.has(k)) return i;
      seen.add(k);
    }
    return null;
  }, [changedItems]);

  function goToConfirm() {
    if (changedItems.length === 0) {
      showToast("err", "ບໍ່ມີການປ່ຽນແປງ — ໃສ່ຈຳນວນທີ່ນັບໄດ້ກ່ອນ");
      return;
    }
    if (duplicateNode) {
      showToast("err", `ສິນຄ້າ ${duplicateNode.item_code} ຊ້ຳຢູ່ບ່ອນຈັດເກັບດຽວກັນ`);
      return;
    }
    setStep(2);
  }

  /**
   * ບັນທຶກ. ຖ້ານັບບໍ່ຄົບທຸກບ່ອນ ຍອດທັງສາງຈະບໍ່ເທົ່າຜົນລວມທີ່ນັບ — ຖາມກ່ອນ ແທນທີ່ຈະ
   * ຕັດສິນໃຈໃຫ້ເອງ (ບ່ອນທີ່ບໍ່ໄດ້ນັບອາດຈະຖືກຕ້ອງຢູ່ແລ້ວ).
   */
  function submit() {
    if (changedItems.length === 0) {
      showToast("err", "ບໍ່ມີການປ່ຽນແປງໃຫ້ບັນທຶກ");
      return;
    }
    if (duplicateNode) {
      showToast("err", `ສິນຄ້າ ${duplicateNode.item_code} ຊ້ຳຢູ່ບ່ອນຈັດເກັບດຽວກັນ`);
      return;
    }
    if (fillGaps.length > 0) {
      setAskFill(true);
      return;
    }
    void doSubmit(false);
  }

  /** `zeroRest` = ປັບບ່ອນທີ່ບໍ່ໄດ້ນັບໃຫ້ເປັນ 0 ເພື່ອໃຫ້ຍອດທັງສາງ = ຜົນລວມທີ່ນັບໄດ້. */
  async function doSubmit(zeroRest: boolean) {
    setAskFill(false);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          reason,
          note,
          lines: changedItems.map((i) =>
            bySerial(i, snOn)
              ? {
                  item_code: i.item_code,
                  item_name: i.item_name,
                  unit_code: i.unit_code,
                  rack: i.rack,
                  location: i.location,
                  pallet: i.pallet,
                  serials_remove: i.serialsRemove,
                  serials_add: i.serialsAdd,
                  serials_generate: i.serialsGenerate,
                }
              : {
                  item_code: i.item_code,
                  item_name: i.item_name,
                  unit_code: i.unit_code,
                  rack: i.rack,
                  location: i.location,
                  pallet: i.pallet,
                  counted_qty: parsedCount(i.counted),
                },
          ).concat(
            // ບ່ອນທີ່ບໍ່ໄດ້ນັບ → ປັບເປັນ 0 ເພື່ອໃຫ້ຍອດທັງສາງເທົ່າກັບຜົນລວມທີ່ນັບໄດ້
            zeroRest
              ? fillGaps.flatMap((g) =>
                  g.bins.map((b) => ({
                    item_code: g.item_code,
                    item_name: g.item_name,
                    unit_code: g.unit_code,
                    rack: b.rack,
                    location: b.location,
                    pallet: b.pallet,
                    counted_qty: 0,
                  })),
                )
              : [],
          ),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; adjust_code?: string; changed?: number; sn_generated?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ບັນທຶກແລ້ວ ${data.adjust_code} · ${data.changed} ລາຍການ${data.sn_generated ? ` · gen ${data.sn_generated} ISN` : ""}`);
      setItems([]);
      setNote("");
      setStep(1);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  function canGoTo(n: number) {
    if (n === 1) return true;
    if (n === 2) return changedItems.length > 0 && !duplicateNode;
    return false;
  }

  const fieldLabel = "mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-400";
  const smallSelect =
    "w-full rounded-lg bg-white px-2 py-1.5 text-xs text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-brand-500 disabled:opacity-50 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-5">
      <Stepper steps={PRODUCT_STEPS} step={step} canGoTo={canGoTo} onJump={(n) => (n === 2 ? goToConfirm() : setStep(1))} />

      {step === 1 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          {/* Warehouse + search */}
          <div className="mb-4 grid gap-4 sm:grid-cols-[240px_1fr]">
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
              <label className={labelCls}>
                ເພີ່ມສິນຄ້າ
                {!snOn && (
                  <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    SN ປິດ · ປ້ອນຈຳນວນ
                  </span>
                )}
              </label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  disabled={!whCode}
                  placeholder={whCode ? "ສະແກນ / ພິມ ລະຫັດ ຫຼື ຊື່ ເພື່ອເພີ່ມສິນຄ້າ..." : "ເລືອກສາງກ່ອນ"}
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
                        <PlusIcon className="h-4 w-4 shrink-0 text-brand-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{h.item_code}</div>
                          <div className="truncate text-xs">{h.item_name}</div>
                          <div className="mt-1">
                            <NodeSummary nodes={h.locations ?? []} unit={h.unit_code} />
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[10px]">
                          <div className="font-mono font-bold tabular-nums text-zinc-700 dark:text-zinc-200">ສາງ {formatQty(h.wh_balance)}</div>
                          <div className="text-zinc-400">{h.unit_code}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-10 text-center dark:border-zinc-800">
              <PackageIcon className="mx-auto h-7 w-7 text-zinc-300 dark:text-zinc-600" />
              <p className="mt-2 text-xs font-semibold text-zinc-500">
                {whCode ? "ຄົ້ນຫາ ແລະ ເພີ່ມສິນຄ້າ → ໃສ່ຈຳນວນ → ເລືອກ location/pallet" : "ເລືອກສາງເພື່ອເລີ່ມ"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((i) => {
                const d = deltaOf(i, snOn);
                const dColor =
                  d === null || d === 0 ? "text-zinc-400" : d > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
                const dup = duplicateNode?.id === i.id;
                const proj = whProjection(items, i.item_code, snOn);
                return (
                  <div
                    key={i.id}
                    className={`rounded-xl bg-zinc-50/60 p-3 ring-1 dark:bg-zinc-800/30 ${dup ? "ring-rose-300 dark:ring-rose-900/60" : "ring-zinc-200 dark:ring-zinc-800"}`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{i.item_code}</div>
                        <div className="max-w-md truncate text-sm text-zinc-800 dark:text-zinc-200" title={i.item_name ?? ""}>
                          {i.item_name ?? "—"}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">ຍອດທັງສາງ</div>
                          <div className="font-mono text-sm font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                            {proj.newTotal !== null && (
                              <span className="mr-1 font-normal text-zinc-400 line-through">{formatQty(i.wh_balance)}</span>
                            )}
                            {proj.newTotal !== null ? formatQty(proj.newTotal) : formatQty(i.wh_balance)}
                            <span className="ml-1 text-[10px] uppercase text-zinc-400">{i.unit_code}</span>
                          </div>
                          {/* ນັບຄົບທຸກບ່ອນ = ຍອດທັງສາງໃໝ່ເທົ່າກັບຜົນລວມທີ່ປ້ອນ */}
                          {proj.newTotal !== null &&
                            (proj.uncounted > 0 ? (
                              <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                ຍັງບໍ່ນັບ {proj.uncounted} ບ່ອນ
                              </div>
                            ) : proj.partial ? (
                              <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                ຍັງມີບ່ອນເກັບອື່ນທີ່ບໍ່ໄດ້ສະແດງ
                              </div>
                            ) : (
                              <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                ນັບຄົບທຸກບ່ອນ
                              </div>
                            ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(i.id)}
                          className="rounded p-1 text-zinc-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-600 dark:hover:bg-rose-500/10"
                          aria-label="ລຶບອອກ"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2}>
                            <path d="M18 6 6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Where the item sits today — one click moves the line to that node. */}
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                        <MapPinIcon className="h-3 w-3" />
                        ຢູ່ປະຈຸບັນ
                      </span>
                      {i.locations.length === 0 ? (
                        <span className="text-[11px] text-zinc-400">ຍັງບໍ່ມີສິນຄ້ານີ້ໃນສາງ — ເລືອກບ່ອນຈັດເກັບເອງ</span>
                      ) : (
                        i.locations.map((n) => {
                          const active = sameNode(i, n);
                          // Already counted on another row of this item — clicking would
                          // just make a duplicate, so point the user at that row instead.
                          const taken = !active && takenNodes.has(pNodeKey({ item_code: i.item_code, ...n }));
                          return (
                            <button
                              key={pNodePath(n)}
                              type="button"
                              // ບ່ອນທີ່ມີແຖວຂອງມັນຢູ່ແລ້ວ → ກະໂດດໄປແຖວນັ້ນ (ບໍ່ແມ່ນປິດປຸ່ມ),
                              // ເພາະດຽວນີ້ທຸກບ່ອນຈັດເກັບຂອງສິນຄ້າມີແຖວປ້ອນຈຳນວນຂອງໃຜລາວ.
                              onClick={() =>
                                taken
                                  ? focusNodeRow(i.item_code, { rack: n.rack, location: n.location, pallet: n.pallet })
                                  : setLineNode(i.id, { rack: n.rack, location: n.location, pallet: n.pallet })
                              }
                              title={taken ? "ໄປທີ່ແຖວຂອງບ່ອນນີ້" : "ໃຊ້ບ່ອນຈັດເກັບນີ້"}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[11px] transition ${
                                active
                                  ? "bg-brand-600 text-white shadow-sm"
                                  : taken
                                    ? "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-700"
                                    : "bg-brand-50 text-brand-700 ring-1 ring-brand-100 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900/50 dark:hover:bg-brand-900/40"
                              }`}
                            >
                              {pNodePath(n)}
                              <span className={`tabular-nums ${active ? "text-white/80" : taken ? "" : "text-brand-500/80 dark:text-brand-400/80"}`}>
                                {formatQty(n.qty)}
                              </span>
                            </button>
                          );
                        })
                      )}
                      <button
                        type="button"
                        onClick={() => addNodeRow(i.id)}
                        title="ນັບສິນຄ້ານີ້ຢູ່ອີກບ່ອນຈັດເກັບໜຶ່ງ"
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                      >
                        <PlusIcon className="h-3 w-3" />
                        ບ່ອນຈັດເກັບ
                      </button>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_auto]">
                      <div>
                        <span className={fieldLabel}>ນັບໄດ້</span>
                        {bySerial(i, snOn) ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              tabIndex={-1}
                              value={formatQty(i.before_qty + (d ?? 0))}
                              title="ນັບຈາກ ISN — ແກ້ດ້ວຍປຸ່ມ ຈັດການ SN"
                              className="w-16 cursor-not-allowed rounded-lg bg-zinc-100 px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums text-zinc-500 ring-1 ring-zinc-200 outline-none dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700"
                            />
                            <button
                              type="button"
                              onClick={() => setSerialLine(i.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-aqua-50 px-3 py-1.5 text-xs font-semibold text-aqua-700 ring-1 ring-aqua-200 transition hover:bg-aqua-100 dark:bg-aqua-950/40 dark:text-aqua-300 dark:ring-aqua-900/50"
                            >
                              <LayersIcon className="h-3.5 w-3.5" />
                              {serialActivity(i) > 0 ? `ອອກ ${i.serialsRemove.length} · ເພີ່ມ ${i.serialsAdd.length + i.serialsGenerate}` : "ຈັດການ SN"}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => stepCount(i.id, -1)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              aria-label="ຫຼຸດ"
                            >
                              −
                            </button>
                            <input
                              id={`padj-qty-${i.id}`}
                              type="number"
                              inputMode="decimal"
                              value={i.counted}
                              onChange={(e) => setCounted(i.id, e.target.value)}
                              placeholder="0"
                              className="w-full min-w-0 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
                            />
                            <button
                              type="button"
                              onClick={() => stepCount(i.id, 1)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                              aria-label="ເພີ່ມ"
                            >
                              +
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <span className={fieldLabel}>Rack</span>
                          <select value={i.rack} onChange={(e) => setLineNode(i.id, { rack: e.target.value, location: "" })} className={smallSelect}>
                            <option value="">— ທຸກ rack —</option>
                            {/* A node picked from the chips may name a rack the master list has dropped. */}
                            {i.rack && !racks.some((r) => r.code === i.rack) && <option value={i.rack}>{i.rack}</option>}
                            {racks.map((r) => (
                              <option key={r.code} value={r.code}>
                                {r.code}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <span className={fieldLabel}>Location</span>
                          <select value={i.location} onChange={(e) => setLineNode(i.id, { location: e.target.value })} disabled={!i.rack && !i.location} className={smallSelect}>
                            <option value="">{i.rack ? "— ທຸກ location —" : "ເລືອກ rack"}</option>
                            {i.location && !locationsForRack(i.rack).some((l) => l.code === i.location) && (
                              <option value={i.location}>{i.location}</option>
                            )}
                            {locationsForRack(i.rack).map((l) => (
                              <option key={l.code} value={l.code}>
                                {l.code}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <span className={fieldLabel}>Pallet</span>
                          <select
                            value={i.pallet}
                            onChange={(e) => {
                              const code = e.target.value;
                              const p = pallets.find((x) => x.code === code);
                              setLineNode(i.id, {
                                pallet: code,
                                ...(p?.rack ? { rack: p.rack } : {}),
                                ...(p?.location ? { location: p.location } : {}),
                              });
                            }}
                            className={smallSelect}
                          >
                            <option value="">— ບໍ່ມີ —</option>
                            {i.pallet && !pallets.some((p) => p.code === i.pallet) && <option value={i.pallet}>{i.pallet}</option>}
                            {pallets.map((p) => (
                              <option key={p.code} value={p.code}>
                                {p.code}
                                {p.location ? ` → ${p.location}` : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-4 lg:pl-2">
                        <div className="text-right">
                          <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">ຍອດບ່ອນນີ້</div>
                          <div className="font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">{i.balLoading ? "…" : formatQty(i.before_qty)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">ປ່ຽນແປງ</div>
                          <div className={`font-mono text-base font-bold tabular-nums ${dColor}`}>
                            {d === null ? "—" : d === 0 ? "0" : `${d > 0 ? "+" : ""}${formatQty(d)}`}
                          </div>
                        </div>
                      </div>
                    </div>

                    {dup && <p className="mt-2 text-[11px] font-semibold text-rose-500">⚠ ຊ້ຳກັບອີກແຖວທີ່ບ່ອນຈັດເກັບດຽວກັນ — ປ່ຽນ location ຫຼື ລວມແຖວ</p>}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-3">
            {changedItems.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50">
                <AlertIcon className="h-3.5 w-3.5" />
                {changedItems.length} ປ່ຽນແປງ
              </span>
            )}
            <button type="button" onClick={goToConfirm} disabled={changedItems.length === 0} className={primaryBtn}>
              ກວດ + ຢືນຢັນ →
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <CheckIcon className="h-4 w-4 text-emerald-500" />
            ກວດສອບ ແລະ ຢືນຢັນການປັບປຸງ
          </h3>
          <p className="mb-4 text-xs text-zinc-500">
            ສາງ: <span className="font-mono">{whCode || "—"}</span>
            {whName && <span className="text-zinc-400"> · {whName}</span>}
          </p>

          {changedItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 py-8 text-center dark:border-zinc-800">
              <p className="text-xs font-semibold text-zinc-500">ຍັງບໍ່ມີລາຍການທີ່ປ່ຽນແປງ</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                      <th className="px-3 py-2">ສິນຄ້າ</th>
                      <th className="px-3 py-2">ບ່ອນຈັດເກັບ</th>
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
                        <tr key={i.id}>
                          <td className="px-3 py-2">
                            <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{i.item_code}</div>
                            <div className="max-w-xs truncate text-xs text-zinc-700 dark:text-zinc-300" title={i.item_name ?? ""}>{i.item_name ?? "—"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                              <MapPinIcon className="h-3 w-3 text-brand-400" />
                              {pNodePath(i)}
                            </span>
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
            <button type="button" onClick={() => setStep(1)} className={ghostBtn}>
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

      {askFill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
              ຕ້ອງການໃຫ້ຍອດຄົງເຫຼືອເທົ່າກັບຈຳນວນທີ່ນັບໄດ້ບໍ?
            </h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              ຍັງມີບ່ອນຈັດເກັບທີ່ບໍ່ໄດ້ນັບ ແລະ ຍັງຖືເຄື່ອງຢູ່ — ຖ້າຢືນຢັນ ຈະປັບບ່ອນເຫຼົ່ານັ້ນໃຫ້ເປັນ <b>0</b>
              ເພື່ອໃຫ້ຍອດທັງສາງເທົ່າກັບຜົນລວມທີ່ນັບໄດ້.
            </p>

            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {fillGaps.map((g) => (
                <div key={g.item_code} className="rounded-xl bg-zinc-50 p-3 text-xs dark:bg-zinc-800/50">
                  <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{g.item_code}</div>
                  <div className="truncate text-zinc-700 dark:text-zinc-300">{g.item_name ?? "—"}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono tabular-nums">
                    <span className="text-zinc-500">ນັບໄດ້ <b className="text-zinc-900 dark:text-zinc-100">{formatQty(g.countedSum)}</b></span>
                    <span className="text-zinc-500">ຖ້າບໍ່ປັບ <b className="text-amber-600 dark:text-amber-400">{formatQty(g.projected)}</b></span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {g.bins.map((b) => (
                      <span key={pNodePath(b)} className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                        {pNodePath(b)} <span className="tabular-nums">{formatQty(b.qty)} → 0</span>
                      </span>
                    ))}
                  </div>
                  {g.partial && (
                    <div className="mt-1.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      ⚠ ສິນຄ້ານີ້ຢູ່ຫຼາຍກວ່າ 8 ບ່ອນ — ປັບໄດ້ສະເພາະບ່ອນທີ່ສະແດງ ຍອດອາດຍັງບໍ່ຕົງ
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAskFill(false)} className={ghostBtn}>
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={() => void doSubmit(false)}
                disabled={submitting}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                ບໍ່ — ບັນທຶກສະເພາະທີ່ນັບ
              </button>
              <button
                type="button"
                onClick={() => void doSubmit(true)}
                disabled={submitting}
                className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:shadow-lg disabled:opacity-50"
              >
                ແມ່ນ — ປັບໃຫ້ເທົ່າ
              </button>
            </div>
          </div>
        </div>
      )}

      {serialLine && (() => {
        const it = items.find((x) => x.id === serialLine);
        if (!it) return null;
        return (
          <AdjustSerialModal
            whCode={whCode}
            rack={it.rack}
            location={it.location}
            pallet={it.pallet}
            item={{ item_code: it.item_code, item_name: it.item_name, before: it.before_qty }}
            initial={{ serialsRemove: it.serialsRemove, serialsAdd: it.serialsAdd, serialsGenerate: it.serialsGenerate }}
            onClose={() => setSerialLine(null)}
            onDone={(plan: SerialPlan) => {
              setItems((prev) => prev.map((x) => (x.id === serialLine ? { ...x, ...plan } : x)));
              setSerialLine(null);
            }}
          />
        );
      })()}

      <Toast toast={toast} />
    </div>
  );
}

// ===========================================================================
// LOCATION-FIRST FLOW (classic)
//   Pick a location → load & count everything there → confirm.
//   One node for the whole document.
// ===========================================================================
type LWorking = CountLine & {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  wh_balance: number | null; // total in warehouse (info only)
};

function LocationAdjust({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [whCode, setWhCode] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [racks, setRacks] = useState<RackOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [pallets, setPallets] = useState<PalletOption[]>([]);
  const [rackCode, setRackCode] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [palletCode, setPalletCode] = useState("");

  const [items, setItems] = useState<LWorking[]>([]);
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

  useEffect(() => {
    if (locationCode && rackCode && !availableLocations.find((l) => l.code === locationCode)) {
      setLocationCode("");
    }
  }, [rackCode, locationCode, availableLocations]);

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

  const whName = useMemo(() => warehouses.find((w) => w.code === whCode)?.name ?? null, [warehouses, whCode]);
  const snOn = useMemo(() => warehouses.find((w) => w.code === whCode)?.sn_adjust ?? true, [warehouses, whCode]);

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
      const loadedItems: LWorking[] = (data.items ?? []).map((r) => {
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

  useEffect(() => {
    if (step === 2 && whCode && !loaded && !loading) {
      void loadItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

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
      await loadItems();
      setStep(2);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  function canGoTo(n: number) {
    if (n === 1) return true;
    if (n === 2) return !!whCode;
    if (n === 3) return items.length > 0;
    return false;
  }
  function goTo(n: number) {
    if (canGoTo(n)) setStep(n as 1 | 2 | 3);
  }

  return (
    <div className="space-y-5">
      <Stepper steps={LOCATION_STEPS} step={step} canGoTo={canGoTo} onJump={goTo} />

      {step === 1 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            <MapPinIcon className="h-4 w-4 text-brand-500" />
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

      {step === 2 && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-50 px-3 py-2 dark:bg-zinc-800/40">
            <div className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300">
              <MapPinIcon className="h-3.5 w-3.5 text-brand-500" />
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
              className="text-xs font-semibold text-brand-600 hover:underline disabled:opacity-50 dark:text-brand-400"
            >
              {loading ? "ກຳລັງໂຫຼດ..." : "↻ ໂຫຼດຄືນ"}
            </button>
          </div>

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
                    <PlusIcon className="h-4 w-4 shrink-0 text-brand-500" />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{h.item_code}</div>
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
                      d === null || d === 0 ? "text-zinc-400" : d > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
                    return (
                      <tr key={i.item_code} className="align-middle transition hover:bg-zinc-50/60 dark:hover:bg-zinc-800/30">
                        <td className="px-4 py-2.5">
                          <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{i.item_code}</div>
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
                                className="inline-flex items-center gap-1.5 rounded-lg bg-aqua-50 px-3 py-1.5 text-xs font-semibold text-aqua-700 ring-1 ring-aqua-200 transition hover:bg-aqua-100 dark:bg-aqua-950/40 dark:text-aqua-300 dark:ring-aqua-900/50"
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
                                className="w-24 rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm font-semibold tabular-nums ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-950 dark:ring-zinc-800"
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
                          <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">{i.item_code}</div>
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

      <Toast toast={toast} />
    </div>
  );
}

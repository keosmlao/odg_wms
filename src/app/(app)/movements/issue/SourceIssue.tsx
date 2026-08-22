"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  LayersIcon,
  ListIcon,
  PackageIcon,
  SearchIcon,
  UserIcon,
  ChevronRightIcon,
  MapPinIcon,
} from "@/components/ui/Icons";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";
import TripIssue from "./TripIssue";
import { useBinNames } from "@/components/useBinNames";
import { nodeName } from "@/lib/locationLabel";

const PhoneIcon = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

export type WarehouseOption = { code: string; name: string | null };

type SourceType = "req" | "transfer" | "sale";
/** ແທັບ "ໃບຈັດຖ້ຽວ" ດຶງຖ້ຽວຂອງຂົນສົ່ງ (TMS) ມາເປັນຕົ້ນທາງ ແທນເອກະສານ ERP ໃບດຽວ. */
type SourceTab = SourceType | "trip";

const SOURCE_TYPES: { key: SourceTab; label: string; hint: string }[] = [
  { key: "sale", label: "ບິນຂາຍ", hint: "ບິນຂາຍ (44)" },
  { key: "req", label: "ໃບຂໍເປີກ", hint: "ຂໍເປີກສິນຄ້າ (122)" },
  { key: "transfer", label: "ໃບຂໍໂອນ", hint: "ຂໍໂອນສິນຄ້າ (124)" },
  { key: "trip", label: "ໃບຈັດຖ້ຽວ", hint: "ດຶງໃບຈັດຖ້ຽວຂອງຂົນສົ່ງ (1 ຖ້ຽວ = ຫຼາຍບິນ) ມາເຮັດໃບສັ່ງຈ່າຍ" },
];

type PendingLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  remaining: string;
};
type PendingDoc = {
  doc_no: string;
  wh_code: string;
  doc_date: string | null;
  doc_time: string | null;
  cust_code: string | null;
  cust_name: string | null;
  remark: string | null;
  line_count: number;
  remaining_qty: string;
  pending_qty: string | null; // ຢູ່ໃນໃບ pick ຄ້າງຢືນຢັນ (ຫັກອອກຈາກ remaining_qty ແລ້ວ)
  aging_days: number | null;
  want_date: string | null;
  created_at: string | null;
  lines: PendingLine[];
};

type LocOpt = {
  rack: string;
  location: string;
  pallet: string;
  qty: string;
  first_in?: string | null;
  /** In-stock serials at this node. null = item not serialized (not applicable). */
  sn_qty?: number | null;
};

/** stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ຂອງສິນຄ້ານີ້ໃນສາງນີ້. wh_qty = ຄົງເຫຼືອ**ລວມທັງສາງ**. */
type MinStock = { min_qty: number; max_qty: number | null; wh_qty: number };

type SourceLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  is_isn: number | null;
  src_qty: string;
  issued_qty: string;
  pending_qty: string;
  remaining: string;
  locations: LocOpt[];
  min_stock?: MinStock | null;
};

/** An open (unconfirmed) pick slip already raised against the same source doc.
 *  Its qty is netted out of every line's `remaining`, so it has to be shown —
 *  otherwise the default allocation just looks short of what the doc ordered. */
type PendingPick = { doc_no: string; doc_date: string | null; qty: string; remark: string | null };

type SerialOption = { sn: string; isn: string | null; rack: string | null; location: string | null; pallet: string | null; received?: string | null; days?: number | null };

type WorkingLine = {
  key: string; // unique per allocation row (an item may split across locations)
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  remaining: number;
  srcQty: number;
  issuedQty: number; // already issued out of WMS for this source doc
  pendingQty: number; // parked on an open pick slip for this source doc
  serialized: boolean;
  locations: LocOpt[];
  selIdx: number; // index into locations, -1 = none
  qty: string;
  serialsLoaded: boolean;
  availableSerials: SerialOption[];
  selectedSerials: string[];
  /** null = ສາງບໍ່ໄດ້ເປີດຄຸມ ຫຼື ສິນຄ້ານີ້ບໍ່ໄດ້ຕັ້ງ min/max */
  minStock: MinStock | null;
};

/** Live elapsed counter since the doc creation datetime — same look as the receive
 *  list's Countdown: red bold "ກາຍກຳນົດ N ມື້ HH:MM:SS", ticks every second. */
function Elapsed({ since }: { since: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const start = new Date(since.replace(" ", "T")).getTime();
  if (now === null || !Number.isFinite(start)) return null;
  const ms = Math.max(0, now - start);
  const days = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="inline-flex items-center gap-1 font-bold tabular-nums text-red-600 dark:text-red-400">
      <CalendarIcon className="h-3 w-3" />ຄ້າງຈ່າຍ {days > 0 ? `${days} ມື້ ` : ""}{p(h)}:{p(m)}:{p(s)}
    </span>
  );
}

/** ISO date string (YYYY-MM-DD) → dd-MM-yyyy for display. */
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
function formatQty(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function parsedQty(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
function nodeQty(line: WorkingLine): number {
  const loc = line.locations[line.selIdx];
  return loc ? Number.parseFloat(loc.qty) || 0 : 0;
}
function lineCap(line: WorkingLine): number {
  // Issue qty can't exceed what's remaining on the source, nor the chosen node's WMS stock.
  return Math.min(line.remaining, nodeQty(line));
}
function issueQty(line: WorkingLine, pickRequiresSn = true): number {
  // Serial line WITH pick-time SN required → issue = how many ISN were selected.
  // Serial line with SN deferred to confirm → issue = the entered target qty.
  if (line.serialized) return pickRequiresSn ? line.selectedSerials.length : (parsedQty(line.qty) ?? 0);
  return parsedQty(line.qty) ?? 0;
}
/** Target qty for a serial line (how many ISN to pick) = entered qty, capped at
 *  the remaining. Drives the ISN-picker selection cap. */
function targetQty(line: WorkingLine): number {
  const t = parsedQty(line.qty);
  const target = t != null && t > 0 ? t : line.remaining;
  return Math.min(Math.round(target), Math.round(line.remaining));
}

/** ເຕືອນ stock ຂັ້ນຕ່ຳ: ຄົງເຫຼືອທັງສາງ − ຈຳນວນທີ່ກຳລັງຈະຈ່າຍ ທຽບກັບຂັ້ນຕ່ຳ.
 *  ເປັນການ**ເຕືອນ** ບໍ່ແມ່ນການກີດ — ບາງເທື່ອກໍຕ້ອງຈ່າຍລົງຕ່ຳກວ່າຂັ້ນຕ່ຳຢູ່ດີ. */
function MinStockWarning({ ms, issuing, unit }: { ms: MinStock; issuing: number; unit: string | null }) {
  const after = Math.round((ms.wh_qty - issuing) * 10000) / 10000;
  const already = ms.wh_qty < ms.min_qty - 1e-9;
  const willBreach = after < ms.min_qty - 1e-9;
  const u = unit ? ` ${unit}` : "";
  const detail = `ຄົງເຫຼືອທັງສາງ ${formatQty(ms.wh_qty)}${u} · ຫຼັງຈ່າຍ ${formatQty(after)}${u} · ຂັ້ນຕ່ຳ ${formatQty(ms.min_qty)}${u}`;
  if (!willBreach) {
    return (
      <div className="mt-1 text-[10px] font-bold text-zinc-400" title={detail}>
        ຂັ້ນຕ່ຳ {formatQty(ms.min_qty)}{ms.max_qty !== null ? ` · ຂັ້ນສູງ ${formatQty(ms.max_qty)}` : ""} · ຫຼັງຈ່າຍເຫຼືອ {formatQty(after)}
      </div>
    );
  }
  return (
    <div
      title={detail}
      className="mt-1 inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50"
    >
      ⚠ {already ? "ຕ່ຳກວ່າຂັ້ນຕ່ຳຢູ່ແລ້ວ" : "ຈ່າຍແລ້ວຈະຕ່ຳກວ່າຂັ້ນຕ່ຳ"} — ຫຼັງຈ່າຍເຫຼືອ {formatQty(after)} / ຂັ້ນຕ່ຳ {formatQty(ms.min_qty)}
    </div>
  );
}

function parseAndCleanRemark(remark: string | null) {
  if (!remark) return { title: "", customer: "", address: "", phone: "" };
  
  let cleanStr = remark;
  const addressRegex = /\(ລາຍລະອຽດທີ່ຢູ່ຈັດສົ່ງ:\s*([\s\S]*?)\s*ເບີໂທ:\s*([\s\S]*?)\)/g;
  const matches = [...cleanStr.matchAll(addressRegex)];
  
  let rawAddress = "";
  let rawPhone = "";
  
  if (matches.length > 0) {
    const validMatch = matches.find(m => {
      const addr = m[1].trim();
      const ph = m[2].trim();
      return (addr && !addr.startsWith("None")) || (ph && !ph.startsWith("None"));
    }) || matches[0];
    
    rawAddress = validMatch[1].trim();
    rawPhone = validMatch[2].trim();
    cleanStr = cleanStr.replace(/\(ລາຍລະອຽດທີ່ຢູ່ຈັດສົ່ງ:\s*[\s\S]*?\)/g, "").trim();
  }
  
  let cleanAddress = "";
  if (rawAddress && !rawAddress.startsWith("None")) {
    const parts = rawAddress.split(",").map(p => p.trim()).filter(Boolean);
    cleanAddress = parts.join(", ");
  }
  
  let cleanPhone = "";
  if (rawPhone && !rawPhone.startsWith("None") && rawPhone.trim() !== "") {
    cleanPhone = rawPhone.trim();
  }
  
  let customer = "";
  const custRegex = /ລູກຄ້າ:\s*([\s\S]*?)(?:$|\s)/;
  const custMatch = cleanStr.match(custRegex);
  if (custMatch) {
    customer = custMatch[1].trim();
    cleanStr = cleanStr.replace(/ລູກຄ້າ:\s*[\s\S]*?$/, "").trim();
  }
  
  let title = cleanStr.trim();
  if (customer) {
    customer = customer.replace(/^[,\s]+|[,\s]+$/g, "");
  }
  
  return {
    title: title || "—",
    customer,
    address: cleanAddress,
    phone: cleanPhone
  };
}

export default function SourceIssue({ warehouses }: { warehouses: WarehouseOption[] }) {
  // ບໍ່ມີການ "ເລືອກສາງ" ອີກແລ້ວ — ລາຍການຄ້າງຈ່າຍໂຫຼດມາທຸກສາງທີ່ມີສິດ ແລ້ວແຍກກຸ່ມຕາມສາງ.
  // `whCode` ຈຶ່ງເປັນສາງ "ຂອງໃບທີ່ກຳລັງເຮັດຢູ່" ເທົ່ານັ້ນ (ຕັ້ງຕອນເປີດໃບ).
  const [whCode, setWhCode] = useState("");
  const [tab, setTab] = useState<SourceTab>("sale");
  // ແທັບຖ້ຽວໃຊ້ຕົວອ່ານຂອງມັນເອງ; ສ່ວນ type ຍັງເປັນປະເພດເອກະສານ ERP ຄືເກົ່າ.
  const type: SourceType = tab === "trip" ? "sale" : tab;

  const [search, setSearch] = useState("");
  const [docs, setDocs] = useState<PendingDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);

  const [selDoc, setSelDoc] = useState<PendingDoc | null>(null);
  const [lines, setLines] = useState<WorkingLine[]>([]);
  const [pendingPicks, setPendingPicks] = useState<PendingPick[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  const [serialPickerFor, setSerialPickerFor] = useState<string | null>(null);
  const [serialSearch, setSerialSearch] = useState("");
  const serialScanRef = useRef<HTMLInputElement>(null);
  const [reloadKey, setReloadKey] = useState(0); // bump → re-fetch pending (after issue)
  const [removed, setRemoved] = useState<Set<string>>(new Set()); // lines excluded from this issue
  const allocSeq = useRef(0); // unique key counter for added allocation rows
  const [submitting, setSubmitting] = useState(false);
  const [lastIssued, setLastIssued] = useState<string | null>(null); // last DP doc → print banner
  const [gscan, setGscan] = useState(""); // global SN scan box
  const gscanRef = useRef<HTMLInputElement>(null);
  const [assignee, setAssignee] = useState(""); // ມອບໝາຍໃຫ້ forklift/ຄົນເກັບ → wms_product_out.remark
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Per-warehouse SN policy (settings → ສາງ → SN ຕໍ່ເມນູ):
  //  · snIssueOn      ("ຈ່າຍ")      → serials tracked in the issue flow at all.
  //  · snPickRequired ("ຈ່າຍ: pick") → the pick slip must pre-select serials; when
  //    off, the pick is location+qty only and SN is scanned at confirm instead.
  const [snIssueOn, setSnIssueOn] = useState(true);
  const [snPickRequired, setSnPickRequired] = useState(true);

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const whName = useMemo(() => warehouses.find((w) => w.code === whCode)?.name ?? null, [warehouses, whCode]);
  /** ຊື່ຊັ້ນວາງ/ບ່ອນເກັບ ຂອງສາງທີ່ກຳລັງເຮັດໃບຢູ່ — ສະແດງແທນລະຫັດຕອນເລືອກບ່ອນຢິບ. */
  const binNames = useBinNames(whCode);
  const docGroups = useMemo(() => groupByWarehouse(docs, (d) => d.wh_code, warehouses), [docs, warehouses]);

  /** ນະໂຍບາຍ SN ແມ່ນ "ຕໍ່ສາງ" — ໂຫຼດຕອນເປີດໃບ (ສາງມາຈາກໃບ, ບໍ່ແມ່ນຈາກ dropdown ອີກ). */
  const loadSnFlags = useCallback(async (wh: string) => {
    try {
      const res = await fetch(`/api/movements/warehouse-sn-flags?wh=${encodeURIComponent(wh)}`);
      const data = (await res.json()) as { flags?: { issue?: boolean; issue_pick?: boolean } };
      const issueOn = data.flags?.issue !== false;
      return { issueOn, pickRequired: issueOn && data.flags?.issue_pick !== false };
    } catch {
      return { issueOn: true, pickRequired: true };
    }
  }, []);

  // Deep-link from the transfer dashboard (?type=&doc=) → auto-open that doc.
  // ບໍ່ຕ້ອງອ່ານ `wh` ອີກແລ້ວ — ສາງມາຈາກຕົວໃບເອງຕອນເປີດ.
  const searchParams = useSearchParams();
  const autoOpenRef = useRef<string | null>(null);
  useEffect(() => {
    const pType = searchParams.get("type");
    const pDoc = searchParams.get("doc");
    if (pType === "req" || pType === "transfer" || pType === "sale" || pType === "trip") setTab(pType);
    if (pDoc) autoOpenRef.current = pDoc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load pending source documents across every accessible warehouse (debounced).
  useEffect(() => {
    if (tab === "trip") {
      setDocs([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingDocs(true);
      try {
        const params = new URLSearchParams({ type });
        if (search.trim()) params.set("q", search.trim());
        const res = await fetch(`/api/movements/issue/pending?${params}`);
        const data = (await res.json()) as { docs?: PendingDoc[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
        setDocs(data.docs ?? []);
      } catch (err) {
        if (!cancelled) showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoadingDocs(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [tab, type, search, reloadKey, showToast]);

  /** Build allocation rows for one source line. If the needed qty exceeds the
   *  recommended (FIFO) location's stock, AUTO-SPLIT across the next locations
   *  until the full qty is covered — no manual "+ location" needed.
   *
   *  For a serialized item on a warehouse that requires ISN on the pick slip, a
   *  node whose WMS balance is not backed by serials cannot actually be picked
   *  from, so those nodes are tried LAST (still tried, so the defaulted total
   *  never comes up short — an uncoverable row is then flagged as incomplete). */
  function buildAllocations(l: SourceLine, pickNeedsSn: boolean): WorkingLine[] {
    const remaining = Number.parseFloat(l.remaining) || 0;
    const serialized = (l.is_isn ?? 0) === 1;
    const base: WorkingLine = {
      key: l.item_code,
      item_code: l.item_code,
      item_name: l.item_name,
      unit_code: l.unit_code,
      remaining,
      srcQty: Number.parseFloat(l.src_qty) || 0,
      issuedQty: Number.parseFloat(l.issued_qty) || 0,
      pendingQty: Number.parseFloat(l.pending_qty) || 0,
      serialized,
      locations: l.locations,
      selIdx: -1,
      qty: "",
      serialsLoaded: false,
      availableSerials: [],
      selectedSerials: [],
      minStock: l.min_stock ?? null,
    };
    if (l.locations.length === 0) return [{ ...base, key: `${l.item_code}#a0` }];

    // Try serial-backed nodes first when the pick slip must carry ISN; the
    // dropdown itself stays in FIFO order, only the auto-fill order changes.
    const needsSn = serialized && pickNeedsSn;
    const order = l.locations.map((_, i) => i);
    if (needsSn) {
      const covered = (i: number) => (l.locations[i].sn_qty ?? 0) > 0;
      order.sort((a, b) => Number(covered(b)) - Number(covered(a)));
    }

    const allocs: WorkingLine[] = [];
    let need = Math.round(remaining);
    for (const i of order) {
      if (need <= 0) break;
      const loc = l.locations[i];
      let locStock = Math.floor(Number.parseFloat(loc.qty) || 0);
      // An ISN-required pick can only take as many units as there are serials.
      if (needsSn && (loc.sn_qty ?? 0) > 0) locStock = Math.min(locStock, loc.sn_qty ?? 0);
      if (locStock <= 0) continue;
      const take = Math.min(need, locStock);
      allocs.push({ ...base, key: `${l.item_code}#a${i}`, selIdx: i, qty: String(take) });
      need -= take;
    }
    // Keep the rows in dropdown (FIFO) order regardless of the fill order.
    allocs.sort((a, b) => a.selIdx - b.selIdx);
    // Nothing allocatable (all locations zero) → one empty row on the first loc.
    if (allocs.length === 0) allocs.push({ ...base, key: `${l.item_code}#a0`, selIdx: 0, qty: "" });
    return allocs;
  }

  async function openDoc(doc: PendingDoc) {
    setLoadingLines(true);
    setSelDoc(doc);
    setWhCode(doc.wh_code);
    setLastIssued(null);
    setRemoved(new Set());
    try {
      // ນະໂຍບາຍ SN ຂອງສາງໃບນີ້ ຕ້ອງຮູ້ກ່ອນຈັດສັນແຖວ (ມັນກຳນົດລຳດັບ node ທີ່ມີ serial).
      const flags = await loadSnFlags(doc.wh_code);
      setSnIssueOn(flags.issueOn);
      setSnPickRequired(flags.pickRequired);
      const params = new URLSearchParams({ doc: doc.doc_no, type, wh: doc.wh_code });
      const res = await fetch(`/api/movements/issue/source?${params}`);
      const data = (await res.json()) as { lines?: SourceLine[]; pending_docs?: PendingPick[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const built = (data.lines ?? []).flatMap((l) => buildAllocations(l, flags.pickRequired));
      setLines(built);
      setPendingPicks(data.pending_docs ?? []);
      // Eager-load serials for serialized lines so the global SN scan can match.
      for (const l of built) if (l.serialized && l.selIdx >= 0) void loadSerials(l, doc.wh_code);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      setSelDoc(null);
      setPendingPicks([]);
    } finally {
      setLoadingLines(false);
    }
  }

  // Auto-open the deep-linked doc once its pending list has loaded.
  useEffect(() => {
    if (!autoOpenRef.current || selDoc) return;
    const target = docs.find((d) => d.doc_no === autoOpenRef.current);
    if (target) { autoOpenRef.current = null; void openDoc(target); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, selDoc]);

  function updateLine(key: string, patch: Partial<WorkingLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function setLocation(key: string, idx: number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const next: WorkingLine = { ...l, selIdx: idx, selectedSerials: [], serialsLoaded: false, availableSerials: [] };
        return next;
      }),
    );
  }

  function setQty(key: string, value: string) {
    updateLine(key, { qty: value });
  }

  /** Split a line across locations: keep what the chosen location can cover here,
   *  move the rest to a new row (a different location) — repeat until complete. */
  function splitLine(key: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx < 0) return prev;
      const l = prev[idx];
      const loc = l.locations[l.selIdx];
      const locStock = loc ? Math.floor(Number.parseFloat(loc.qty) || 0) : 0;
      const total = Math.round(parsedQty(l.qty) ?? 0);
      const here = Math.min(total, locStock);
      const rest = total - here;
      if (rest <= 0) { showToast("err", "ບ່ອນນີ້ ພໍແລ້ວ — ບໍ່ຕ້ອງແຍກ"); return prev; }
      const usedIdx = new Set(prev.filter((x) => x.item_code === l.item_code).map((x) => x.selIdx));
      const newIdx = l.locations.findIndex((_, i) => !usedIdx.has(i));
      const updated: WorkingLine = { ...l, qty: String(here), selectedSerials: l.selectedSerials.slice(0, here) };
      const fresh: WorkingLine = { ...l, key: `${l.item_code}#${l.locations.length}-${prev.length}-${Math.round(total)}`, qty: String(rest), selIdx: newIdx, selectedSerials: [], serialsLoaded: false, availableSerials: [] };
      const next = [...prev]; next[idx] = updated; next.splice(idx + 1, 0, fresh);
      return next;
    });
  }

  /** `wh` ຮັບເຂົ້າມາໄດ້ ເພາະຕອນ openDoc ຄ່າ state `whCode` ຍັງບໍ່ທັນອັບເດດ. */
  async function loadSerials(line: WorkingLine, wh?: string) {
    const loc = line.locations[line.selIdx];
    const params = new URLSearchParams({ warehouse: wh ?? whCode, item: line.item_code });
    if (loc) {
      params.set("rack", loc.rack);
      params.set("location", loc.location);
      params.set("pallet", loc.pallet);
    }
    const res = await fetch(`/api/movements/item-serials?${params}`);
    const data = (await res.json()) as { serials?: SerialOption[] };
    const serials = data.serials ?? [];
    updateLine(line.key, { availableSerials: serials, serialsLoaded: true });
    return serials;
  }

  async function openSerialPicker(key: string) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    if (line.selIdx < 0) {
      showToast("err", "ກະລຸນາເລືອກບ່ອນຈັດເກັບກ່ອນ");
      return;
    }
    if (!line.serialsLoaded) {
      const serials = await loadSerials(line);
      if (serials.length === 0) {
        showToast("err", "ບໍ່ພົບ serial ຄົງເຫຼືອຢູ່ບ່ອນຈັດເກັບນີ້");
        return;
      }
    }
    setSerialSearch("");
    setSerialPickerFor(key);
  }

  /** Auto-select the lowest-ISN serials up to the target qty (FIFO by ISN number). */
  function selectFifo(key: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const target = targetQty(l);
        if (target <= 0) { showToast("err", "ໃສ່ຈຳນວນກ່ອນ"); return l; }
        const sorted = [...l.availableSerials].sort((a, b) => (a.isn ?? a.sn).localeCompare(b.isn ?? b.sn));
        const pick = sorted.slice(0, target).map((s) => s.sn);
        return { ...l, selectedSerials: pick };
      }),
    );
  }

  /** Select all serials at this location, but NEVER beyond the target qty. */
  function selectAll(key: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const cap = targetQty(l);
        if (cap <= 0) { showToast("err", "ໃສ່ຈຳນວນກ່ອນ"); return l; }
        if (l.availableSerials.length === 0) { showToast("err", "ບໍ່ມີ serial ໃນບ່ອນນີ້"); return l; }
        return { ...l, selectedSerials: l.availableSerials.slice(0, cap).map((s) => s.sn) };
      }),
    );
  }

  function toggleSerial(key: string, sn: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const has = l.selectedSerials.includes(sn);
        if (has) return { ...l, selectedSerials: l.selectedSerials.filter((s) => s !== sn) };
        if (l.selectedSerials.length >= targetQty(l)) return l; // can't exceed the entered qty
        return { ...l, selectedSerials: [...l.selectedSerials, sn] };
      }),
    );
  }

  // Serial line: the qty input sets the TARGET (how many ISN to pick), capped at
  // the remaining. It does not auto-pick — you then choose the ISN in the picker.
  function setSerialQty(key: string, value: string) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const raw = value.trim();
    const n = Math.max(0, Math.floor(Number.parseFloat(raw) || 0));
    const cap = Math.min(n, Math.round(line.remaining));
    const trimmed = line.selectedSerials.slice(0, cap);
    updateLine(key, { qty: raw === "" ? "" : String(cap), selectedSerials: trimmed });
  }

  // Lines shown in the wizard (not removed) vs the ones the user pulled out.
  const shownLines = useMemo(() => lines.filter((l) => !removed.has(l.key)), [lines, removed]);
  const removedLines = useMemo(() => lines.filter((l) => removed.has(l.key)), [lines, removed]);
  const readyLines = useMemo(() => shownLines.filter((l) => issueQty(l, snPickRequired) > 0 && l.selIdx >= 0), [shownLines, snPickRequired]);
  const invalid = useMemo(
    () => shownLines.find((l) => issueQty(l, snPickRequired) > 0 && issueQty(l, snPickRequired) > lineCap(l) + 1e-6),
    [shownLines, snPickRequired],
  );

  const qNum = (l: WorkingLine) => parsedQty(l.qty) ?? 0;
  const activeLines = useMemo(() => shownLines.filter((l) => qNum(l) > 0), [shownLines]);

  // Group allocation rows by item for the per-item card view.
  const itemGroups = useMemo(() => {
    const m = new Map<string, WorkingLine[]>();
    for (const l of shownLines) { const a = m.get(l.item_code); if (a) a.push(l); else m.set(l.item_code, [l]); }
    return [...m.entries()].map(([item_code, allocs]) => ({ item_code, allocs, line: allocs[0] }));
  }, [shownLines]);
  const allocatedFor = (item: string) => shownLines.filter((l) => l.item_code === item).reduce((s, l) => s + issueQty(l, snPickRequired), 0);
  const neededFor = (item: string) => itemGroups.find((g) => g.item_code === item)?.line.remaining ?? 0;
  /** An allocation row is incomplete if it has a qty target but is missing a
   *  location or (for serial) the full ISN set. */
  const incompleteAlloc = (l: WorkingLine) => qNum(l) > 0 && (l.selIdx < 0 || (l.serialized && snPickRequired && l.selectedSerials.length < targetQty(l)));

  // Add / remove an allocation row for an item (split across locations).
  function addAlloc(item: string) {
    setLines((prev) => {
      const base = prev.find((l) => l.item_code === item);
      if (!base) return prev;
      const used = new Set(prev.filter((x) => x.item_code === item).map((x) => x.selIdx));
      const newIdx = base.locations.findIndex((_, i) => !used.has(i));
      const needed = Math.round(base.remaining);
      const allocated = prev.filter((x) => x.item_code === item).reduce((s, x) => s + (parsedQty(x.qty) ?? 0), 0);
      const rest = Math.max(0, needed - allocated);
      const locStock = newIdx >= 0 ? Math.floor(Number.parseFloat(base.locations[newIdx].qty) || 0) : 0;
      allocSeq.current += 1;
      const fresh: WorkingLine = { ...base, key: `${item}#${allocSeq.current}`, qty: newIdx >= 0 ? String(Math.min(rest, locStock)) : "", selIdx: newIdx, selectedSerials: [], serialsLoaded: false, availableSerials: [] };
      const lastIdx = prev.map((l) => l.item_code).lastIndexOf(item);
      const next = [...prev]; next.splice(lastIdx + 1, 0, fresh); return next;
    });
  }
  function removeAlloc(key: string) {
    setLines((prev) => {
      const l = prev.find((x) => x.key === key);
      if (!l || prev.filter((x) => x.item_code === l.item_code).length <= 1) return prev; // keep ≥1
      return prev.filter((x) => x.key !== key);
    });
  }

  const canStep3 = activeLines.length > 0 && !shownLines.some(incompleteAlloc); // all started allocs complete
  const canCreate = canStep3 && readyLines.length > 0;

  function resetToList() {
    setSelDoc(null);
    setLines([]);
    setPendingPicks([]);
    setRemoved(new Set());
    setAssignee("");
    setReloadKey((k) => k + 1); // refresh pending so partial-issued docs show reduced remaining
  }

  /** Global SN scan (single-screen): match a scanned SN/ISN to a serialized line
   *  (serials eager-loaded at its FEFO location) and select it, bumping the qty. */
  function handleGlobalScan() {
    const term = gscan.trim();
    if (!term) return;
    const t = term.toUpperCase();
    for (const l of shownLines) {
      if (!l.serialized) continue;
      const m = l.availableSerials.find((s) => s.sn.toUpperCase() === t || (s.isn ?? "").toUpperCase() === t);
      if (!m) continue;
      if (l.selectedSerials.includes(m.sn)) { showToast("err", `${term} ເລືອກໄປແລ້ວ`); setGscan(""); return; }
      const cap = Math.round(l.remaining);
      if (l.selectedSerials.length >= cap) { showToast("err", `${l.item_code}: ຄົບຈຳນວນແລ້ວ`); setGscan(""); return; }
      setLines((prev) => prev.map((x) => x.key === l.key ? { ...x, qty: String(x.selectedSerials.length + 1), selectedSerials: [...x.selectedSerials, m.sn] } : x));
      showToast("ok", `✓ ${m.isn ?? m.sn} → ${l.item_code}`);
      setGscan(""); setTimeout(() => gscanRef.current?.focus(), 30);
      return;
    }
    showToast("err", `ບໍ່ພົບ SN "${term}" — ກົດ "ISN" ຂອງສິນຄ້ານັ້ນເພື່ອເລືອກ`);
    setGscan("");
  }

  async function submit() {
    if (!selDoc) return;
    if (readyLines.length === 0) {
      showToast("err", "ກະລຸນາໃສ່ຈຳນວນຈ່າຍ");
      return;
    }
    if (shownLines.some(incompleteAlloc)) {
      showToast("err", "ບາງລາຍການຍັງບໍ່ຄົບ (location ຫຼື ISN)");
      return;
    }
    if (invalid) {
      showToast("err", `ສິນຄ້າ ${invalid.item_code}: ຈ່າຍເກີນຄ້າງ ຫຼື ເກີນຄົງເຫຼືອ`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wh_code: whCode,
          doc_ref: selDoc.doc_no,
          source_type: type,
          remark: assignee.trim() || null,
          lines: readyLines.map((l) => {
            const loc = l.locations[l.selIdx];
            return {
              item_code: l.item_code,
              item_name: l.item_name,
              unit_code: l.unit_code,
              qty: issueQty(l, snPickRequired),
              serials: l.serialized && snIssueOn ? l.selectedSerials : [],
              rack: loc?.rack ?? "",
              location: loc?.location ?? "",
              pallet: loc?.pallet ?? "",
            };
          }),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; pending_code?: string; lines?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ສ້າງໃບ pick ${data.pending_code} ສຳເລັດ — ພິມໃຫ້ forklift`);
      setLastIssued(data.pending_code ?? null);
      resetToList();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";
  const primaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  const pickerLine = serialPickerFor ? lines.find((l) => l.key === serialPickerFor) : null;
  const filteredSerials = useMemo(() => {
    if (!pickerLine) return [];
    if (!serialSearch.trim()) return pickerLine.availableSerials;
    const term = serialSearch.trim().toLowerCase();
    return pickerLine.availableSerials.filter(
      (s) => s.sn.toLowerCase().includes(term) || (s.isn && s.isn.toLowerCase().includes(term))
    );
  }, [pickerLine, serialSearch]);

  // Scanner: type / scan a SN or ISN then Enter → add it to the selection.
  function handleSerialScan() {
    if (!pickerLine) return;
    const term = serialSearch.trim();
    if (!term) return;
    const t = term.toUpperCase();
    const match = pickerLine.availableSerials.find(
      (s) => s.sn.toUpperCase() === t || (s.isn ?? "").toUpperCase() === t,
    );
    if (!match) {
      // fall back to a single filtered hit (partial scan) before giving up
      const one = filteredSerials.length === 1 ? filteredSerials[0] : null;
      if (!one) { showToast("err", `ບໍ່ພົບ serial "${term}" ໃນບ່ອນນີ້`); return; }
      addSerialByScan(one.sn, one.isn ?? one.sn);
      return;
    }
    addSerialByScan(match.sn, match.isn ?? match.sn);
  }
  function addSerialByScan(sn: string, label: string) {
    if (!pickerLine) return;
    if (pickerLine.selectedSerials.includes(sn)) showToast("err", `${label} ເລືອກແລ້ວ`);
    else if (pickerLine.selectedSerials.length >= targetQty(pickerLine)) showToast("err", "ເລືອກຄົບ ຕາມທີ່ຂໍແລ້ວ");
    else { toggleSerial(pickerLine.key, sn); showToast("ok", `+ ${label}`); }
    setSerialSearch("");
    setTimeout(() => serialScanRef.current?.focus(), 30);
  }

  return (
    <div className="space-y-6">
      {/* Success banner after a direct issue */}
      {lastIssued && !selDoc && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">✓ ສ້າງໃບ pick ສຳເລັດ · {lastIssued}</span>
          <div className="flex items-center gap-2">
            <a href={`/print/pick/${encodeURIComponent(lastIssued)}?auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">🖨 ພິມໃບ pick (forklift)</a>
            <a href="/movements/issue?tab=pending" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">② ໄປຢືນຢັນຈ່າຍ →</a>
          </div>
        </div>
      )}

      {/* STEP 1 — pick source document */}
      {!selDoc && (
        <div className="space-y-4">
          {/* Header Row: ຂອບເຂດສາງ (ອ່ານຢ່າງດຽວ) + Document Type Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex h-11 items-center gap-2 rounded-xl bg-zinc-50/60 px-3.5 text-sm font-bold text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-950/60 dark:text-zinc-200 dark:ring-zinc-800">
              <BuildingIcon className="h-4.5 w-4.5 text-zinc-400 dark:text-zinc-500" />
              ທຸກສາງ
              <span className="rounded-full bg-zinc-200/70 px-2 py-0.5 text-[10px] font-black text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {warehouses.length}
              </span>
            </div>

            {/* Document Type Tabs */}
            <div className="inline-flex h-11 items-center rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/60">
              {SOURCE_TYPES.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    title={t.hint}
                    className={`flex-1 lg:flex-none lg:w-28 h-full rounded-lg text-xs font-extrabold transition-all duration-305 flex items-center justify-center ${
                      active
                        ? "bg-gradient-to-r from-red-500 to-orange-600 text-white shadow-md shadow-red-500/20 scale-100"
                        : "text-zinc-650 hover:text-zinc-955 dark:text-zinc-400 dark:hover:text-zinc-100 hover:bg-white/45 dark:hover:bg-zinc-700/30 active:scale-95"
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {tab === "trip" ? (
            /* ໃບຈັດຖ້ຽວຂອງຂົນສົ່ງ → ໃບສັ່ງຈ່າຍ (1 ຖ້ຽວ = ຫຼາຍບິນ) */
            <TripIssue warehouses={warehouses} />
          ) : (
            <>
          {/* Search Bar */}
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ສະແກນ / ພິມ ເລກເອກະສານ ຫຼື ສິນຄ້າ..."
              className="w-full rounded-xl bg-zinc-50/50 dark:bg-zinc-950/40 pl-11 pr-11 py-3.5 text-sm text-zinc-900 dark:text-zinc-100 ring-1 ring-zinc-250 dark:ring-zinc-800 outline-none transition-all duration-300 hover:ring-zinc-300 focus:ring-2 focus:ring-red-500/30 focus:border-red-500 focus:bg-white dark:focus:bg-zinc-950 focus:shadow-lg focus:shadow-red-500/5 disabled:opacity-60"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 dark:text-zinc-500 transition-colors"
              >
                ✕
              </button>
            )}
          </div>

          {/* Documents List */}
          <div>
            {loadingDocs ? (
              <div className="py-16 text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
                <p className="mt-4 text-sm font-semibold text-zinc-550 dark:text-zinc-450">ກຳລັງໂຫຼດເອກະສານ...</p>
              </div>
            ) : docs.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800/80 bg-zinc-50/20 dark:bg-zinc-950/10">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-850 dark:text-zinc-500 ring-1 ring-zinc-200/50 dark:ring-zinc-800/50">
                  <ListIcon className="h-6 w-6" />
                </div>
                <p className="mt-4 text-sm font-bold text-zinc-500 dark:text-zinc-400">ບໍ່ມີເອກະສານຄ້າງ{SOURCE_TYPES.find((t) => t.key === type)?.label}</p>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">ບໍ່ພົບເອກະສານທີ່ຍັງຄ້າງໃນທຸກສາງທີ່ທ່ານມີສິດ ຫຼື ຂໍ້ມູນຄົ້ນຫາບໍ່ຖືກຕ້ອງ</p>
              </div>
            ) : (
              <div className="space-y-7">
                {docGroups.map((g) => (
                  <WarehouseGroup
                    key={g.code}
                    code={g.code}
                    name={warehouses.find((w) => w.code === g.code)?.name}
                    count={g.rows.length}
                    countLabel="ໃບ"
                    tone="red"
                    right={
                      <span className="font-mono text-xs font-black tabular-nums text-red-600 dark:text-red-400">
                        ຄ້າງເບີກ {formatQty(String(g.rows.reduce((s, d) => s + (Number.parseFloat(d.remaining_qty) || 0), 0)))}
                      </span>
                    }
                  >
                    <div className="space-y-4">
                {g.rows.map((d) => {
                  const cleaned = parseAndCleanRemark(d.remark);
                  const customerDisplay = cleaned.customer || d.cust_name?.trim() || d.cust_code || "—";
                  const today = new Date().toISOString().slice(0, 10);
                  const overdueWant = !!d.want_date && d.want_date < today;
                  const typeLabel = SOURCE_TYPES.find((t) => t.key === type)?.label;
                  let typeBadge = "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
                  if (type === "transfer") typeBadge = "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300";
                  else if (type === "sale") typeBadge = "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
                  return (
                    <details key={`${d.wh_code}-${d.doc_no}`} open={docs.length <= 4} className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 font-mono text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">{d.wh_code.slice(-2)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ຄ້າງຈ່າຍ</span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${typeBadge}`}>{typeLabel}</span>
                            {overdueWant && <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">ກາຍກຳນົດ</span>}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {d.doc_date && <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />ອອກເອກະສານ {fmtDate(d.doc_date)}{d.doc_time ? ` ${d.doc_time.slice(0, 5)}` : ""}</span>}
                            <Elapsed since={d.created_at} />
                            {d.want_date && <span className={`inline-flex items-center gap-1 ${overdueWant ? "font-bold text-red-600 dark:text-red-400" : ""}`}><CalendarIcon className="h-3 w-3" />ຕ້ອງການ {fmtDate(d.want_date)}</span>}
                            <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{customerDisplay}</span>
                            <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{d.wh_code}{warehouses.find((w) => w.code === d.wh_code)?.name ? ` · ${warehouses.find((w) => w.code === d.wh_code)?.name}` : ""}</span>
                            {cleaned.address && <span className="inline-flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{cleaned.address}</span>}
                            {cleaned.phone && <span className="inline-flex items-center gap-1"><PhoneIcon className="h-3 w-3" />{cleaned.phone}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <div className="text-right">
                            <div className="text-[10px] uppercase text-zinc-400">ຄ້າງເບີກ</div>
                            <div className="font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{formatQty(d.remaining_qty)}</div>
                            <div className="text-[10px] text-zinc-400">{d.line_count} ລາຍການ</div>
                            {Number.parseFloat(d.pending_qty ?? "0") > 0 && (
                              <div className="mt-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" title="ຢູ່ໃນໃບ pick ທີ່ຍັງບໍ່ໄດ້ຢືນຢັນ — ຫັກອອກຈາກຄ້າງເບີກແລ້ວ">
                                ໃນໃບ pick {formatQty(d.pending_qty)}
                              </div>
                            )}
                          </div>
                          <button type="button" onClick={(e) => { e.preventDefault(); openDoc(d); }} disabled={loadingLines} className="rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:shadow active:scale-95 disabled:opacity-50 cursor-pointer">ສ້າງໃບຈ່າຍ →</button>
                        </div>
                      </summary>
                      {d.lines.length > 0 && (
                        <div className="border-t border-zinc-100 dark:border-zinc-800">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                                <th className="px-4 py-2">ສິນຄ້າ</th>
                                <th className="px-4 py-2 text-right">ຄ້າງເບີກ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {d.lines.map((l, idx) => (
                                <tr key={`${d.doc_no}-${l.item_code}-${idx}`}>
                                  <td className="px-4 py-2">
                                    <div className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400">{l.item_code}</div>
                                    <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                                  </td>
                                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">{formatQty(l.remaining)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </details>
                  );
                })}
                    </div>
                  </WarehouseGroup>
                ))}
              </div>
            )}
          </div>
            </>
          )}
        </div>
      )}

      {/* STEP 2 — issue lines */}
      {selDoc && (
        <section className="shadow-sm rounded-2xl bg-white border border-zinc-200/50 p-6 dark:bg-zinc-900 dark:border-zinc-800/85">
          {/* Header card with details */}
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-2xl bg-gradient-to-br from-zinc-50 to-zinc-100/50 border border-zinc-200/60 p-5 dark:from-zinc-950/40 dark:to-zinc-950/10 dark:border-zinc-800/80 shadow-inner">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-black text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 px-2.5 py-1 rounded-lg text-sm border border-red-100/60 dark:border-red-900/40">
                  {selDoc.doc_no}
                </span>
                <span className="inline-flex items-center gap-1.5 font-bold text-zinc-550 dark:text-zinc-400">
                  <BuildingIcon className="h-4 w-4 text-zinc-400" />
                  {whCode} {whName ? `· ${whName}` : ""}
                </span>
              </div>
              {/* Clean Customer & Remarks */}
              {(() => {
                const cleaned = parseAndCleanRemark(selDoc.remark);
                const cust = cleaned.customer || selDoc.cust_name?.trim() || selDoc.cust_code;
                return (
                  <div className="space-y-1.5">
                    {cust && (
                      <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
                        👤 {cust}
                      </p>
                    )}
                    {((cleaned.title && cleaned.title !== "—") || cleaned.address || cleaned.phone) && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {cleaned.title && cleaned.title !== "—" && (
                          <span className="inline-flex items-center rounded-md bg-zinc-100 border border-zinc-200/50 px-2 py-0.5 text-[10px] font-medium text-zinc-650 dark:bg-zinc-850 dark:border-zinc-700/50 dark:text-zinc-400">📝 {cleaned.title}</span>
                        )}
                        {cleaned.address && (
                          <span className="inline-flex items-center rounded-md bg-amber-50 border border-amber-100/50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400">📍 {cleaned.address}</span>
                        )}
                        {cleaned.phone && (
                          <span className="inline-flex items-center rounded-md bg-emerald-50 border border-emerald-100/50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/30 dark:text-emerald-400">📞 {cleaned.phone}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <button
              type="button"
              onClick={resetToList}
              className="self-start sm:self-center shrink-0 rounded-xl border border-zinc-250 bg-white px-4 py-2.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 hover:text-red-650 active:scale-95 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-305 dark:hover:bg-zinc-850 dark:hover:text-red-400 transition-all duration-200 shadow-sm cursor-pointer"
            >
              ↩ ປ່ຽນເອກະສານ
            </button>
          </div>

          {/* ໃບ pick ຄ້າງຢືນຢັນ ຂອງເອກະສານນີ້ — ຈຳນວນໃນໃບເຫຼົ່ານີ້ຖືກຫັກອອກຈາກ "ຄ້າງຈ່າຍ"
              ດ້ານລຸ່ມແລ້ວ. ຖ້າບໍ່ບອກ ຜູ້ໃຊ້ຈະເຫັນວ່າ "ລະບົບ default ຈຳນວນຫຼຸດ". */}
          {pendingPicks.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div className="flex items-start gap-2">
                <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-extrabold text-amber-800 dark:text-amber-300">
                    ເອກະສານນີ້ມີໃບ pick ຄ້າງຢືນຢັນຢູ່ແລ້ວ {pendingPicks.length} ໃບ — ຈຳນວນໃນໃບເຫຼົ່ານີ້ຖືກຫັກອອກຈາກ “ຄ້າງຈ່າຍ” ດ້ານລຸ່ມແລ້ວ
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {pendingPicks.map((p) => (
                      <span key={p.doc_no} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200 dark:bg-zinc-900 dark:text-amber-300 dark:ring-amber-900/50">
                        <span className="font-mono">{p.doc_no}</span>
                        <span className="text-amber-500">·</span>
                        <span className="tabular-nums">{formatQty(p.qty)} ໜ່ວຍ</span>
                        {p.doc_date && <><span className="text-amber-500">·</span><span>{fmtDate(p.doc_date)}</span></>}
                        <a href={`/print/pick/${encodeURIComponent(p.doc_no)}?auto=1`} target="_blank" rel="noopener" className="ml-0.5 rounded px-1 hover:bg-amber-100 dark:hover:bg-amber-950/60" title="ພິມໃບ pick">🖨</a>
                      </span>
                    ))}
                    <a href="/movements/issue?tab=pending" className="inline-flex items-center gap-1 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-700">
                      ໄປຢືນຢັນ / ຍົກເລີກ ໃບ pick ຄ້າງ →
                    </a>
                  </div>
                  <div className="mt-1.5 text-[11px] text-amber-700/80 dark:text-amber-400/80">
                    ຢາກຈັດເຕັມຕາມເອກະສານ (ບໍ່ຫັກ) → ໄປຢືນຢັນ ຫຼື ລົບໃບ pick ຄ້າງກ່ອນ ແລ້ວກັບມາໜ້ານີ້ອີກເທື່ອໜຶ່ງ
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ມອບໝາຍ ຜູ້ເກັບ (forklift) — ບັນທຶກລົງໃບ pick */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-zinc-200/70 bg-zinc-50/50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/20">
            <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400">🚜 ມອບໝາຍ ຜູ້ເກັບ:</span>
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ຊື່ forklift / ຄົນເກັບ (ບໍ່ບັງຄັບ)"
              className="min-w-[200px] flex-1 rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500/30 dark:bg-zinc-950 dark:ring-zinc-800" />
          </div>

          {/* Global SN scan — ຍິງ SN ຂອງລາຍການ serial ໃດກໍ່ໄດ້ */}
          {lines.some((l) => l.serialized) && (
            <div className="mb-4 rounded-2xl border border-aqua-200 bg-aqua-50/50 p-3.5 dark:border-aqua-900/40 dark:bg-aqua-950/20">
              {snIssueOn && !snPickRequired && (
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40">
                  ⚙ ສາງນີ້ຕັ້ງ: ໃບ pick ຈັດຕາມ<span className="underline">ທີ່ເກັບເທົ່ານັ້ນ</span> — ບໍ່ບັງຄັບ ISN (ໄປຍິງ SN ຕອນຢືນຢັນຈ່າຍ)
                </div>
              )}
              <label className="mb-1 block text-[11px] font-bold text-aqua-700 dark:text-aqua-300">🔫 ຍິງ / ພິມ SN ຫຼື ISN ແລ້ວ Enter (ເລືອກໃຫ້ສິນຄ້າອັດຕະໂນມັດ)</label>
              <input ref={gscanRef} value={gscan} onChange={(e) => setGscan(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleGlobalScan(); } }}
                placeholder="scan SN / ISN ..."
                className="w-full rounded-lg border border-aqua-300 bg-white px-3 py-2.5 text-sm font-mono outline-none focus:ring-2 focus:ring-aqua-500/30 dark:bg-zinc-950 dark:border-aqua-900/50" />
            </div>
          )}
          {loadingLines ? (
            <div className="py-16 text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
              <p className="mt-4 text-sm font-semibold text-zinc-550 dark:text-zinc-450">ກຳລັງໂຫຼດລາຍການ...</p>
            </div>
          ) : lines.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800 bg-zinc-50/20 dark:bg-zinc-950/10">
              <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-700" />
              <p className="mt-4 text-sm font-bold text-zinc-500 dark:text-zinc-400">ບໍ່ມີລາຍການຄ້າງຈ່າຍໃນສາງນີ້</p>
            </div>
          ) : (
            /* per-item allocation cards: location · ຈຳນວນ · ISN */
            <div className="space-y-3">
              {itemGroups.map((g) => {
                const need = Math.round(g.line.remaining);
                const alloc = allocatedFor(g.item_code);
                const complete = Math.abs(alloc - need) < 1e-6;
                const noStock = g.line.locations.length === 0;
                // How much of the ordered qty is NOT available to allocate here
                // (already issued, or parked on an open pick slip).
                const netted = g.line.issuedQty + g.line.pendingQty;
                return (
                  <div key={g.item_code} className="overflow-hidden rounded-2xl border border-zinc-200/80 dark:border-zinc-800">
                    <div className="flex items-center justify-between gap-2 bg-zinc-50/70 px-4 py-2.5 dark:bg-zinc-800/40">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-red-600 dark:text-red-400">{g.item_code}</span>
                          {g.line.serialized && <span className="rounded bg-aqua-100 px-1.5 py-0.5 text-[9px] font-extrabold text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300">SN</span>}
                        </div>
                        <div className="max-w-md truncate text-xs font-bold text-zinc-700 dark:text-zinc-300" title={g.line.item_name ?? ""}>{g.line.item_name ?? "—"}</div>
                        {/* ຂໍ → ຈ່າຍແລ້ວ → ໃນໃບ pick ຄ້າງ → ຄ້າງຈ່າຍ. ສະແດງສະເໝີເມື່ອ
                            "ຄ້າງຈ່າຍ" ໜ້ອຍກວ່າ "ຂໍ" ເພື່ອບໍ່ໃຫ້ເບິ່ງຄືລະບົບ default ຜິດ. */}
                        {netted > 0 && (
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-bold">
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">ຂໍ {formatQty(g.line.srcQty)}</span>
                            {g.line.issuedQty > 0 && (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/40">− ຈ່າຍແລ້ວ {formatQty(g.line.issuedQty)}</span>
                            )}
                            {g.line.pendingQty > 0 && (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/40" title="ຢູ່ໃນໃບ pick ທີ່ຍັງບໍ່ໄດ້ຢືນຢັນ">− ໃນໃບ pick {formatQty(g.line.pendingQty)}</span>
                            )}
                            <span className="text-zinc-400">=</span>
                            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/40">ຄ້າງຈ່າຍ {formatQty(need)}</span>
                          </div>
                        )}
                        {g.line.minStock && (
                          <MinStockWarning ms={g.line.minStock} issuing={alloc} unit={g.line.unit_code} />
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="text-right">
                          <div className={`font-mono text-sm font-bold ${complete ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{formatQty(alloc)} / {formatQty(need)}</div>
                          <div className="text-[10px] text-zinc-400">{g.line.unit_code} · {complete ? "ຄົບ ✓" : "ຍັງບໍ່ຄົບ"}</div>
                        </div>
                        <button type="button" onClick={() => setRemoved((p) => new Set([...g.allocs.map((a) => a.key), ...p]))} title="ລົບສິນຄ້ານີ້ (ບໍ່ຈ່າຍ)" className="rounded p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30">✕</button>
                      </div>
                    </div>
                    {noStock ? (
                      <div className="px-4 py-3 text-xs font-bold text-amber-600 dark:text-amber-400"><AlertIcon className="mr-1 inline h-4 w-4" /> ບໍ່ມີ stock ໃນ WMS</div>
                    ) : (
                      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {g.allocs.map((l) => {
                          const locStock = l.selIdx >= 0 ? Math.floor(Number.parseFloat(l.locations[l.selIdx]?.qty ?? "0") || 0) : 0;
                          const target = targetQty(l);
                          const over = qNum(l) > locStock + 1e-6;
                          return (
                            <div key={l.key} className="flex flex-wrap items-center gap-2.5 px-4 py-3">
                              <span className="text-[10px] font-bold text-zinc-400">⊙ ບ່ອນ</span>
                              <div className="relative min-w-[210px] flex-1">
                                <select value={l.selIdx} onChange={(e) => setLocation(l.key, Number.parseInt(e.target.value, 10))} className={`w-full rounded-lg bg-zinc-50/70 pl-3 pr-7 py-2 text-xs font-bold ring-1 dark:bg-zinc-950 appearance-none focus:outline-none focus:ring-2 focus:ring-red-500/30 cursor-pointer ${over ? "ring-amber-400 text-amber-700" : "ring-zinc-200 text-zinc-800 dark:ring-zinc-800 dark:text-zinc-200"}`}>
                                  <option value={-1}>— ເລືອກ location —</option>
                                  {l.locations.map((loc, idx) => (<option key={`${loc.rack}/${loc.location}/${loc.pallet}`} value={idx}>{idx === 0 ? "⭐ " : ""}{nodeName(loc, binNames, "(ສາງ)")} · ມີ {formatQty(loc.qty)}{loc.sn_qty != null ? ` · SN ${loc.sn_qty}${loc.sn_qty === 0 ? " ⚠" : ""}` : ""}{loc.first_in ? ` · ເຂົ້າ ${loc.first_in}` : ""}{idx === 0 ? " · FIFO" : ""}</option>))}
                                </select>
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-[10px]">▾</span>
                              </div>
                              <input type="number" inputMode="decimal" value={l.qty} placeholder="0"
                                onChange={(e) => (l.serialized ? setSerialQty(l.key, e.target.value) : setQty(l.key, e.target.value))}
                                className={`w-20 rounded-lg bg-zinc-50/50 px-2 py-2 text-center font-mono text-xs font-bold ring-1 focus:outline-none focus:ring-2 focus:ring-red-500/30 dark:bg-zinc-950 ${over ? "ring-amber-400 text-amber-700" : "ring-zinc-200 dark:ring-zinc-800"}`} />
                              {l.serialized ? (
                                <button type="button" onClick={() => openSerialPicker(l.key)} disabled={l.selIdx < 0}
                                  title={snPickRequired ? "ຕ້ອງເລືອກ ISN ໃຫ້ຄົບ" : "ບໍ່ບັງຄັບ — ສາງນີ້ຈັດ pick ຕາມທີ່ເກັບເທົ່ານັ້ນ (ຍິງ SN ຕອນຢືນຢັນ)"}
                                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold ring-1 disabled:opacity-40 ${l.selectedSerials.length >= target && target > 0 ? "bg-aqua-600 text-white ring-aqua-600" : "bg-aqua-50 text-aqua-700 ring-aqua-200 dark:bg-aqua-950/30 dark:text-aqua-300 dark:ring-aqua-900/40"}`}>
                                  <LayersIcon className="h-3.5 w-3.5" />{l.selectedSerials.length} / {target} ISN{!snPickRequired && <span className="opacity-70"> (ບໍ່ບັງຄັບ)</span>}
                                </button>
                              ) : (
                                <span className="text-[10px] text-zinc-400">ມີ {formatQty(locStock)}</span>
                              )}
                              {l.selIdx > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300" title="ບໍ່ແມ່ນ location ເກົ່າສຸດ (FIFO)">⚠ ບໍ່ FIFO</span>}
                              {g.allocs.length > 1 && <button type="button" onClick={() => removeAlloc(l.key)} className="rounded p-1 text-zinc-300 hover:text-rose-500" title="ລົບ allocation">✕</button>}
                            </div>
                          );
                        })}
                        <div className="px-4 py-2">
                          <button type="button" onClick={() => addAlloc(g.item_code)} className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-[11px] font-bold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 dark:bg-brand-950/30 dark:text-brand-300 dark:ring-brand-900/40">+ ເພີ່ມ location (ຈ່າຍຫຼາຍບ່ອນ)</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Removed lines — pull back into the issue */}
          {removedLines.length > 0 && (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 p-3 dark:border-zinc-700 dark:bg-zinc-950/30">
              <div className="mb-2 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">ລາຍການທີ່ລົບ (ບໍ່ຈ່າຍ) — ກົດເພື່ອເພີ່ມກັບ</div>
              <div className="flex flex-wrap gap-2">
                {removedLines.map((l) => (
                  <button key={l.key} type="button" onClick={() => setRemoved((p) => { const n = new Set(p); n.delete(l.key); return n; })}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:ring-emerald-300 hover:text-emerald-600 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-700">
                    <span className="text-emerald-500">+</span>
                    <span className="font-mono">{l.item_code}</span>
                    <span className="max-w-[180px] truncate text-zinc-400">{l.item_name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={resetToList} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-zinc-700 border border-zinc-200 transition-colors hover:bg-zinc-50 active:scale-98 dark:bg-zinc-950 dark:text-zinc-300 dark:border-zinc-800 dark:hover:bg-zinc-850 cursor-pointer">
              ← ກັບໄປເລືອກເອກະສານ
            </button>
            <div className="flex items-center gap-3.5">
              {activeLines.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50/70 border border-red-205 px-3 py-1.5 text-xs font-bold text-red-705 dark:bg-red-950/20 dark:text-red-300 dark:border-red-900/40 shadow-inner">
                  <PackageIcon className="h-4 w-4" />
                  {readyLines.length} ລາຍການ
                </span>
              )}
              <button type="button" onClick={submit} disabled={submitting || !canCreate}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-650 hover:to-orange-700 px-8 py-3 text-sm font-bold text-white shadow-md shadow-red-500/15 hover:shadow-lg active:scale-98 transition-all disabled:opacity-50 cursor-pointer">
                {submitting ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <ListIcon className="h-4.5 w-4.5" />}
                {submitting ? "ກຳລັງສ້າງ..." : `📋 ສ້າງໃບ pick ${readyLines.length} ລາຍການ`}
              </button>
            </div>
          </div>
        </section>
      )}


      {/* Serial picker modal */}
      {pickerLine && (
        <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-black/40 p-4" onClick={() => setSerialPickerFor(null)}>
          <div className="flex h-[85vh] max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-zinc-200/50 dark:bg-zinc-900 dark:ring-zinc-800/80 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="border-b border-zinc-150/70 bg-zinc-50/50 px-5 py-4.5 dark:border-zinc-800 dark:bg-zinc-950/20">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-black text-aqua-700 dark:text-aqua-300 bg-aqua-50 dark:bg-aqua-950/50 px-2 py-0.5 rounded border border-aqua-100/60 dark:border-aqua-900/40 inline-block mb-1.5 shadow-sm">
                    {pickerLine.item_code}
                  </div>
                  <div className="truncate text-xs font-extrabold text-zinc-800 dark:text-zinc-205">
                    {pickerLine.item_name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSerialPickerFor(null)}
                  className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs font-bold">
                <span className="text-zinc-500 dark:text-zinc-400">
                  ຕ້ອງການຈ່າຍ: <span className="font-mono text-zinc-850 dark:text-zinc-150">{formatQty(targetQty(pickerLine))}</span>
                </span>
                <span className="rounded-full bg-aqua-600 px-3 py-1 font-extrabold text-white shadow-sm shadow-aqua-600/20">
                  ເລືອກແລ້ວ: {pickerLine.selectedSerials.length} / {targetQty(pickerLine)}
                </span>
              </div>
            </div>

            {/* ① ບ່ອນຈັດເກັບ — SN ທຽບ Stock (ຄືກັນກັບ ກວດ SN ທຽບ Stock) */}
            {(() => {
              const loc = pickerLine.locations[pickerLine.selIdx];
              if (!loc) return null;
              const label = nodeName(loc, binNames, "(ສາງ)");
              const snCount = pickerLine.availableSerials.length;
              const stock = Number.parseFloat(loc.qty) || 0;
              const mismatch = Math.abs(snCount - stock) > 0.001;
              return (
                <div className="border-b border-zinc-105 bg-zinc-50/40 px-5 py-2.5 dark:border-zinc-800 dark:bg-zinc-950/20">
                  <div className="mb-1 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">① ບ່ອນຈັດເກັບ — SN ທຽບ Stock</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-aqua-50 px-2.5 py-1 font-mono text-[11px] font-bold text-aqua-700 ring-1 ring-aqua-200 dark:bg-aqua-950/40 dark:text-aqua-300 dark:ring-aqua-900/50">{label}</span>
                    <span className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">Stock(WMS) <b className="font-mono">{formatQty(stock)}</b></span>
                    <span className="text-zinc-300">·</span>
                    <span className={`text-[11px] font-semibold ${mismatch ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>SN <b className="font-mono">{snCount}</b></span>
                    {mismatch && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ບໍ່ຕົງ</span>}
                  </div>
                </div>
              );
            })()}

            {/* Scan row — ຍິງ / ພິມ SN ຫຼື ISN ແລ້ວ Enter (ຄືກັນກັບ sn-check) */}
            <div className="border-b border-zinc-105 p-3.5 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <div className="mb-1.5 text-[11px] font-bold text-zinc-500 dark:text-zinc-400">ຍິງ / ພິມ SN ຫຼື ISN ແລ້ວ Enter</div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
                  <input
                    ref={serialScanRef}
                    type="text"
                    autoFocus
                    value={serialSearch}
                    onChange={(e) => setSerialSearch(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSerialScan(); } }}
                    placeholder="ຍິງ barcode ຫຼື ພິມ ISN ແລ້ວ Enter..."
                    className="w-full rounded-xl bg-zinc-50 pl-9 pr-9 py-2.5 text-xs font-bold text-zinc-900 border border-zinc-200/80 outline-none hover:bg-zinc-100/30 focus:bg-white focus:border-aqua-500 focus:ring-2 focus:ring-aqua-500/20 dark:bg-zinc-950 dark:text-zinc-100 dark:border-zinc-850"
                  />
                  {serialSearch && (
                    <button type="button" onClick={() => setSerialSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400 hover:text-zinc-650 cursor-pointer">✕</button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleSerialScan}
                  className="shrink-0 rounded-xl bg-aqua-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-aqua-700 active:scale-95 cursor-pointer"
                >
                  ເພີ່ມ
                </button>
                <button
                  type="button"
                  onClick={() => selectFifo(pickerLine.key)}
                  title="ເລືອກ ISN ນ້ອຍສຸດ ຕາມຈຳນວນ (FIFO)"
                  className="shrink-0 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600 active:scale-95 cursor-pointer"
                >
                  ⚡ FIFO
                </button>
                {pickerLine.availableSerials.length > 0 && pickerLine.availableSerials.length <= targetQty(pickerLine) && (
                  <button
                    type="button"
                    onClick={() => selectAll(pickerLine.key)}
                    title="ເລືອກ ISN ທັງໝົດໃນບ່ອນນີ້ (ເທົ່າຈຳນວນ)"
                    className="shrink-0 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 cursor-pointer"
                  >
                    ✓ ທັງໝົດ ({pickerLine.availableSerials.length})
                  </button>
                )}
              </div>
            </div>

            {/* Two-pane: ເລືອກແລ້ວ (ຊ້າຍ) | ຍັງເຫຼືອ (ຂວາ) */}
            <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-100 overflow-hidden dark:divide-zinc-800">
              {/* selected */}
              <div className="flex min-h-0 flex-col">
                <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-bold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-300">
                  ເລືອກຈ່າຍ · {pickerLine.selectedSerials.length} / {targetQty(pickerLine)}
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1.5">
                  {pickerLine.selectedSerials.length === 0 ? (
                    <p className="py-6 text-center text-[11px] text-zinc-400">ຍັງບໍ່ມີ — ຍິງ / ເລືອກ SN</p>
                  ) : (
                    pickerLine.selectedSerials.map((sn) => {
                      const opt = pickerLine.availableSerials.find((o) => o.sn === sn);
                      return (
                        <div key={sn} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                          <span className="truncate font-mono text-[11px] font-bold text-zinc-800 dark:text-zinc-100">{opt?.isn ?? sn}</span>
                          <button type="button" onClick={() => toggleSerial(pickerLine.key, sn)} className="shrink-0 rounded px-1 text-rose-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" title="ເອົາອອກ">✕</button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              {/* remaining */}
              <div className="flex min-h-0 flex-col">
                <div className="border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] font-bold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-400">
                  ຍັງເຫຼືອ {filteredSerials.filter((s) => !pickerLine.selectedSerials.includes(s.sn)).length} — ກົດ / ຍິງ ເພີ່ມ
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1.5">
                  {(() => {
                    const remain = filteredSerials.filter((s) => !pickerLine.selectedSerials.includes(s.sn));
                    if (remain.length === 0) {
                      return <p className="py-6 text-center text-[11px] text-zinc-400">{pickerLine.availableSerials.length === 0 ? "ບໍ່ມີ serial ໃນບ່ອນນີ້" : "ໝົດແລ້ວ / ບໍ່ພົບ"}</p>;
                    }
                    // ສ່ວນທີ່ເຫຼືອ (serial ທີ່ບໍ່ໄດ້ຈ່າຍ) ຍັງສະແດງເຕັມ — ກົດຕອນຄົບ → toast
                    return remain.map((s) => (
                      <button
                        key={s.sn}
                        type="button"
                        onClick={() => {
                          if (pickerLine.selectedSerials.length >= targetQty(pickerLine)) showToast("err", "ເລືອກຄົບ ຕາມທີ່ຂໍແລ້ວ — ເອົາອອກກ່ອນຖ້າຈະປ່ຽນ");
                          else toggleSerial(pickerLine.key, s.sn);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left transition hover:bg-aqua-50 dark:hover:bg-aqua-950/20"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[11px] font-bold text-zinc-700 dark:text-zinc-300">{s.isn ?? s.sn}</span>
                          <span className="block text-[9px] text-zinc-400">
                            ຮັບ {fmtDate(s.received)}
                            {typeof s.days === "number" && <span className={`ml-1 font-bold ${s.days >= 180 ? "text-rose-500" : s.days >= 90 ? "text-amber-600" : "text-emerald-600"}`}>· ຄ້າງ {s.days} ມື້</span>}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] font-bold text-aqua-500">+</span>
                      </button>
                    ));
                  })()}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-zinc-150 px-5 py-3 dark:border-zinc-800 bg-white dark:bg-zinc-900">
              <span className="text-xs font-bold text-zinc-500">ເລືອກຈ່າຍ {pickerLine.selectedSerials.length} / {targetQty(pickerLine)} SN</span>
              <button
                type="button"
                onClick={() => setSerialPickerFor(null)}
                className="rounded-xl bg-gradient-to-r from-aqua-600 to-brand-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:shadow-lg active:scale-95 transition-all cursor-pointer"
              >
                ສຳເລັດ ({pickerLine.selectedSerials.length})
              </button>
            </div>
          </div>
        </div>
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

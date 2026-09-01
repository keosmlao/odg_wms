"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ListIcon,
  MapPinIcon,
  PackageIcon,
  SearchIcon,
  UserIcon,
} from "@/components/ui/Icons";
import { WarehouseGroup, groupByWarehouse } from "@/components/ui/WarehouseGroup";
import { useBinNames } from "@/components/useBinNames";
import { nodeName, type NameBook } from "@/lib/locationLabel";

/**
 * ດຶງ "ໃບຈັດຖ້ຽວ" ຂອງຂົນສົ່ງ (TMS) ມາເຮັດໃບສັ່ງຈ່າຍ.
 *
 * 1 ຖ້ຽວ = 1 ລົດ + ຫຼາຍບິນຂາຍ. ໜ້ານີ້ລວມຍອດຂອງທັງຖ້ຽວເປັນ "ຕໍ່ສິນຄ້າ" ໃຫ້ຄົນ
 * ເກັບຍ່າງເກັບເທື່ອດຽວ, ແລ້ວຕອນສ້າງ ລະບົບຈະຕັດເປັນໃບ pick ຕໍ່ບິນໃຫ້ອັດຕະໂນມັດ
 * (ref_doc_no ຕ້ອງເປັນເລກບິນ ຈຶ່ງຫັກຄ້າງຈ່າຍ ແລະ post ERP ຖືກ).
 */

type Bill = {
  bill_no: string;
  bill_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  remark: string | null;
  line_count: number;
  need_qty: number;
};
type NodeStock = { rack: string; location: string; pallet: string; qty: string; first_in: string | null; sn_qty: number | null };
type Alloc = { rack: string; location: string; pallet: string; qty: number };
type TripItem = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  need_qty: number;
  serialized: boolean;
  locations: NodeStock[];
  alloc: Alloc[];
  bills: { bill_no: string; qty: number }[];
};
type TripHeader = {
  doc_no: string;
  doc_date: string | null;
  date_logistic: string | null;
  car: string | null;
  car_name: string | null;
  driver: string | null;
  driver_name: string | null;
  driver_tel: string | null;
  route_code: string | null;
  route_name: string | null;
  round_code: string | null;
  round_name: string | null;
  round_time: string | null;
  approve_status: number | null;
  job_status: number | null;
  job_close: string | null;
  /** ເວລາທີ່ຂົນສົ່ງກົດ "ເລີ່ມຈັດສົ່ງ" — null = ຍັງບໍ່ອອກລົດ. */
  dispatch_started_at: string | null;
};
type TripListBill = {
  bill_no: string;
  bill_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  need_qty: string;
  trip_qty: string;
  remaining_qty: string;
  pending_qty: string;
  line_count: number;
  picks: string[];
};
type TripRow = TripHeader & {
  wh_code: string;
  created_at: string | null;
  bills_total: number;
  bills_pending: number;
  need_qty: string;
  pending_qty: string;
  picks: number;
  bills: TripListBill[];
};
type ExistingPick = { doc_no: string; bill_no: string | null; status: number | null; doc_date: string | null; qty: string; line_count: number };
type WarehouseOption = { code: string; name: string | null };

/** ISN ທີ່ເລືອກໄດ້ຢູ່ບ່ອນຈັດເກັບໜຶ່ງ (ຈາກ /api/movements/item-serials). */
type SerialOption = { sn: string; isn: string | null; received?: string | null; days?: number | null };

/** ແຖວແຜນເກັບ 1 ແຖວ = ສິນຄ້າ 1 ຢ່າງ ຢູ່ບ່ອນຈັດເກັບ 1 ບ່ອນ.
 *  `serials` ຫວ່າງ = ໃຫ້ລະບົບຈອງ ISN ແບບ FIFO ໃຫ້ຕອນສ້າງ. */
type PlanRow = { key: string; item_code: string; locIdx: number; qty: string; serials: string[] };

const JOB_STATUS: Record<number, { label: string; cls: string }> = {
  0: { label: "ລໍຖ້າອະນຸມັດ", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" },
  1: { label: "ພ້ອມຈັດ (ຍັງບໍ່ອອກລົດ)", cls: "bg-brand-100 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300" },
  2: { label: "ອອກລົດແລ້ວ", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  3: { label: "ສົ່ງຈົບແລ້ວ", cls: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" },
  4: { label: "ປິດວຽກແລ້ວ", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
function fmtQty(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
function nodeLabel(n: NodeStock | undefined, names?: NameBook) {
  if (!n) return "— ເລືອກບ່ອນຈັດເກັບ —";
  return `${nodeName(n, names, "(ສາງ)")} · ຄົງເຫຼືອ ${fmtQty(n.qty)}${n.sn_qty !== null ? ` · SN ${n.sn_qty}` : ""}`;
}
function parsed(raw: string): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** FIFO fill — ຄືກັບ allocateFifo ຝັ່ງ server (ບ່ອນທີ່ມີ serial ໜູນກ່ອນ ເມື່ອບັງຄັບ SN). */
function fifo(need: number, locs: NodeStock[], needsSn: boolean): { locIdx: number; qty: number }[] {
  const order = locs.map((_, i) => i);
  if (needsSn) order.sort((a, b) => Number((locs[b].sn_qty ?? 0) > 0) - Number((locs[a].sn_qty ?? 0) > 0));
  const out: { locIdx: number; qty: number }[] = [];
  let left = need;
  for (const i of order) {
    if (left <= 0.0001) break;
    let stock = Number.parseFloat(locs[i].qty) || 0;
    if (needsSn) stock = Math.min(stock, locs[i].sn_qty ?? 0);
    if (stock <= 0) continue;
    const take = Math.min(left, stock);
    out.push({ locIdx: i, qty: take });
    left -= take;
  }
  out.sort((a, b) => a.locIdx - b.locIdx);
  return out;
}

export default function TripIssue({ warehouses }: { warehouses: WarehouseOption[] }) {
  // ບໍ່ມີ dropdown ເລືອກສາງ — ດຶງຖ້ຽວມາທຸກສາງທີ່ມີສິດ ແລ້ວແຍກກຸ່ມ; ສາງທີ່ໃຊ້
  // ເຮັດວຽກ (`whCode`) ຕັ້ງຕອນເປີດຖ້ຽວ ຈາກຕົວຖ້ຽວເອງ.
  const [whCode, setWhCode] = useState("");
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [days, setDays] = useState(14);
  // ຄ່າເລີ່ມຕົ້ນ: ສະເພາະຖ້ຽວທີ່ຍັງບໍ່ທັນເລີ່ມຈັດສົ່ງ (ຍັງບໍ່ອອກລົດ)
  const [showStarted, setShowStarted] = useState(false);
  const [reload, setReload] = useState(0);

  const [trip, setTrip] = useState<TripHeader | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<TripItem[]>([]);
  const [existing, setExisting] = useState<ExistingPick[]>([]);
  const [snPick, setSnPick] = useState(false);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // ບິນທີ່ເລືອກຈ່າຍ
  const [plan, setPlan] = useState<PlanRow[]>([]);
  const [assignee, setAssignee] = useState("");
  // ຕົວເລືອກ ISN ຕໍ່ແຖວແຜນເກັບ (ໂຫຼດເມື່ອເປີດ picker)
  const [serialPickerFor, setSerialPickerFor] = useState<string | null>(null);
  const [serialOpts, setSerialOpts] = useState<Record<string, SerialOption[]>>({});
  const [serialSearch, setSerialSearch] = useState("");
  const [loadingSerials, setLoadingSerials] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // ຜົນລັບ = ໃບ pick ໃບດຽວ ຕໍ່ 1 ຖ້ຽວ (ພາຍໃນແຍກຕາມບິນ)
  const [created, setCreated] = useState<
    { doc_no: string; qty: number; lines: number; serials: number; bills: { bill_no: string; lines: number; qty: number; serials: number }[] } | null
  >(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const showToast = useCallback((kind: "ok" | "err", text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const whName = useMemo(() => warehouses.find((w) => w.code === whCode)?.name ?? null, [warehouses, whCode]);
  /** ຊື່ຊັ້ນວາງ/ບ່ອນເກັບ ຂອງສາງຂອງຖ້ຽວນີ້ — ສະແດງແທນລະຫັດ. */
  const binNames = useBinNames(whCode);
  const tripGroups = useMemo(() => groupByWarehouse(trips, (t) => t.wh_code, warehouses), [trips, warehouses]);

  // ລາຍການຖ້ຽວ ທຸກສາງ (debounce ຕາມການຄົ້ນຫາ)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ days: String(days) });
        if (showStarted) params.set("started", "1");
        if (search.trim()) params.set("q", search.trim());
        const res = await fetch(`/api/movements/issue/trips?${params}`);
        const data = (await res.json()) as { trips?: TripRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
        setTrips(data.trips ?? []);
      } catch (err) {
        if (!cancelled) showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [days, search, showStarted, reload, showToast]);

  /** ສ້າງແຜນເກັບ (FIFO) ໃໝ່ ຈາກຊຸດບິນທີ່ເລືອກ. */
  const buildPlan = useCallback((its: TripItem[], selectedBills: Set<string>, needsSn: boolean) => {
    const rows: PlanRow[] = [];
    for (const it of its) {
      const need = it.bills.filter((b) => selectedBills.has(b.bill_no)).reduce((s, b) => s + b.qty, 0);
      if (need <= 0) continue;
      const alloc = fifo(need, it.locations, needsSn && it.serialized);
      if (alloc.length === 0) {
        rows.push({ key: `${it.item_code}#0`, item_code: it.item_code, locIdx: it.locations.length > 0 ? 0 : -1, qty: String(need), serials: [] });
        continue;
      }
      for (const a of alloc) rows.push({ key: `${it.item_code}#${a.locIdx}`, item_code: it.item_code, locIdx: a.locIdx, qty: String(a.qty), serials: [] });
    }
    return rows;
  }, []);

  async function openTrip(docNo: string, wh: string) {
    setLoadingTrip(true);
    setWhCode(wh);
    setCreated(null);
    try {
      const res = await fetch(`/api/movements/issue/trips/${encodeURIComponent(docNo)}?wh=${encodeURIComponent(wh)}`);
      const data = (await res.json()) as {
        trip?: TripHeader; bills?: Bill[]; items?: TripItem[]; picks?: ExistingPick[];
        sn?: { issue: boolean; pick: boolean }; error?: string;
      };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      const sel = new Set((data.bills ?? []).filter((b) => b.need_qty > 0).map((b) => b.bill_no));
      const needsSn = data.sn?.pick === true;
      setTrip(data.trip);
      setBills(data.bills ?? []);
      setItems(data.items ?? []);
      setExisting(data.picks ?? []);
      setSnPick(needsSn);
      setPicked(sel);
      setPlan(buildPlan(data.items ?? [], sel, needsSn));
      setAssignee("");
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setLoadingTrip(false);
    }
  }

  function toggleBill(billNo: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(billNo)) next.delete(billNo);
      else next.add(billNo);
      setPlan(buildPlan(items, next, snPick));
      return next;
    });
  }
  function setAllBills(on: boolean) {
    const next = on ? new Set(bills.filter((b) => b.need_qty > 0).map((b) => b.bill_no)) : new Set<string>();
    setPicked(next);
    setPlan(buildPlan(items, next, snPick));
  }

  function back() {
    setTrip(null);
    setBills([]);
    setItems([]);
    setPlan([]);
    setPicked(new Set());
    setExisting([]);
    setReload((n) => n + 1);
  }

  const itemByCode = useMemo(() => new Map(items.map((i) => [i.item_code, i])), [items]);
  /** ຍອດທີ່ຕ້ອງເກັບຕໍ່ສິນຄ້າ ຕາມບິນທີ່ເລືອກ. */
  const needByItem = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const need = it.bills.filter((b) => picked.has(b.bill_no)).reduce((s, b) => s + b.qty, 0);
      if (need > 0) m.set(it.item_code, need);
    }
    return m;
  }, [items, picked]);

  const planByItem = useMemo(() => {
    const m = new Map<string, PlanRow[]>();
    for (const r of plan) {
      const arr = m.get(r.item_code);
      if (arr) arr.push(r);
      else m.set(r.item_code, [r]);
    }
    return m;
  }, [plan]);

  const totalPlanned = useMemo(() => plan.reduce((s, r) => s + parsed(r.qty), 0), [plan]);
  const totalNeed = useMemo(() => [...needByItem.values()].reduce((s, v) => s + v, 0), [needByItem]);
  /** ແຖວທີ່ຍັງບໍ່ພ້ອມ: ບໍ່ມີບ່ອນຈັດເກັບ ຫຼື ຈຳນວນເກີນຄົງເຫຼືອ. */
  const badRows = useMemo(
    () =>
      plan.filter((r) => {
        if (parsed(r.qty) <= 0) return false;
        const it = itemByCode.get(r.item_code);
        const loc = it?.locations[r.locIdx];
        if (!loc) return true;
        let stock = Number.parseFloat(loc.qty) || 0;
        if (snPick && it?.serialized) stock = Math.min(stock, loc.sn_qty ?? 0);
        return parsed(r.qty) > stock + 1e-6;
      }),
    [plan, itemByCode, snPick],
  );
  /** ສິນຄ້າທີ່ວາງແຜນເກັບໄດ້ບໍ່ຄົບຕາມທີ່ຖ້ຽວຂໍ (ຂອງບໍ່ພໍໃນສາງ). */
  const shortItems = useMemo(() => {
    const out: { item_code: string; need: number; planned: number }[] = [];
    for (const [code, need] of needByItem) {
      const got = (planByItem.get(code) ?? []).reduce((s, r) => s + parsed(r.qty), 0);
      if (got < need - 1e-6) out.push({ item_code: code, need, planned: got });
    }
    return out;
  }, [needByItem, planByItem]);

  function updateRow(key: string, patch: Partial<PlanRow>) {
    setPlan((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // ປ່ຽນບ່ອນຈັດເກັບ → ISN ທີ່ເລືອກໄວ້ໃຊ້ບໍ່ໄດ້ອີກ; ຫຼຸດຈຳນວນ → ຕັດ ISN ສ່ວນເກີນ
        if (patch.locIdx !== undefined && patch.locIdx !== r.locIdx) next.serials = [];
        else if (patch.qty !== undefined) next.serials = next.serials.slice(0, Math.round(parsed(next.qty)));
        return next;
      }),
    );
    if (patch.locIdx !== undefined) setSerialOpts((o) => { const n = { ...o }; delete n[key]; return n; });
  }

  /** ISN ຄົງເຫຼືອຢູ່ບ່ອນຈັດເກັບຂອງແຖວນີ້ (FIFO ຕາມ ISN ນ້ອຍກ່ອນ). */
  async function openSerialPicker(row: PlanRow) {
    const it = itemByCode.get(row.item_code);
    const loc = it?.locations[row.locIdx];
    if (!it || !loc) { showToast("err", "ເລືອກບ່ອນຈັດເກັບກ່ອນ"); return; }
    setSerialSearch("");
    setSerialPickerFor(row.key);
    if (serialOpts[row.key]) return;
    setLoadingSerials(true);
    try {
      const params = new URLSearchParams({ warehouse: whCode, item: row.item_code, rack: loc.rack, location: loc.location, pallet: loc.pallet });
      const res = await fetch(`/api/movements/item-serials?${params}`);
      const data = (await res.json()) as { serials?: SerialOption[] };
      setSerialOpts((o) => ({ ...o, [row.key]: data.serials ?? [] }));
      if ((data.serials ?? []).length === 0) showToast("err", "ບໍ່ພົບ ISN ຄົງເຫຼືອຢູ່ບ່ອນນີ້");
    } catch {
      showToast("err", "ໂຫຼດ ISN ບໍ່ສຳເລັດ");
    } finally {
      setLoadingSerials(false);
    }
  }
  function toggleSerial(key: string, sn: string) {
    setPlan((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (r.serials.includes(sn)) return { ...r, serials: r.serials.filter((x) => x !== sn) };
        if (r.serials.length >= Math.round(parsed(r.qty))) { showToast("err", "ເລືອກຄົບຕາມຈຳນວນແລ້ວ"); return r; }
        return { ...r, serials: [...r.serials, sn] };
      }),
    );
  }
  function pickFifoSerials(key: string) {
    const opts = serialOpts[key] ?? [];
    setPlan((prev) => prev.map((r) => (r.key === key ? { ...r, serials: opts.slice(0, Math.round(parsed(r.qty))).map((o) => o.sn) } : r)));
  }
  function addRow(item: string) {
    setPlan((prev) => {
      const it = itemByCode.get(item);
      if (!it) return prev;
      const used = new Set(prev.filter((r) => r.item_code === item).map((r) => r.locIdx));
      const idx = it.locations.findIndex((_, i) => !used.has(i));
      const need = needByItem.get(item) ?? 0;
      const got = prev.filter((r) => r.item_code === item).reduce((s, r) => s + parsed(r.qty), 0);
      const rest = Math.max(0, need - got);
      const stock = idx >= 0 ? Number.parseFloat(it.locations[idx].qty) || 0 : 0;
      const next = [...prev];
      const at = prev.map((r) => r.item_code).lastIndexOf(item);
      next.splice(at + 1, 0, { key: `${item}#${idx}-${prev.length}`, item_code: item, locIdx: idx, qty: String(Math.min(rest, stock) || ""), serials: [] });
      return next;
    });
  }
  function removeRow(key: string) {
    setPlan((prev) => {
      const row = prev.find((r) => r.key === key);
      if (!row || prev.filter((r) => r.item_code === row.item_code).length <= 1) return prev;
      return prev.filter((r) => r.key !== key);
    });
  }

  async function submit() {
    if (!trip) return;
    if (picked.size === 0) { showToast("err", "ກະລຸນາເລືອກບິນຢ່າງໜ້ອຍ 1 ໃບ"); return; }
    if (badRows.length > 0) { showToast("err", `ສິນຄ້າ ${badRows[0].item_code}: ບ່ອນຈັດເກັບ ຫຼື ຈຳນວນ ບໍ່ຖືກຕ້ອງ`); return; }
    // ບ່ອນຈັດເກັບຊ້ຳກັນຂອງສິນຄ້າດຽວກັນ — ໃຫ້ລວມເປັນແຖວດຽວ ບໍ່ດັ່ງນັ້ນ server ຈະປະຕິເສດ
    const dup = new Set<string>();
    for (const r of plan) {
      if (parsed(r.qty) <= 0 || r.locIdx < 0) continue;
      const k = `${r.item_code}#${r.locIdx}`;
      if (dup.has(k)) { showToast("err", `ສິນຄ້າ ${r.item_code}: ເລືອກບ່ອນຈັດເກັບຊ້ຳກັນ`); return; }
      dup.add(k);
    }
    const lines = plan
      .filter((r) => parsed(r.qty) > 0 && r.locIdx >= 0)
      .map((r) => {
        const it = itemByCode.get(r.item_code)!;
        const loc = it.locations[r.locIdx];
        return {
          item_code: r.item_code,
          item_name: it.item_name,
          unit_code: it.unit_code,
          qty: parsed(r.qty),
          rack: loc?.rack ?? "",
          location: loc?.location ?? "",
          pallet: loc?.pallet ?? "",
          // ຫວ່າງ = server ຈອງ ISN ແບບ FIFO ໃຫ້
          serials: it.serialized ? r.serials : [],
        };
      });
    if (lines.length === 0) { showToast("err", "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ"); return; }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/movements/issue/trips/${encodeURIComponent(trip.doc_no)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: whCode, bills: [...picked], remark: assignee.trim() || null, lines }),
      });
      const data = (await res.json()) as {
        ok?: boolean; doc_no?: string; qty?: number; lines?: number; serials?: number;
        bills?: { bill_no: string; lines: number; qty: number; serials: number }[]; error?: string;
      };
      if (!res.ok || !data.ok || !data.doc_no) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setCreated({
        doc_no: data.doc_no,
        qty: data.qty ?? 0,
        lines: data.lines ?? 0,
        serials: data.serials ?? 0,
        bills: data.bills ?? [],
      });
      showToast("ok", `ສ້າງໃບສັ່ງຈ່າຍ ${data.doc_no} ສຳເລັດ`);
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const primaryBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-red-500/20 transition hover:shadow-lg disabled:opacity-50";
  const ghostBtn =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  // ── ຜົນລັບຫຼັງສ້າງ ─────────────────────────────────────────────────────────
  if (created) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900/40 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-extrabold text-emerald-700 dark:text-emerald-300">
              ✓ ສ້າງໃບສັ່ງຈ່າຍ <span className="font-mono">{created.doc_no}</span> ສຳເລັດ · ຖ້ຽວ {trip?.doc_no} · {created.bills.length} ບິນ · {fmtQty(created.qty)} ໜ່ວຍ
            </div>
            <div className="flex items-center gap-2">
              {trip && (
                <a href={`/print/pick-trip/${encodeURIComponent(trip.doc_no)}?wh=${encodeURIComponent(whCode)}&auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">
                  🖨 ພິມໃບເກັບ (ລວມທັງຖ້ຽວ)
                </a>
              )}
              <a href={`/print/pick/${encodeURIComponent(created.doc_no)}?auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-50">🖨 ພິມໃບ pick</a>
              <a href="/movements/issue?tab=pending" className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">② ໄປຢືນຢັນຈ່າຍ →</a>
            </div>
          </div>
          <div className="mt-3 overflow-hidden rounded-xl bg-white ring-1 ring-emerald-200 dark:bg-zinc-900 dark:ring-emerald-900/40">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-emerald-50/60 text-left text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <th className="px-4 py-2">ບິນຂາຍໃນໃບນີ້</th>
                  <th className="px-4 py-2 text-right">ລາຍການ</th>
                  <th className="px-4 py-2 text-right">ຈຳນວນ</th>
                  <th className="px-4 py-2 text-right">SN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {created.bills.map((c) => (
                  <tr key={c.bill_no}>
                    <td className="px-4 py-2 font-mono text-zinc-700 dark:text-zinc-200">{c.bill_no}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.lines}</td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">{fmtQty(c.qty)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-500">{c.serials || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
            ໃບດຽວ ເກັບເທື່ອດຽວ — ຕອນຢືນຢັນຈ່າຍ ລະບົບຈະຕັດ stock ແລະ post ເຂົ້າ ERP ແຍກໃຫ້ຕາມບິນອັດຕະໂນມັດ
          </p>
        </div>
        <button type="button" onClick={back} className={ghostBtn}>← ກັບໄປລາຍການຖ້ຽວ</button>
      </div>
    );
  }

  // ── ລາຍລະອຽດ 1 ຖ້ຽວ ──────────────────────────────────────────────────────
  if (trip) {
    const status = JOB_STATUS[trip.job_status ?? 0];
    return (
      <div className="space-y-5">
        {toast && (
          <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${toast.kind === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>{toast.text}</div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={back} className={ghostBtn}>← ລາຍການຖ້ຽວ</button>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            <BuildingIcon className="mr-1 inline h-3 w-3" />{whCode}{whName ? ` · ${whName}` : ""}
          </div>
        </div>

        {/* ຫົວໃບຈັດຖ້ຽວ */}
        <div className="rounded-2xl bg-white p-5 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-red-50 px-2.5 py-1 font-mono text-sm font-extrabold text-red-700 dark:bg-red-950/40 dark:text-red-300">🚚 {trip.doc_no}</span>
            {status && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.cls}`}>{status.label}</span>}
            {trip.approve_status === 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ຂົນສົ່ງຍັງບໍ່ອະນຸມັດຖ້ຽວ</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />ວັນທີ່ຖ້ຽວ {fmtDate(trip.date_logistic ?? trip.doc_date)}</span>
            <span className="inline-flex items-center gap-1"><PackageIcon className="h-3 w-3" />ລົດ {trip.car_name ?? trip.car ?? "—"}</span>
            <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />ຄົນຂັບ {trip.driver_name ?? trip.driver ?? "—"}{trip.driver_tel ? ` · ${trip.driver_tel}` : ""}</span>
            {trip.route_name && <span className="inline-flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{trip.route_name}</span>}
            {trip.round_name && <span className="inline-flex items-center gap-1">{trip.round_name}{trip.round_time ? ` (${trip.round_time})` : ""}</span>}
          </div>
        </div>

        {existing.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/30">
            <div className="font-bold text-amber-800 dark:text-amber-300">ຖ້ຽວນີ້ມີໃບສັ່ງຈ່າຍແລ້ວ {existing.length} ໃບ (ຫັກອອກຈາກຍອດຂ້າງລຸ່ມແລ້ວ)</div>
            <div className="mt-1 flex flex-wrap gap-2 text-amber-700 dark:text-amber-300/90">
              {existing.map((p) => (
                <a key={p.doc_no} href={`/print/pick/${encodeURIComponent(p.doc_no)}`} target="_blank" rel="noopener" className="rounded-lg bg-white px-2 py-1 font-mono ring-1 ring-amber-200 hover:bg-amber-50 dark:bg-zinc-900 dark:ring-amber-900/40">
                  {p.doc_no} · {p.bill_no} · {(p.status ?? 0) === 0 ? "ລໍຢືນຢັນ" : "ຢືນຢັນແລ້ວ"}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ບິນໃນຖ້ຽວ */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <div className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ບິນໃນຖ້ຽວ ({picked.size}/{bills.filter((b) => b.need_qty > 0).length})</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setAllBills(true)} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">ເລືອກໝົດ</button>
              <button type="button" onClick={() => setAllBills(false)} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">ລ້າງ</button>
            </div>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {bills.map((b) => {
              const on = picked.has(b.bill_no);
              const none = b.need_qty <= 0;
              return (
                <label key={b.bill_no} className={`flex cursor-pointer flex-wrap items-center gap-3 px-5 py-2.5 transition ${none ? "opacity-50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"}`}>
                  <input type="checkbox" checked={on} disabled={none} onChange={() => toggleBill(b.bill_no)} className="h-4 w-4 accent-red-600" />
                  <span className="font-mono text-sm font-bold text-zinc-900 dark:text-zinc-100">{b.bill_no}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                    <UserIcon className="mr-1 inline h-3 w-3" />{b.cust_name?.trim() || b.cust_code || "—"}
                    {b.bill_date ? ` · ${fmtDate(b.bill_date)}` : ""}
                  </span>
                  <span className="text-[11px] text-zinc-400">{b.line_count} ລາຍການ</span>
                  <span className="font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{fmtQty(b.need_qty)}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* ແຜນເກັບ ຕໍ່ສິນຄ້າ */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
            <div>
              <div className="text-sm font-extrabold text-zinc-900 dark:text-zinc-100">ແຜນເກັບສິນຄ້າ (ລວມທັງຖ້ຽວ)</div>
              <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                ບ່ອນຈັດເກັບເລືອກໃຫ້ແບບ FIFO (ຂອງເກົ່າກ່ອນ) — ປ່ຽນໄດ້{snPick ? " · ສາງນີ້ບັງຄັບ SN ຕັ້ງແຕ່ໃບ pick: ກົດ ISN ເພື່ອເລືອກເອງ, ບໍ່ເລືອກ = ລະບົບຈອງ ISN ນ້ອຍສຸດ (FIFO) ໃຫ້" : ""}
              </div>
            </div>
            <div className="text-right text-xs">
              <span className="text-zinc-400">ຕ້ອງເກັບ </span>
              <span className="font-mono font-bold tabular-nums text-zinc-900 dark:text-zinc-100">{fmtQty(totalNeed)}</span>
              <span className="text-zinc-400"> · ວາງແຜນ </span>
              <span className={`font-mono font-bold tabular-nums ${Math.abs(totalPlanned - totalNeed) < 1e-6 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{fmtQty(totalPlanned)}</span>
            </div>
          </div>

          {needByItem.size === 0 ? (
            <div className="py-10 text-center text-sm font-bold text-zinc-500 dark:text-zinc-400">ເລືອກບິນກ່ອນ</div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {[...needByItem.entries()].map(([code, need]) => {
                const it = itemByCode.get(code)!;
                const rows = planByItem.get(code) ?? [];
                const got = rows.reduce((s, r) => s + parsed(r.qty), 0);
                const short = got < need - 1e-6;
                return (
                  <div key={code} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-zinc-500 dark:text-zinc-400">{code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{it.item_name ?? "—"}</span>
                      {it.serialized && <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">SN</span>}
                      <span className={`font-mono text-sm font-bold tabular-nums ${short ? "text-amber-600 dark:text-amber-400" : "text-zinc-900 dark:text-zinc-100"}`}>
                        {fmtQty(got)} / {fmtQty(need)} {it.unit_code ?? ""}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-zinc-400">
                      {it.bills.filter((b) => picked.has(b.bill_no)).map((b) => (
                        <span key={b.bill_no} className="font-mono">{b.bill_no}: {fmtQty(b.qty)}</span>
                      ))}
                    </div>

                    <div className="mt-2 space-y-2">
                      {rows.map((r) => {
                        const loc = it.locations[r.locIdx];
                        let stock = loc ? Number.parseFloat(loc.qty) || 0 : 0;
                        if (snPick && it.serialized && loc) stock = Math.min(stock, loc.sn_qty ?? 0);
                        const over = parsed(r.qty) > stock + 1e-6;
                        return (
                          <div key={r.key} className="flex flex-wrap items-center gap-2">
                            <select
                              value={r.locIdx}
                              onChange={(e) => updateRow(r.key, { locIdx: Number.parseInt(e.target.value, 10) })}
                              className={`${inputCls} min-w-0 flex-1 sm:max-w-md`}
                            >
                              <option value={-1}>— ເລືອກບ່ອນຈັດເກັບ —</option>
                              {it.locations.map((l, i) => (
                                <option key={`${l.rack}|${l.location}|${l.pallet}`} value={i}>{nodeLabel(l, binNames)}{l.first_in ? ` · ເຂົ້າ ${fmtDate(l.first_in)}` : ""}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={0}
                              value={r.qty}
                              onChange={(e) => updateRow(r.key, { qty: e.target.value })}
                              className={`${inputCls} w-28 text-right font-mono font-bold ${over ? "ring-2 ring-red-500" : ""}`}
                            />
                            <button type="button" onClick={() => addRow(code)} title="ແຍກເກັບອີກບ່ອນ" className="rounded-lg bg-zinc-100 px-2.5 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">+ ບ່ອນ</button>
                            {rows.length > 1 && (
                              <button type="button" onClick={() => removeRow(r.key)} className="rounded-lg bg-red-50 px-2.5 py-2 text-xs font-bold text-red-600 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300">ລຶບ</button>
                            )}
                            {it.serialized && loc && (
                              <button
                                type="button"
                                onClick={() => void openSerialPicker(r)}
                                title="ເລືອກ ISN ເອງ (ບໍ່ເລືອກ = ລະບົບຈອງ FIFO ໃຫ້)"
                                className={`rounded-lg px-2.5 py-2 text-xs font-bold transition ${
                                  r.serials.length > 0
                                    ? "bg-brand-600 text-white hover:bg-brand-700"
                                    : "bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300"
                                }`}
                              >
                                ISN {r.serials.length > 0 ? `${r.serials.length}/${Math.round(parsed(r.qty))}` : "auto"}
                              </button>
                            )}
                            {loc && <span className="text-[10px] text-zinc-400">ຄົງເຫຼືອ {fmtQty(stock)}</span>}
                          </div>
                        );
                      })}
                      {it.locations.length === 0 && (
                        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-950/30 dark:text-red-300">
                          <AlertIcon className="mr-1 inline h-3 w-3" />ບໍ່ມີສິນຄ້ານີ້ໃນສາງ {whCode}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {shortItems.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-300">
            ⚠ ຂອງບໍ່ພໍ {shortItems.length} ລາຍການ — ຈະສ້າງໃບເທົ່າທີ່ມີ, ສ່ວນທີ່ເຫຼືອຍັງຄ້າງໃນບິນ:
            <span className="ml-1 font-mono">{shortItems.slice(0, 6).map((s) => `${s.item_code} (${fmtQty(s.planned)}/${fmtQty(s.need)})`).join(", ")}{shortItems.length > 6 ? " …" : ""}</span>
          </div>
        )}

        {/* ເລືອກ ISN ເອງ */}
        {serialPickerFor && (() => {
          const row = plan.find((r) => r.key === serialPickerFor);
          if (!row) return null;
          const it = itemByCode.get(row.item_code);
          const opts = serialOpts[row.key] ?? [];
          const term = serialSearch.trim().toUpperCase();
          const shown = term ? opts.filter((o) => o.sn.toUpperCase().includes(term) || (o.isn ?? "").toUpperCase().includes(term)) : opts;
          const want = Math.round(parsed(row.qty));
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSerialPickerFor(null)}>
              <div className="max-h-[80vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-zinc-900 dark:text-zinc-100">{row.item_code} · {it?.item_name ?? ""}</div>
                    <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      ເລືອກ {row.serials.length}/{want} ໜ່ວຍ · ບ່ອນ {nodeLabel(it?.locations[row.locIdx], binNames)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => pickFifoSerials(row.key)} className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300">FIFO</button>
                    <button type="button" onClick={() => updateRow(row.key, { serials: [] })} className="rounded-lg bg-zinc-100 px-2.5 py-1.5 text-xs font-bold text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">ລ້າງ</button>
                    <button type="button" onClick={() => setSerialPickerFor(null)} className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">ແລ້ວ</button>
                  </div>
                </div>
                <div className="px-5 py-3">
                  <input
                    autoFocus
                    value={serialSearch}
                    onChange={(e) => setSerialSearch(e.target.value)}
                    placeholder="ສະແກນ / ພິມ ISN ເພື່ອຄົ້ນຫາ..."
                    className={inputCls}
                  />
                </div>
                <div className="max-h-[50vh] overflow-y-auto px-3 pb-4">
                  {loadingSerials ? (
                    <div className="py-8 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ ISN...</div>
                  ) : shown.length === 0 ? (
                    <div className="py-8 text-center text-sm text-zinc-400">ບໍ່ພົບ ISN</div>
                  ) : (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {shown.map((o) => {
                        const on = row.serials.includes(o.sn);
                        return (
                          <button
                            key={o.sn}
                            type="button"
                            onClick={() => toggleSerial(row.key, o.sn)}
                            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
                              on ? "bg-brand-600 text-white" : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-950/60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            }`}
                          >
                            <span className="min-w-0 truncate font-mono font-bold">{o.isn ?? o.sn}</span>
                            <span className={`shrink-0 text-[10px] ${on ? "text-white/80" : "text-zinc-400"}`}>
                              {o.days != null ? `${o.days} ມື້` : ""}{on ? " ✓" : ""}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ສ້າງ */}
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/95 p-4 shadow-card ring-1 ring-zinc-200 backdrop-blur dark:bg-zinc-900/95 dark:ring-zinc-800">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-xs font-bold text-zinc-500 dark:text-zinc-400">🚜 ມອບໝາຍຜູ້ເກັບ</span>
            <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="ຊື່ຄົນເກັບ / forklift" className={`${inputCls} max-w-xs`} />
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">ຈະສ້າງ <b className="text-zinc-900 dark:text-zinc-100">{picked.size}</b> ໃບ · <b className="text-zinc-900 dark:text-zinc-100">{fmtQty(totalPlanned)}</b> ໜ່ວຍ</span>
            <button type="button" onClick={submit} disabled={submitting || picked.size === 0 || totalPlanned <= 0 || badRows.length > 0} className={primaryBtn}>
              {submitting ? "ກຳລັງສ້າງ..." : <><CheckIcon className="h-4 w-4" />ສ້າງໃບສັ່ງຈ່າຍ</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── ລາຍການຖ້ຽວ ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${toast.kind === "ok" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"}`}>{toast.text}</div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ຄົ້ນຫາ ເລກຖ້ຽວ / ລົດ / ຄົນຂັບ / ເລກບິນ..."
            className="w-full rounded-xl bg-zinc-50/50 py-3.5 pl-11 pr-4 text-sm text-zinc-900 ring-1 ring-zinc-250 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-red-500/30 disabled:opacity-60 dark:bg-zinc-950/40 dark:text-zinc-100 dark:ring-zinc-800"
          />
        </div>
        <select value={days} onChange={(e) => setDays(Number.parseInt(e.target.value, 10))} className={`${inputCls} h-12 w-36`}>
          <option value={3}>3 ມື້ຫຼ້າສຸດ</option>
          <option value={7}>7 ມື້ຫຼ້າສຸດ</option>
          <option value={14}>14 ມື້ຫຼ້າສຸດ</option>
          <option value={30}>30 ມື້ຫຼ້າສຸດ</option>
        </select>
        <label
          className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-lg bg-white px-3 text-xs font-bold text-zinc-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800"
          title="ຄ່າເລີ່ມຕົ້ນສະແດງສະເພາະຖ້ຽວທີ່ຍັງບໍ່ທັນເລີ່ມຈັດສົ່ງ"
        >
          <input type="checkbox" checked={showStarted} onChange={(e) => setShowStarted(e.target.checked)} className="h-4 w-4 accent-red-600" />
          ລວມຖ້ຽວທີ່ອອກລົດແລ້ວ
        </label>
      </div>

      {loading ? (
        <div className="py-16 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
          <p className="mt-4 text-sm font-semibold text-zinc-500">ກຳລັງໂຫຼດໃບຈັດຖ້ຽວ...</p>
        </div>
      ) : trips.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 py-16 text-center dark:border-zinc-800/80">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-850 dark:text-zinc-500"><ListIcon className="h-6 w-6" /></div>
          <p className="mt-4 text-sm font-bold text-zinc-500 dark:text-zinc-400">ບໍ່ມີໃບຈັດຖ້ຽວທີ່ຄ້າງຈ່າຍໃນທຸກສາງທີ່ທ່ານມີສິດ</p>
          <p className="mt-1 text-xs text-zinc-400">ຖ້ຽວທີ່ຂົນສົ່ງຫາກໍຈັດ ຈະຂຶ້ນມາອັດຕະໂນມັດ</p>
        </div>
      ) : (
        <div className="space-y-1">
          {tripGroups.map((g) => (
            <WarehouseGroup
              key={g.code}
              code={g.code}
              name={warehouses.find((w) => w.code === g.code)?.name}
              count={g.rows.length}
              countLabel="ຖ້ຽວ"
              tone="red"
            >
              <div className="space-y-4">
          {g.rows.map((t) => {
            const status = JOB_STATUS[t.job_status ?? 0];
            return (
              <details key={`${t.wh_code}-${t.doc_no}`} className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">🚚</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{t.doc_no}</span>
                      {status && <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status.cls}`}>{status.label}</span>}
                      {t.picks > 0 && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">ມີໃບ pick ແລ້ວ {t.picks}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{fmtDate(t.date_logistic ?? t.doc_date)}</span>
                      <span className="inline-flex items-center gap-1"><PackageIcon className="h-3 w-3" />{t.car_name ?? t.car ?? "—"}</span>
                      <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{t.driver_name ?? t.driver ?? "—"}</span>
                      {t.route_name && <span className="inline-flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{t.route_name}</span>}
                      {t.round_name && <span>{t.round_name}{t.round_time ? ` (${t.round_time})` : ""}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="text-[10px] uppercase text-zinc-400">ຄ້າງເກັບ</div>
                      <div className="font-mono text-sm font-bold tabular-nums text-red-600 dark:text-red-400">{fmtQty(t.need_qty)}</div>
                      <div className="text-[10px] text-zinc-400">{t.bills_pending}/{t.bills_total} ບິນ</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); void openTrip(t.doc_no, t.wh_code); }}
                      disabled={loadingTrip}
                      className="cursor-pointer rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:shadow active:scale-95 disabled:opacity-50"
                    >
                      ສ້າງໃບສັ່ງຈ່າຍ →
                    </button>
                  </div>
                </summary>
                {t.bills.length > 0 && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                          <th className="px-4 py-2">ບິນຂາຍ</th>
                          <th className="px-4 py-2">ລູກຄ້າ</th>
                          <th className="px-4 py-2 text-right">ຂຶ້ນລົດຖ້ຽວນີ້</th>
                          <th className="px-4 py-2 text-right">ຄ້າງເກັບ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {t.bills.map((b) => (
                          <tr key={b.bill_no}>
                            <td className="px-4 py-2 font-mono text-xs font-bold text-zinc-800 dark:text-zinc-200">
                              {b.bill_no}
                              {b.picks.length > 0 && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{b.picks.join(", ")}</span>}
                            </td>
                            <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">{b.cust_name?.trim() || b.cust_code || "—"}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-zinc-500">{fmtQty(b.trip_qty)}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs font-bold tabular-nums text-red-600 dark:text-red-400">{fmtQty(b.need_qty)}</td>
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
  );
}

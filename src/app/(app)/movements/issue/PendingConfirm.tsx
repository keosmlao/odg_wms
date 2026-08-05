"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertIcon, CheckIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { MOVE_REASONS } from "@/lib/moveReasons";
import ScanLogPanel from "./ScanLogPanel";
import type { WarehouseOption } from "./SourceIssue";

type DraftDoc = {
  doc_no: string; doc_date: string | null; doc_time: string | null; warehouse_code: string | null;
  ref_doc_no: string | null; customer_code: string | null; remark: string | null; line_count: number; serial_count: number; total_qty: string;
};
/** A scannable unit, tagged with the node it currently sits at. */
type Unit = { sn: string | null; isn: string | null; rack: string; location: string; pallet: string };
/** A bin in this warehouse that still holds the item — a re-point target. */
type LocOption = { rack: string; location: string; pallet: string; qty: string; sn_qty: number };
type DraftLine = { roworder: number; item_code: string; item_name: string | null; unit_code: string | null; qty: string; rack: string; location: string; pallet: string; serials: string[]; units?: Unit[]; loc_options?: LocOption[]; serial_required?: boolean; dual_required?: boolean };
/** Where a line's goods were actually taken from, when it differs from the plan. */
type NodeRef = { rack: string; location: string; pallet: string };
/** One entry in the confirm-step audit trail (odg_wms_pick_scan_log). */
type ScanEvent = {
  event: "scan" | "unscan" | "move" | "confirm";
  result?: string;
  item_code?: string | null;
  scan_input?: string | null;
  sn?: string | null;
  isn?: string | null;
  rack?: string | null;
  location?: string | null;
  pallet?: string | null;
  from_node?: string | null;
  to_node?: string | null;
  qty?: number | null;
  note?: string | null;
};
/** A row read back from the trail. */
type ScanLogRow = ScanEvent & { roworder: number; user_created: string | null; created_at: string; qty: string | null };

const nodeKey = (n: NodeRef) => `${n.rack}|${n.location}|${n.pallet}`;
const nodeLabel = (n: NodeRef) => [n.rack, n.location, n.pallet].filter(Boolean).join(" / ") || "(ສາງ)";

function ddmm(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return day ? `${day}-${m}-${y}` : d;
}

// ── Draft-scan persistence (survives a page refresh) ─────────────────────────
// Scans that are entered but not yet confirmed are kept in localStorage keyed by
// doc, so refreshing (or navigating away) never loses them — the operator can
// come back and keep scanning where they left off.
const LS_ACTIVE = "wms.issueConfirm.activeDoc";
const LS_WH = "wms.issueConfirm.wh";
const scanKey = (doc: string) => `wms.issueConfirm.scan.${doc}`;

function lsGet(key: string): string | null {
  try { return typeof window !== "undefined" ? window.localStorage.getItem(key) : null; } catch { return null; }
}
function lsSet(key: string, val: string) {
  try { if (typeof window !== "undefined") window.localStorage.setItem(key, val); } catch { /* ignore quota / privacy mode */ }
}
function lsDel(key: string) {
  try { if (typeof window !== "undefined") window.localStorage.removeItem(key); } catch { /* ignore */ }
}
function loadScan(doc: string): { scanned: string[]; reasons: Record<string, string>; moves: Record<string, NodeRef> } {
  try {
    const raw = lsGet(scanKey(doc));
    if (!raw) return { scanned: [], reasons: {}, moves: {} };
    const p = JSON.parse(raw) as { scanned?: string[]; reasons?: Record<string, string>; moves?: Record<string, NodeRef> };
    return { scanned: Array.isArray(p.scanned) ? p.scanned : [], reasons: p.reasons ?? {}, moves: p.moves ?? {} };
  } catch { return { scanned: [], reasons: {}, moves: {} }; }
}

export default function PendingConfirm({ warehouses }: { warehouses: WarehouseOption[] }) {
  const [wh, setWh] = useState(warehouses.length === 1 ? warehouses[0].code : "");
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<{ header: DraftDoc; lines: DraftLine[] } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [linesByDoc, setLinesByDoc] = useState<Record<string, DraftLine[]>>({});
  const [scanned, setScanned] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({}); // item → short reason
  // roworder → the bin the goods were actually taken from, when it differs from
  // the planned one. Applied to the pick slip when the issue is confirmed.
  const [moves, setMoves] = useState<Record<string, NodeRef>>({});
  // Audit trail of this confirm session — buffered and flushed in the background
  // so scanning is never blocked by logging (see /api/movements/issue/scan-log).
  const logBuf = useRef<ScanEvent[]>([]);
  const logTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logDoc = useRef<{ doc_no: string; ref_doc: string | null; wh: string | null } | null>(null);
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ k: "ok" | "err"; t: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  function showToast(k: "ok" | "err", t: string) { setToast({ k, t }); setTimeout(() => setToast(null), 2800); }

  // ── Confirm-step audit trail ───────────────────────────────────────────────
  // Every scan (accepted or rejected), un-scan and location change is buffered
  // and POSTed in the background. Logging is deliberately fire-and-forget: it
  // must never slow a scanner down or block a confirm if the request fails.
  const flushLog = useCallback(async () => {
    if (logTimer.current) { clearTimeout(logTimer.current); logTimer.current = null; }
    const target = logDoc.current;
    const batch = logBuf.current;
    if (!target || batch.length === 0) return;
    logBuf.current = [];
    try {
      await fetch(`/api/movements/issue/scan-log`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc_no: target.doc_no, ref_doc: target.ref_doc, wh: target.wh, events: batch }),
      });
    } catch { /* telemetry only — a dropped batch must not disturb the pick */ }
  }, []);

  const logEvent = useCallback((e: ScanEvent) => {
    if (!logDoc.current) return;
    logBuf.current.push(e);
    if (logTimer.current) clearTimeout(logTimer.current);
    logTimer.current = setTimeout(() => { void flushLog(); }, 1500);
  }, [flushLog]);

  // Don't lose a half-full buffer when the operator walks away or reloads.
  useEffect(() => {
    const onLeave = () => { void flushLog(); };
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("beforeunload", onLeave); void flushLog(); };
  }, [flushLog]);

  async function loadDocs() {
    if (!wh) { setDocs([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/movements/issue/draft?wh=${encodeURIComponent(wh)}`);
      const data = (await res.json()) as { docs?: DraftDoc[] };
      setDocs(data.docs ?? []);
    } finally { setLoading(false); }
  }
  useEffect(() => { void loadDocs(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [wh]);

  // On first mount, restore the warehouse + auto-reopen the doc the operator was
  // confirming (with its stashed scans), so a page refresh resumes in place.
  useEffect(() => {
    const savedWh = lsGet(LS_WH);
    if (savedWh) setWh(savedWh);
    const savedDoc = lsGet(LS_ACTIVE);
    if (savedDoc) void openDoc(savedDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the selected warehouse, and the active doc's scans, as they change.
  useEffect(() => { if (wh) lsSet(LS_WH, wh); }, [wh]);
  useEffect(() => {
    if (!active) return;
    lsSet(scanKey(active.header.doc_no), JSON.stringify({ scanned: [...scanned], reasons, moves }));
  }, [scanned, reasons, moves, active]);

  async function toggleExpand(doc_no: string) {
    if (expanded === doc_no) { setExpanded(null); return; }
    setExpanded(doc_no);
    if (!linesByDoc[doc_no]) {
      try {
        const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`);
        const data = (await res.json()) as { lines?: DraftLine[] };
        setLinesByDoc((p) => ({ ...p, [doc_no]: data.lines ?? [] }));
      } catch { /* ignore */ }
    }
  }

  async function openDoc(doc_no: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`);
      const data = (await res.json()) as { header?: DraftDoc; lines?: DraftLine[]; error?: string };
      if (!res.ok || !data.header) throw new Error(data.error ?? "ໂຫຼດບໍ່ສຳເລັດ");
      setActive({ header: data.header, lines: data.lines ?? [] });
      logDoc.current = { doc_no: data.header.doc_no, ref_doc: data.header.ref_doc_no ?? null, wh: data.header.warehouse_code ?? null };
      // Restore any scans stashed for this doc from a previous (unconfirmed) session.
      const saved = loadScan(doc_no);
      setScanned(new Set(saved.scanned));
      setReasons(saved.reasons);
      setMoves(saved.moves);
      lsSet(LS_ACTIVE, doc_no);
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (e) {
      // The stashed doc no longer opens (confirmed / cancelled elsewhere) — drop
      // the pointer so a refresh doesn't keep failing.
      lsDel(LS_ACTIVE);
      showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    }
    finally { setBusy(false); }
  }

  /** The bin a line is currently pointing at — the operator's override if they
   *  re-pointed it, otherwise the one the pick slip planned. */
  const effNode = useCallback(
    (l: DraftLine): NodeRef => moves[String(l.roworder)] ?? { rack: l.rack, location: l.location, pallet: l.pallet },
    [moves],
  );
  const isMoved = useCallback(
    (l: DraftLine) => nodeKey(effNode(l)) !== nodeKey({ rack: l.rack, location: l.location, pallet: l.pallet }),
    [effNode],
  );

  /** Scannable units of a line, narrowed to the bin it currently points at. */
  const unitsAt = useCallback(
    (l: DraftLine) => (l.units ?? []).filter((u) => nodeKey(u) === nodeKey(effNode(l))),
    [effNode],
  );

  // Map each scannable serial → its item. Built from the CURRENT bins, so
  // re-pointing a line immediately makes that bin's serials the valid ones.
  const serialOwner = useMemo(() => {
    const m = new Map<string, string>();
    if (active) for (const l of active.lines) for (const u of unitsAt(l)) {
      if (u.sn) m.set(u.sn.toUpperCase(), l.item_code);
      if (u.isn) m.set(u.isn.toUpperCase(), l.item_code);
    }
    return m;
  }, [active, unitsAt]);
  // Each scannable id (sn OR isn, uppercased) → its unit's BOTH ids + item. Lets
  // the screen show sn + isn per scanned unit and reject scanning the same unit
  // twice (once by sn, once by isn).
  const unitByScan = useMemo(() => {
    const m = new Map<string, { sn: string | null; isn: string | null; item_code: string }>();
    if (active) for (const l of active.lines) for (const u of unitsAt(l)) {
      const rec = { sn: u.sn, isn: u.isn, item_code: l.item_code };
      if (u.sn) m.set(u.sn.toUpperCase(), rec);
      if (u.isn) m.set(u.isn.toUpperCase(), rec);
    }
    return m;
  }, [active, unitsAt]);

  /** Re-point one line. Scans that belonged to the old bin are no longer valid
   *  units for this doc, so they are dropped — but never silently: throwing away
   *  work the operator already did needs an explicit yes. */
  function changeNode(l: DraftLine, opt: LocOption) {
    const planned = { rack: l.rack, location: l.location, pallet: l.pallet };
    const from = effNode(l);
    const target: NodeRef = { rack: opt.rack, location: opt.location, pallet: opt.pallet };
    if (nodeKey(target) === nodeKey(from)) return;

    // Which scans survive the move: still a unit of their item at one of the
    // doc's bins (this line's new bin, every other line's current bin).
    const stillValid = new Set<string>();
    for (const line of active?.lines ?? []) {
      const node = line.roworder === l.roworder ? target : effNode(line);
      for (const u of line.units ?? []) {
        if (nodeKey(u) !== nodeKey(node)) continue;
        if (u.sn) stillValid.add(u.sn.toUpperCase());
        if (u.isn) stillValid.add(u.isn.toUpperCase());
      }
    }
    const dropped = [...scanned].filter((s) => !stillValid.has(s));
    if (dropped.length > 0) {
      const preview = dropped.slice(0, 5).map((s) => `· ${unitByScan.get(s)?.isn ?? unitByScan.get(s)?.sn ?? s}`).join("\n");
      const more = dropped.length > 5 ? `\n… ແລະ ອີກ ${dropped.length - 5}` : "";
      const ok = window.confirm(
        `ປ່ຽນ location ຂອງ ${l.item_code}\n` +
          `ຈາກ  ${nodeLabel(from)}\n` +
          `ໄປ   ${nodeLabel(target)}\n\n` +
          `⚠ SN ທີ່ຍິງໄວ້ແລ້ວ ${dropped.length} ໜ່ວຍ ບໍ່ໄດ້ຢູ່ບ່ອນໃໝ່ ຈະຖືກຍົກເລີກ:\n${preview}${more}\n\n` +
          `ຕ້ອງການປ່ຽນແທ້ບໍ?`,
      );
      if (!ok) return; // controlled <select> snaps back to the current bin
    }

    setMoves((prev) => {
      const next = { ...prev };
      if (nodeKey(target) === nodeKey(planned)) delete next[String(l.roworder)];
      else next[String(l.roworder)] = target;
      return next;
    });
    if (dropped.length > 0) {
      setScanned((prev) => new Set([...prev].filter((s) => stillValid.has(s))));
      showToast("err", `ຍົກເລີກ ${dropped.length} SN ທີ່ຍິງຈາກ location ເກົ່າ`);
    }
    logEvent({
      event: "move",
      result: "ok",
      item_code: l.item_code,
      from_node: nodeLabel(from),
      to_node: nodeLabel(target),
      qty: dropped.length,
      note: dropped.length > 0 ? `ຍົກເລີກ SN ທີ່ຍິງແລ້ວ: ${dropped.join(", ").slice(0, 160)}` : "ຍັງບໍ່ໄດ້ຍິງ SN",
    });
  }
  const neededByItem = useMemo(() => {
    const m = new Map<string, number>();
    if (active) for (const l of active.lines) m.set(l.item_code, (m.get(l.item_code) ?? 0) + (Number.parseInt(l.qty, 10) || 0));
    return m;
  }, [active]);
  // Items that must be scanned = those the server marks serial_required (actually
  // serial-tracked in this warehouse + SN policy on), regardless of whether the
  // pick slip pre-selected serials. Falls back to the pre-selected serials for
  // older drafts served before serial_required existed.
  const serialItems = useMemo(
    () => new Set(active ? active.lines.filter((l) => l.serial_required ?? l.serials.length > 0).map((l) => l.item_code) : []),
    [active],
  );
  const scannedCount = (item: string) => [...scanned].filter((s) => serialOwner.get(s) === item).length;
  const totalNeeded = useMemo(() => [...serialItems].reduce((s, i) => s + (neededByItem.get(i) ?? 0), 0), [serialItems, neededByItem]);
  const allDone = totalNeeded > 0 && [...serialItems].every((i) => scannedCount(i) === (neededByItem.get(i) ?? 0));
  const noSerials = totalNeeded === 0;
  const totalScanned = [...serialItems].reduce((s, i) => s + scannedCount(i), 0);
  const shortItems = useMemo(() => [...serialItems].filter((i) => scannedCount(i) < (neededByItem.get(i) ?? 0)), [serialItems, scanned, neededByItem]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortAllHaveReason = shortItems.every((i) => reasons[i]);
  // Confirm allowed when: fully scanned, OR every short item has a reason and there is something to issue.
  const canConfirm = !busy && shortAllHaveReason && (allDone || noSerials || totalScanned > 0);

  function handleScan() {
    if (!active) return;
    const t = scan.trim().toUpperCase();
    if (!t) return;
    const owner = serialOwner.get(t);
    // Reject if the SAME physical unit was already scanned by its other id.
    const unit = unitByScan.get(t);
    const dupByUnit = !!unit && ((!!unit.sn && scanned.has(unit.sn.toUpperCase())) || (!!unit.isn && scanned.has(unit.isn.toUpperCase())));
    // The bin this scan counts against, for the audit trail.
    const ownerLine = owner ? active.lines.find((l) => l.item_code === owner) : undefined;
    const at = ownerLine ? effNode(ownerLine) : null;
    const base: ScanEvent = {
      event: "scan", scan_input: scan.trim(), item_code: owner ?? null,
      sn: unit?.sn ?? null, isn: unit?.isn ?? null,
      rack: at?.rack ?? null, location: at?.location ?? null, pallet: at?.pallet ?? null,
    };
    if (!owner) {
      showToast("err", `ISN ${scan} ບໍ່ມีໃนstock / ບໍ່ແມ່ນຂອງໃບนี้`);
      logEvent({ ...base, result: "not_found", note: "ບໍ່ມີໃນ stock ຫຼື ບໍ່ແມ່ນຂອງບ່ອນທີ່ເລືອກ" });
    } else if (scanned.has(t) || dupByUnit) {
      showToast("err", `${scan} ຍິງແລ້ວ`);
      logEvent({ ...base, result: "duplicate", note: dupByUnit && !scanned.has(t) ? "ໜ່ວຍດຽວກັນ ຍິງດ້ວຍ id ອື່ນແລ້ວ" : "ຍິງຊ້ຳ" });
    } else if (scannedCount(owner) >= (neededByItem.get(owner) ?? 0)) {
      showToast("err", `${owner}: ຍິງครບ ${neededByItem.get(owner)} ແລ້ວ`);
      logEvent({ ...base, result: "over_qty", note: `ເກີນຈຳນວນ ${neededByItem.get(owner)}` });
    } else {
      const isSub = !active.lines.some((l) => l.item_code === owner && l.serials.some((s) => s.toUpperCase() === t));
      setScanned((p) => new Set(p).add(t));
      showToast("ok", isSub ? `✓ ${scan} (ຕົວແທນ)` : `✓ ${scan}`);
      logEvent({ ...base, result: "ok", note: isSub ? "ຕົວແທນ (ບໍ່ຢູ່ໃນແຜນ pick)" : null });
    }
    setScan("");
    setTimeout(() => scanRef.current?.focus(), 20);
  }

  async function confirm() {
    if (!active) return;
    setBusy(true);
    // Push the scan trail first, so it is on record even if the issue then fails.
    await flushLog();
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(active.header.doc_no)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanned: [...scanned],
          notes: shortItems.map((i) => ({ item_code: i, reason_code: reasons[i] })),
          // Re-pointed lines — the pick slip is updated to these bins as it posts.
          moves: Object.entries(moves).map(([roworder, n]) => ({ roworder: Number(roworder), ...n })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; issue_code?: string; erp_doc?: string | null; partial?: boolean; moved?: number };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ຈ່າຍສຳເລັດ ${data.issue_code}${data.moved ? ` · ແກ້ location ${data.moved} ລາຍການ` : ""}${data.partial ? " · ส่วนที่เหลือยังค้างใน pending" : ""}`);
      // Issued serials are consumed — clear the stash (a partial remainder is
      // re-scanned fresh against the reduced pending).
      lsDel(scanKey(active.header.doc_no));
      lsDel(LS_ACTIVE);
      setActive(null);
      setMoves({});
      await loadDocs();
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  async function removeLine(item: string) {
    if (!active) return;
    if (!window.confirm(`ລົບ ${item} ອອກຈາກໃບ pick?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(active.header.doc_no)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove_item: item }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; emptied?: boolean };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", `ລົບ ${item} ແລ້ວ`);
      if (data.emptied) { setActive(null); await loadDocs(); }
      else await openDoc(active.header.doc_no);
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  async function cancelDraft(doc_no: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/movements/issue/draft/${encodeURIComponent(doc_no)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      showToast("ok", "ຍົກເລີກ pending ແລ້ວ");
      lsDel(scanKey(doc_no));
      lsDel(LS_ACTIVE);
      setActive(null);
      setMoves({});
      await loadDocs();
    } catch (e) { showToast("err", e instanceof Error ? e.message : "ບໍ່ສຳເລັດ"); }
    finally { setBusy(false); }
  }

  const inputCls = "rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

  return (
    <div className="space-y-4">
      {!active && (
        <>
          <section className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-400">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={inputCls}>
              {warehouses.length !== 1 && <option value="">— ເລືອກສາງ —</option>}
              {warehouses.map((w) => <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>)}
            </select>
          </section>
          <section className="space-y-2">
            {loading ? <div className="py-10 text-center text-sm text-zinc-400">ກຳລັງໂຫຼດ...</div>
            : !wh ? <div className="py-10 text-center text-sm text-zinc-400">ເລືອກສາງເພື່ອเริ่ม</div>
            : docs.length === 0 ? <div className="py-10 text-center text-sm text-zinc-400">ບໍ່ມີໃບ pick ລໍຖ້າຢືນຢັນ</div>
            : docs.map((d) => (
              <div key={d.doc_no} className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 transition hover:ring-red-300 dark:bg-zinc-900 dark:ring-zinc-800">
                <div className="flex w-full items-center gap-3 p-3.5">
                  <button type="button" onClick={() => toggleExpand(d.doc_no)} className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer">
                    <span className={`shrink-0 text-zinc-400 transition-transform ${expanded === d.doc_no ? "rotate-90" : ""}`}>›</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2"><span className="font-mono text-sm font-bold text-red-600 dark:text-red-400">{d.doc_no}</span>{d.ref_doc_no && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">ref {d.ref_doc_no}</span>}<span className="text-[11px] text-zinc-400">{ddmm(d.doc_date)} {d.doc_time}</span></span>
                      <span className="block truncate text-xs text-zinc-500">{d.customer_code ?? "—"}{d.remark ? ` · 🚜 ${d.remark}` : ""}</span>
                    </span>
                  </button>
                  <div className="text-right text-[11px] text-zinc-500"><div className="font-mono text-sm font-bold text-red-600 dark:text-red-400">ຄ້າງ {Number.parseFloat(d.total_qty) || 0}</div><div>{d.line_count} ລາຍການ{d.serial_count > 0 ? ` · ${d.serial_count} ISN` : ""}</div></div>
                  <a href={`/print/pick/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener" title="ພິມໃບ pick" className="shrink-0 rounded-lg p-2 text-zinc-400 ring-1 ring-zinc-200 hover:bg-slate-50 hover:text-slate-700 dark:ring-zinc-800">🖨</a>
                  <button type="button" onClick={() => openDoc(d.doc_no)} className="shrink-0 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-3 py-2 text-xs font-bold text-white shadow-sm hover:shadow active:scale-95 cursor-pointer">ຢືນຢັນຈ່າຍ →</button>
                </div>
                {expanded === d.doc_no && (
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    {!linesByDoc[d.doc_no] ? (
                      <div className="py-3 text-center text-xs text-zinc-400">ກຳລັງໂຫຼດ...</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800/50"><th className="px-4 py-2">ສິນຄ້າ</th><th className="px-4 py-2">ບ່ອນເກັບ</th><th className="px-4 py-2 text-right">ຄ້າງຈ່າຍ</th></tr></thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                          {linesByDoc[d.doc_no].map((l, i) => (
                            <tr key={`${l.item_code}-${i}`}>
                              <td className="px-4 py-2"><span className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400">{l.item_code}</span><div className="max-w-md truncate text-[13px] text-zinc-700 dark:text-zinc-300">{l.item_name}</div></td>
                              <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{[l.rack, l.location, l.pallet].filter(Boolean).join(" / ") || "—"}</td>
                              <td className="px-4 py-2 text-right font-mono font-bold tabular-nums text-red-600 dark:text-red-400">{l.qty} <span className="text-[10px] text-zinc-400">{l.unit_code}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {active && (() => {
        const pct = totalNeeded > 0 ? Math.min(100, Math.round((totalScanned / totalNeeded) * 100)) : 0;
        return (
        <section className="space-y-4 pb-24">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={() => { lsDel(LS_ACTIVE); setActive(null); }} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-500 hover:text-zinc-800">← ກັບ</button>
            <div className="flex items-center gap-2">
              <a href={`/print/pick/${encodeURIComponent(active.header.doc_no)}?auto=1`} target="_blank" rel="noopener" className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">🖨 ພິມໃບ pick</a>
              <button type="button" disabled={busy} onClick={() => cancelDraft(active.header.doc_no)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50 dark:bg-zinc-900 dark:text-rose-400 dark:ring-rose-900/50">ຍົກເລີກ pick</button>
            </div>
          </div>

          {/* header — doc + progress */}
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-100 bg-gradient-to-r from-red-50/70 to-transparent px-5 py-4 dark:border-zinc-800 dark:from-red-950/20">
              <div className="min-w-0">
                <div className="font-mono text-lg font-black tracking-tight text-zinc-900 dark:text-zinc-50">{active.header.doc_no}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                  {active.header.ref_doc_no && <span className="rounded-md bg-red-50 px-2 py-0.5 font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">ref {active.header.ref_doc_no}</span>}
                  {active.header.customer_code && <span>👤 {active.header.customer_code}</span>}
                  {active.header.remark && <span>🚜 {active.header.remark}</span>}
                </div>
              </div>
              {totalNeeded > 0 && (
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">ຍິງ SN ແລ້ວ</div>
                  <div className="font-mono text-3xl font-black leading-none text-red-600 dark:text-red-400">{totalScanned}<span className="text-lg text-zinc-300">/{totalNeeded}</span></div>
                  <div className="mt-1.5 h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${pct}%` }} /></div>
                </div>
              )}
            </div>
          </div>

          {/* big scan */}
          {totalNeeded > 0 && (
            <div className="rounded-2xl border border-red-200 bg-red-50/40 p-3.5 dark:border-red-900/40 dark:bg-red-950/15">
              <label className="mb-1 block text-[11px] font-bold text-red-700 dark:text-red-300">🔫 ຍິງ SN ຕົວຈິງ ທີ່ຈ່າຍ ແລ້ວ Enter</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input ref={scanRef} type="text" autoFocus value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleScan(); } }} placeholder="scan SN / ISN …" className="w-full rounded-lg border border-red-300 bg-white py-2.5 pl-9 pr-3 text-sm font-mono outline-none focus:ring-2 focus:ring-red-500/30 dark:bg-zinc-950 dark:border-red-900/50" />
                </div>
                <button type="button" onClick={handleScan} className="rounded-lg bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-700">ຍິງ</button>
              </div>
            </div>
          )}

          {/* items */}
          <div className="space-y-3">
            {[...active.lines]
              .sort((a, b) => nodeLabel(effNode(a)).localeCompare(nodeLabel(effNode(b))))
              .map((l, i) => {
                const node = effNode(l);
                const moved = isMoved(l);
                const options = l.loc_options ?? [];
                // The planned bin may itself be empty now — keep it selectable so
                // the dropdown always has the line's current value.
                const hasCurrent = options.some((o) => nodeKey(o) === nodeKey(node));
                const need = Number.parseInt(l.qty, 10) || 0;
                const isSer = serialItems.has(l.item_code);
                const got = isSer ? scannedCount(l.item_code) : need;
                const lp = need > 0 ? Math.min(100, Math.round((got / need) * 100)) : 0;
                const short = isSer && got < (neededByItem.get(l.item_code) ?? 0);
                // The scanned units for this item, each with BOTH sn + isn resolved
                // (so the operator can verify a dual-serial brand has both).
                const scannedUnits = [...scanned]
                  .filter((sc) => serialOwner.get(sc) === l.item_code)
                  .map((sc) => {
                    const u = unitByScan.get(sc);
                    return { key: sc, sn: u?.sn ?? (u ? null : sc), isn: u?.isn ?? null, sub: !l.serials.some((x) => x.toUpperCase() === sc) };
                  });
                return (
                  <div key={i} className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-zinc-900 ${got >= need && need > 0 ? "border-emerald-300 dark:border-emerald-900/50" : "border-zinc-200 dark:border-zinc-800"}`}>
                    <div className="flex items-start justify-between gap-2 p-4">
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-zinc-400">{l.item_code}{isSer && <span className="ml-1.5 rounded bg-aqua-100 px-1 text-[9px] font-bold text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300">SN</span>}</div>
                        <div className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">{l.item_name}</div>
                        {/* ບ່ອນຈັດເກັບ — ແກ້ໄດ້ ຖ້າໄປເອົາຂອງຕົວຈິງບ່ອນອື່ນ (ທາງຕັນ / ຈັບບໍ່ອອກ) */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="text-[10px] font-bold text-zinc-400">⊙ ບ່ອນ</span>
                          <select
                            value={nodeKey(node)}
                            disabled={busy}
                            onChange={(e) => {
                              const opt = options.find((o) => nodeKey(o) === e.target.value);
                              if (opt) changeNode(l, opt);
                            }}
                            title="ປ່ຽນ location ຕາມບ່ອນທີ່ໄປເອົາຂອງຕົວຈິງ"
                            className={`max-w-[320px] rounded-lg px-2 py-1 font-mono text-[11px] font-bold ring-1 outline-none focus:ring-2 focus:ring-red-500/30 disabled:opacity-50 ${
                              moved
                                ? "bg-amber-50 text-amber-800 ring-amber-300 dark:bg-amber-950/30 dark:text-amber-200 dark:ring-amber-900/50"
                                : "bg-zinc-50 text-zinc-700 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800"
                            }`}
                          >
                            {!hasCurrent && <option value={nodeKey(node)}>{nodeLabel(node)} · ບໍ່ມີ stock ⚠</option>}
                            {options.map((o) => (
                              <option key={nodeKey(o)} value={nodeKey(o)}>
                                {nodeLabel(o)} · ມີ {o.qty}{isSer ? ` · SN ${o.sn_qty}${o.sn_qty === 0 ? " ⚠" : ""}` : ""}
                              </option>
                            ))}
                          </select>
                          {moved && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300" title={`ແຜນເດີມ: ${nodeLabel({ rack: l.rack, location: l.location, pallet: l.pallet })}`}>
                              ແກ້ location · ເດີມ {nodeLabel({ rack: l.rack, location: l.location, pallet: l.pallet })}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isSer ? (() => {
                          const remain = Math.max(0, need - got);
                          const done = remain === 0 && need > 0;
                          return (
                            <div className="text-right">
                              <div className={`font-mono text-lg font-black ${done ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{done ? "✓ 0" : remain}</div>
                              <div className="text-[10px] text-zinc-400">{done ? "ຍິງຄົບ" : "ຍັງເຫຼືອຍິງ"}</div>
                            </div>
                          );
                        })() : (
                          <div className="text-right"><div className="font-mono text-lg font-black text-zinc-700 dark:text-zinc-200">{l.qty}</div><div className="text-[10px] text-zinc-400">{l.unit_code} · ຈ່າຍ</div></div>
                        )}
                        <button type="button" disabled={busy} onClick={() => removeLine(l.item_code)} title="ລົບ ออกจากใบ pick" className="rounded p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-500 disabled:opacity-40 dark:hover:bg-rose-950/30">🗑</button>
                      </div>
                    </div>
                    {isSer && (
                      <>
                        <div className="px-4"><div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"><div className={`h-full rounded-full transition-all ${got >= need && need > 0 ? "bg-emerald-500" : "bg-amber-400"}`} style={{ width: `${lp}%` }} /></div></div>
                        <div className="p-4 pt-3">
                          <div className="mb-1.5 flex items-center gap-2">
                            <span className="text-[10px] font-bold text-zinc-500">ຍິງ {got} / {need}</span>
                            {l.dual_required && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">ຕ້ອງມີ SN + ISN ຄົບ</span>}
                          </div>
                          {scannedUnits.length > 0 ? (
                            <div className="overflow-x-auto rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
                              <table className="w-full table-fixed text-xs tabular-nums">
                                <colgroup><col className="w-[46%]" /><col className="w-[34%]" /><col className="w-[20%]" /></colgroup>
                                <thead><tr className="bg-zinc-50 text-left text-[9px] font-semibold uppercase tracking-wide text-zinc-400 dark:bg-zinc-800/50"><th className="px-3 py-1.5 font-semibold">SN (ໂຮງງານ)</th><th className="px-3 py-1.5 font-semibold">ISN (ບໍລິສັດ)</th><th className="px-3 py-1.5 text-right font-semibold">ສະຖານະ</th></tr></thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                                  {scannedUnits.map((u) => {
                                    const missing = !!l.dual_required && (!u.sn || !u.isn);
                                    return (
                                      <tr key={u.key} className={missing ? "bg-rose-50 dark:bg-rose-950/20" : ""}>
                                        <td className="truncate px-3 py-1.5 font-mono text-zinc-800 dark:text-zinc-200">{u.sn ?? <span className="text-rose-500">— ຂາດ —</span>}</td>
                                        <td className="truncate px-3 py-1.5 font-mono text-zinc-800 dark:text-zinc-200">{u.isn ?? <span className="text-rose-500">— ຂາດ —</span>}</td>
                                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                          {missing && <span className="mr-1 text-[9px] font-bold text-rose-600">ບໍ່ຄົບ</span>}
                                          {u.sub && <span className="mr-1 text-[9px] text-amber-600">ຕัวแทน</span>}
                                          <button type="button" onClick={() => {
                                            setScanned((p) => { const n = new Set(p); n.delete(u.key); return n; });
                                            logEvent({ event: "unscan", result: "ok", item_code: l.item_code, scan_input: u.key, sn: u.sn, isn: u.isn, rack: node.rack, location: node.location, pallet: node.pallet });
                                          }} title="ຍົກເລີກ ການຍິງນີ້" className="align-middle text-zinc-300 hover:text-rose-500">✕</button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-[11px] text-zinc-400">ຍັງບໍ່ໄດ້ຍິງ</div>
                          )}
                          {short && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[11px] font-bold text-amber-600">ขาด {(neededByItem.get(l.item_code) ?? 0) - got} →</span>
                              <select value={reasons[l.item_code] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [l.item_code]: e.target.value }))}
                                className="rounded-lg border border-amber-300 bg-amber-50/40 px-2 py-1 text-xs text-zinc-700 dark:bg-amber-950/20 dark:text-amber-200">
                                <option value="">ເຫດຜລ (ຖ້າຈ່າຍບໍ່ຄົບ)…</option>
                                {MOVE_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                              </select>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </div>

          {/* audit trail of this confirm session — scans, rejects, location changes */}
          <ScanLogPanel doc={active.header.doc_no} />

          {/* sticky footer */}
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur md:left-64 dark:border-zinc-800 dark:bg-zinc-950/95">
            <div className="flex w-full items-center justify-between gap-3">
              <span className="text-sm font-bold text-zinc-600 dark:text-zinc-300">
                {totalNeeded > 0 ? `${totalScanned}/${totalNeeded} ຍິງແລ້ວ` : " พร้อมจ่าย"}{shortItems.length > 0 ? " · ຈ່າຍບໍ່ຄົບ" : ""}
                {Object.keys(moves).length > 0 && (
                  <span className="ml-2 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    ແກ້ location {Object.keys(moves).length} ລາຍການ — ໃບ pick ຈະອັບເດດຕອນບັນທຶກ
                  </span>
                )}
              </span>
              <button type="button" onClick={confirm} disabled={!canConfirm} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-orange-600 px-7 py-3 text-sm font-bold text-white shadow-md transition hover:shadow-lg disabled:opacity-50">
                <CheckIcon className="h-4 w-4" />{busy ? "ກຳລັງຈ່າຍ..." : shortItems.length > 0 ? "ຢືນຢັນຈ່າຍ (ບໍ່ຄົບ)" : "ຢືນຢັນຈ່າຍ"}
              </button>
            </div>
          </div>
        </section>
        );
      })()}

      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div className={`flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-xl ${toast.k === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>{toast.k === "ok" ? <CheckIcon className="h-4 w-4" /> : <AlertIcon className="h-4 w-4" />}{toast.t}</div>
        </div>
      )}
    </div>
  );
}

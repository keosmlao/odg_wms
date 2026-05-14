"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "./BarcodeScanner";
import {
  enqueue,
  flush,
  getForLabel,
  remove as removeFromQueue,
} from "@/lib/offline-queue";
import { lineConflictsSlot } from "@/lib/stocktake-count-slot";
import type { CountedLine, LocationOption, RackOption } from "./page";

type ItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  balance_qty: string | null;
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default function Counter({
  sessionId,
  labelId,
  labelCode,
  labelNote: _labelNote,
  labelRackCode,
  labelLocationCode,
  sessionCode,
  sessionName,
  whCode,
  whName,
  sessionOpen,
  sessionStatus,
  blind,
  canRevealBalance,
  initialLines,
  racks,
  locations,
}: {
  sessionId: number;
  labelId: number;
  labelCode: string;
  labelNote: string | null;
  labelRackCode: string | null;
  labelLocationCode: string | null;
  sessionCode: string;
  sessionName: string | null;
  whCode: string;
  whName: string | null;
  sessionOpen: boolean;
  sessionStatus: "open" | "pending_approval" | "closed";
  blind: boolean;
  canRevealBalance: boolean;
  initialLines: CountedLine[];
  racks: RackOption[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<CountedLine[]>(initialLines);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<ItemHit[]>([]);
  const [selected, setSelected] = useState<ItemHit | null>(null);
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [rackCode, setRackCode] = useState<string>(labelRackCode ?? "");
  const [locationCode, setLocationCode] = useState<string>(labelLocationCode ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [showReEntryWarning, setShowReEntryWarning] = useState(initialLines.length > 0);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingQty, setEditingQty] = useState("");
  const showBalance = !blind;
  const labelPinned = !!labelRackCode || !!labelLocationCode;

  const qtyInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const availableLocations = useMemo(
    () => (rackCode ? locations.filter((l) => l.rack_code === rackCode) : locations),
    [locations, rackCode]
  );

  useEffect(() => {
    if (rackCode && locationCode && !locations.find((l) => l.code === locationCode && l.rack_code === rackCode)) {
      setLocationCode("");
    }
  }, [rackCode, locationCode, locations]);

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const queued = getForLabel(labelId);
    if (queued.length > 0) {
      setPendingCount(queued.length);
      setLines((prev) => {
        const existingIds = new Set(prev.map((l) => l.line_id));
        const restored: CountedLine[] = queued
          .filter((q) => !existingIds.has(q.local_id))
          .map((q) => ({
            line_id: q.local_id,
            item_code: q.payload.item_code,
            item_name: q.payload.item_name,
            unit_code: q.payload.unit_code,
            qty: String(q.payload.qty),
            note: q.payload.note ?? null,
            rack_code: q.payload.rack_code,
            location_code: q.payload.location_code,
            counted_at: q.queued_at,
          }));
        return [...restored, ...prev];
      });
    }

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [labelId]);

  useEffect(() => {
    if (!online || pendingCount === 0) return;
    let cancelled = false;
    (async () => {
      const result = await flush();
      if (cancelled) return;
      if (result.succeeded.length > 0) {
        setLines((prev) => {
          let updated = [...prev];
          for (const s of result.succeeded) {
            const idx = updated.findIndex((l) => l.line_id === s.local_id);
            if (idx >= 0 && s.server_line) updated[idx] = s.server_line as CountedLine;
          }
          return updated;
        });
      }
      setPendingCount(getForLabel(labelId).length);
      if (result.succeeded.length > 0) showToast("ok", `Sync ສຳເລັດ ${result.succeeded.length} ລາຍການ`);
      if (result.failed.length > 0) showToast("err", `Sync ບໍ່ສຳເລັດ ${result.failed.length} ລາຍການ`);
    })();
    return () => { cancelled = true; };
  }, [online, pendingCount, labelId]);

  useEffect(() => {
    if (search.trim().length === 0) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const params = new URLSearchParams({ session_id: String(sessionId), q: search.trim() });
        const res = await fetch(`/api/stocktake/items/search?${params}`);
        const data = (await res.json()) as { items?: ItemHit[] };
        setHits(data.items ?? []);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, sessionId]);

  function vibrate(pattern: number | number[]) {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  }
  function showToast(kind: "ok" | "err", text: string) {
    setToast({ kind, text });
    vibrate(kind === "ok" ? 30 : [60, 30, 60]);
    setTimeout(() => setToast(null), 2500);
  }

  async function toggleBlind() {
    if (toggling) return;
    setToggling(true);
    try {
      const res = await fetch(`/api/stocktake/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", blind: !blind }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setToggling(false);
    }
  }

  function selectHit(hit: ItemHit) {
    setSelected(hit);
    setHits([]);
    setSearch("");

    setTimeout(() => qtyInputRef.current?.focus(), 50);
  }

  function handleScan(text: string) {
    setScannerOpen(false);


    const code = text.trim();
    setSelected(null);
    setSearch(code);
    vibrate(50);


    setTimeout(() => searchInputRef.current?.focus(), 50);
  }

  function clearSelection() {
    setSelected(null);
    setSearch("");
    setQty("");
    setNote("");
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }
  async function addLine(e?: React.FormEvent) {
    e?.preventDefault();
    if (!selected) { showToast("err", "ກະລຸນາເລືອກສິນຄ້າ"); return; }
    const q = Number.parseFloat(qty);
    if (!Number.isFinite(q) || q === 0) { showToast("err", "ກະລຸນາໃສ່ຈຳນວນ"); return; }

    const payload = {
      item_code: selected.item_code,
      item_name: selected.item_name,
      unit_code: selected.unit_code,
      qty: q,
      note,
      rack_code: rackCode || null,
      location_code: locationCode || null,
    };

    const dupMsg =
      "ສິນຄ້ານີ້ນັບໃນຕຳແໜ່ງນີ້ແລ້ວ — ແກ້ຈຳນວນຢູ່ລາຍການເກົ່າ ຫຼືລຶບກ່ອນ";
    const slotLine = (row: CountedLine) => ({
      item_code: row.item_code,
      rack_code: row.rack_code,
      location_code: row.location_code,
    });
    if (
      lines.some((row) =>
        lineConflictsSlot(slotLine(row), payload.item_code, payload.rack_code, payload.location_code),
      )
    ) {
      showToast("err", dupMsg);
      return;
    }
    for (const q of getForLabel(labelId)) {
      if (
        lineConflictsSlot(
          {
            item_code: q.payload.item_code,
            rack_code: q.payload.rack_code,
            location_code: q.payload.location_code,
          },
          payload.item_code,
          payload.rack_code,
          payload.location_code,
        )
      ) {
        showToast("err", dupMsg);
        return;
      }
    }

    if (!online) {
      const queued = enqueue({ label_id: labelId, session_id: sessionId, payload });
      const localLine: CountedLine = {
        line_id: queued.local_id,
        item_code: payload.item_code,
        item_name: payload.item_name,
        unit_code: payload.unit_code,
        qty: String(q),
        note: payload.note ?? null,
        rack_code: payload.rack_code,
        location_code: payload.location_code,
        counted_at: queued.queued_at,
      };
      setLines((prev) => [localLine, ...prev]);
      setPendingCount((c) => c + 1);
      showToast("ok", `ບັນທຶກແລ້ວ (+${formatQty(q)})`);
      clearSelection();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/stocktake/labels/${labelId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; line?: CountedLine };
      if (!res.ok || !data.ok || !data.line) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setLines((prev) => [data.line!, ...prev]);
      showToast("ok", `ບັນທຶກແລ້ວ (+${formatQty(q)})`);
      clearSelection();
    } catch (err) {
      showToast("err", err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteLine(lineId: number) {
    if (!confirm("ຢືນຢັນການລຶບລາຍການນີ້?")) return;
    if (lineId < 0) {
      removeFromQueue(lineId);
      setLines((prev) => prev.filter((l) => l.line_id !== lineId));
      setPendingCount((c) => Math.max(0, c - 1));
      showToast("ok", "ລຶບແລ້ວ");
      return;
    }
    try {
      const res = await fetch(`/api/stocktake/lines/${lineId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setLines((prev) => prev.filter((l) => l.line_id !== lineId));
      showToast("ok", "ລຶບແລ້ວ");
    } catch (err) {
      showToast("err", "ບໍ່ສາມາດລຶບໄດ້");
    }
  }

  function startEdit(line: CountedLine) {
    if (line.line_id < 0) {
      showToast("err", "ລາຍການນີ້ຍັງບໍ່ໄດ້ sync — ກະລຸນາລໍຖ້າ online");
      return;
    }
    setEditingId(line.line_id);
    setEditingQty(line.qty);
  }

  async function saveEdit(lineId: number) {
    const q = Number.parseFloat(editingQty);
    if (!Number.isFinite(q)) { showToast("err", "ຈຳນວນບໍ່ຖືກຕ້ອງ"); return; }
    try {
      const res = await fetch(`/api/stocktake/lines/${lineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qty: q }),
      });
      if (!res.ok) throw new Error("Update failed");
      setLines((prev) => prev.map((l) => (l.line_id === lineId ? { ...l, qty: String(q) } : l)));
      setEditingId(null);
      showToast("ok", "ແກ້ໄຂແລ້ວ");
    } catch (err) {
      showToast("err", "ບໍ່ສາມາດແກ້ໄຂໄດ້");
    }
  }

  const totalQty = useMemo(() => lines.reduce((s, l) => s + (Number.parseFloat(l.qty) || 0), 0), [lines]);

  const sessionStatusLabel =
    sessionStatus === "open" ? "ເປີດ" : sessionStatus === "pending_approval" ? "ລໍຖ້າ" : "ປິດ";

  return (
    <div className="flex min-h-[100dvh] flex-col rounded-2xl bg-gradient-to-b from-white to-slate-50/95 font-sans text-slate-900 selection:bg-indigo-100 dark:from-slate-900 dark:to-slate-950 dark:text-slate-100 dark:selection:bg-indigo-950 dark:selection:text-indigo-100 lg:min-h-0 lg:rounded-xl">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80 lg:static lg:shrink-0 lg:bg-white dark:lg:bg-slate-900">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:gap-4 lg:max-w-none lg:px-8 lg:py-4">
          <Link
            href={`/stocktake/${sessionId}`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 lg:h-10 lg:w-10"
            aria-label="ກັບໄປຮອບກວດນັບ"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold tracking-tight lg:text-xl">{labelCode}</h1>
            <p className="truncate text-[10px] font-medium uppercase tracking-wider text-slate-500 lg:text-xs lg:normal-case lg:tracking-normal">
              <span className="lg:hidden">{sessionCode} • {whCode}</span>
              <span className="hidden lg:inline">
                {sessionName ?? sessionCode}
                {whName ? ` · ${whCode} (${whName})` : ` · ${whCode}`}
              </span>
            </p>
          </div>
          <span
            className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 lg:inline-flex ${
              sessionOpen
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:ring-emerald-900"
                : "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700"
            }`}
          >
            ● {sessionStatusLabel}
            {blind && " · Blind"}
          </span>
          <div className="shrink-0 text-right">
            <div className="text-xl font-black tabular-nums text-indigo-600 dark:text-indigo-400 lg:text-2xl">{formatQty(totalQty)}</div>
            <div className="text-[10px] font-bold uppercase text-slate-400">{lines.length} ລາຍການ</div>
          </div>
        </div>

        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 pb-3 lg:max-w-none lg:px-8 lg:pb-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {labelPinned && (
              <span className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400">
                <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={3}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                <span className="truncate">{labelRackCode}{labelLocationCode && ` / ${labelLocationCode}`}</span>
              </span>
            )}
            <button
              type="button"
              onClick={toggleBlind}
              disabled={!canRevealBalance || !sessionOpen || toggling}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-400 lg:py-1.5"
            >
              {blind ? "🙈 Blind" : "👁️ ສະແດງຍອດ"}
              {canRevealBalance && <span className="text-indigo-500 underline decoration-indigo-500/30">ປ່ຽນ</span>}
            </button>
          </div>
          {!online && (
            <div className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold text-rose-600 dark:text-rose-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
              OFFLINE
            </div>
          )}
        </div>
      </header>

      <main
        className={
          sessionOpen
            ? "mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-5 pb-28 sm:py-6 sm:pb-32 lg:max-w-none lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,400px)] lg:gap-0 lg:px-8 lg:py-6 lg:pb-8 xl:grid-cols-[minmax(0,1fr)_420px]"
            : "mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-5 pb-10 sm:px-6 sm:py-6 lg:max-w-3xl lg:px-8"
        }
      >
        {sessionOpen && (
        <div className="min-w-0 lg:border-r lg:border-slate-200 lg:pr-8 dark:lg:border-slate-800">
        {showReEntryWarning && (
          <div className="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/30 lg:mb-6">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}><path d="M12 9v4m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 18c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <div className="flex-1 text-xs font-medium text-amber-800 dark:text-amber-200">
              <p className="font-bold">ປ້າຍນີ້ມີຂໍ້ມູນແລ້ວ {initialLines.length} ລາຍການ</p>
              <p className="mt-0.5 opacity-80">ການນັບໃໝ່ຈະຖືກເພີ່ມຕໍ່ທ້າຍ. ກວດສອບລາຍການເກົ່າຢູ່ດ້ານຂ້າງ.</p>
            </div>
            <button type="button" onClick={() => setShowReEntryWarning(false)} className="text-amber-400 hover:text-amber-600">✕</button>
          </div>
        )}

          <div className="space-y-5 lg:space-y-5">
            <div className="group relative isolate z-20 mb-1 sm:mb-2">
              <div className="pointer-events-none absolute inset-y-0 left-4 z-10 flex items-center sm:left-5">
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400 group-focus-within:text-indigo-500" fill="none" stroke="currentColor" strokeWidth={2.5}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); if (selected) setSelected(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (!selected && hits.length === 1) selectHit(hits[0]);
                    else if (selected && qty) addLine();
                  }
                }}
                placeholder="ຄົ້ນຫາລະຫັດສິນຄ້າ ຫຼື COM..."
                className="relative z-0 h-14 w-full rounded-2xl border-none bg-white pl-11 pr-[3.25rem] text-base font-medium shadow-lg shadow-slate-200/40 ring-1 ring-slate-200 transition-all focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 sm:h-16 sm:rounded-3xl sm:pl-12 sm:pr-20 sm:text-lg sm:shadow-xl sm:shadow-slate-200/50 dark:bg-slate-900 dark:shadow-none dark:ring-slate-800 lg:h-14 lg:rounded-xl lg:pr-14 lg:text-sm lg:shadow-sm"
              />
              <button
                type="button"
                title="ສະແກນບາໂຄດ"
                onClick={() => setScannerOpen(true)}
                className="absolute inset-y-1.5 right-1.5 z-20 flex w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/25 transition active:scale-95 active:bg-indigo-700 sm:inset-y-2 sm:right-2 sm:w-12 sm:rounded-2xl sm:shadow-lg lg:inset-y-1.5 lg:w-11 lg:rounded-lg"
        >
                <svg viewBox="0 0 24 24" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2m-10 0H5a2 2 0 0 1-2-2v-2M7 12h10M8 8h.01M16 8h.01M8 16h.01M16 16h.01"/></svg>
              </button>

              {(hits.length > 0 || searching) && !selected && (
                <div className="absolute inset-x-0 top-[calc(100%+0.375rem)] z-[60] max-h-80 overflow-auto rounded-3xl bg-white p-2 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
                  {searching && <div className="p-4 text-center text-sm font-medium text-slate-400">ກຳລັງຄົ້ນຫາ...</div>}
                  {hits.map((h) => (
                    <button
                      key={h.item_code}
                      onClick={() => selectHit(h)}
                      className="flex w-full items-center gap-4 rounded-2xl p-4 text-left transition hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-800 dark:active:bg-slate-800/50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">{h.item_code}</div>
                        <div className="truncate text-sm font-medium">{h.item_name}</div>
        </div>
                      <div className="text-right">
                        {showBalance && h.balance_qty !== null && (
                          <div className="font-mono text-sm font-black">{formatQty(h.balance_qty)}</div>
      )}
                        <div className="text-[10px] font-bold text-slate-400">{h.unit_code}</div>
    </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!labelPinned && (racks.length > 0 || locations.length > 0) && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <select value={rackCode} onChange={(e) => setRackCode(e.target.value)} className="min-h-11 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-bold shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:ring-slate-800 sm:rounded-2xl sm:py-2 lg:min-h-0">
                  <option value="">RACK: —</option>
                  {racks.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
                </select>
                <select value={locationCode} onChange={(e) => setLocationCode(e.target.value)} className="min-h-11 flex-1 rounded-xl bg-white px-3 py-2.5 text-xs font-bold shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:ring-slate-800 sm:rounded-2xl sm:py-2 lg:min-h-0">
                  <option value="">LOC: —</option>
                  {availableLocations.map((l) => <option key={l.code} value={l.code}>{l.code}</option>)}
                </select>
              </div>
            )}

            {selected && (
              <div className="animate-in fade-in slide-in-from-bottom-4 rounded-2xl bg-indigo-600 p-5 text-white shadow-xl shadow-indigo-500/20 dark:bg-indigo-500 sm:rounded-3xl sm:p-6 lg:rounded-xl lg:p-5">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <h2 className="font-mono text-xs font-bold opacity-80">{selected.item_code}</h2>
                    <h3 className="mt-1 truncate text-lg font-bold leading-tight">{selected.item_name}</h3>
                  </div>
                  <button onClick={clearSelection} className="rounded-full bg-white/20 p-2 transition hover:bg-white/30">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>

                <div className="my-4 sm:my-6 lg:my-4">
                  <div className="relative">
                    <input
                      ref={qtyInputRef}
                      type="number"
                      inputMode="decimal"
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-transparent text-center font-mono text-5xl font-black tabular-nums tracking-tighter text-white placeholder:text-white/30 focus:outline-none sm:text-6xl md:text-7xl lg:text-5xl xl:text-6xl"
                    />
                    <div className="mt-2 text-center text-xs font-bold uppercase tracking-widest opacity-80">{selected.unit_code ?? "ຈຳນວນ"}</div>
                  </div>
                </div>

                {showBalance && selected.balance_qty !== null && (
                  <div className="rounded-2xl bg-black/10 px-4 py-3 text-center text-xs font-bold">
                    SML Balance: {formatQty(selected.balance_qty)} {selected.unit_code}
                  </div>
                )}

                <div className="mt-3 sm:mt-4">
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="ບັນທຶກເພີ່ມເຕີມ..."
                    className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-medium placeholder:text-white/50 focus:bg-white/20 focus:outline-none sm:rounded-2xl"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => addLine()}
                  disabled={submitting || !qty}
                  className="mt-5 hidden h-12 w-full items-center justify-center rounded-xl bg-white text-base font-black text-indigo-700 shadow-md transition hover:bg-slate-50 disabled:opacity-50 dark:bg-white dark:text-indigo-800 lg:flex"
                >
                  {submitting ? "ກຳລັງບັນທຶກ..." : "ຢືນຢັນການນັບ"}
                </button>
              </div>
            )}
          </div>
        </div>
        )}

        <aside
          className={
            sessionOpen
              ? "mt-8 min-h-0 lg:mt-0 lg:flex lg:flex-col lg:pl-8 lg:pt-0"
              : "mt-2 min-h-0 w-full lg:mt-0"
          }
        >
          <div className="lg:sticky lg:top-0 lg:max-h-[min(100dvh-10rem,52rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-4 lg:pt-1">
          <div className="mb-3 flex items-center justify-between px-1 sm:px-2 lg:px-0">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-400">ລາຍການທີ່ນັບແລ້ວ</h2>
            {pendingCount > 0 && (
              <span className="text-[10px] font-black uppercase text-amber-500 animate-pulse">ລໍຖ້າ sync {pendingCount}...</span>
            )}
          </div>

          <div className="space-y-3">
            {lines.length === 0 ? (
              <div className="rounded-3xl border-2 border-dashed border-slate-200 py-12 text-center dark:border-slate-800">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>
                </div>
                <p className="text-sm font-bold text-slate-400">ຍັງບໍ່ມີການນັບ</p>
              </div>
            ) : (
              lines.map((l) => (
                <div key={l.line_id} className="group relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition hover:shadow-md dark:bg-slate-900 dark:ring-slate-800">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{l.item_code}</span>
                        {l.line_id < 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[8px] font-black text-amber-700 dark:bg-amber-900/40">OFFLINE</span>}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-bold">{l.item_name}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-slate-400">
                        {(l.rack_code || l.location_code) && (
                          <span className="flex items-center gap-1">📍 {l.rack_code ?? "—"} / {l.location_code ?? "—"}</span>
                        )}
                        {l.note && <span className="truncate italic">“{l.note}”</span>}
                      </div>
                    </div>

                    <div className="text-right">
                      {editingId === l.line_id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            autoFocus
                            value={editingQty}
                            onChange={(e) => setEditingQty(e.target.value)}
                            className="w-20 rounded-xl bg-slate-100 px-2 py-1 text-right font-mono text-sm font-bold focus:ring-2 focus:ring-indigo-500 dark:bg-slate-800"
                          />
                          <button onClick={() => saveEdit(l.line_id)} className="rounded-lg bg-indigo-600 p-1.5 text-white">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7"/></svg>
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={!sessionOpen}
                          onClick={() => startEdit(l)}
                          className="group/qty text-right transition active:scale-95 disabled:opacity-100"
                        >
                          <div className="font-mono text-lg font-black leading-none text-slate-900 group-hover/qty:text-indigo-600 dark:text-white dark:group-hover/qty:text-indigo-400">{formatQty(l.qty)}</div>
                          <div className="text-[10px] font-bold text-slate-400">{l.unit_code}</div>
                        </button>
                      )}
                    </div>

                    {sessionOpen && editingId !== l.line_id && (
                      <button
                        onClick={() => deleteLine(l.line_id)}
                        className="ml-2 flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-500/10"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5}><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          </div>
        </aside>
      </main>

      {sessionOpen && selected && (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-full duration-300 lg:hidden">
          <div className="mx-auto max-w-2xl">
            <button
              onClick={() => addLine()}
              disabled={submitting || !qty}
              className="group relative flex h-16 w-full items-center justify-center overflow-hidden rounded-3xl bg-indigo-600 text-lg font-black tracking-wide text-white shadow-2xl shadow-indigo-600/40 transition-all active:scale-[0.98] disabled:opacity-50 dark:bg-indigo-500"
            >
              <span className="relative z-10">{submitting ? "ກຳລັງບັນທຶກ..." : "ຢືນຢັນການນັບ"}</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-500 group-hover:translate-x-full" />
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed left-1/2 top-24 z-[100] -translate-x-1/2 animate-in fade-in zoom-in duration-300`}>
          <div className={`flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white shadow-2xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}>
            {toast.kind === "ok" ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={4}><path d="M5 13l4 4L19 7"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={4}><path d="M18 6 6 18M6 6l12 12"/></svg>
            )}
            {toast.text}
          </div>
        </div>
      )}

      {scannerOpen && (
        <BarcodeScanner
          onDetect={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

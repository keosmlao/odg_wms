"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import BarcodeScanner from "@/components/BarcodeScanner";
import {
  enqueue,
  flush,
  getForLabel,
  remove as removeFromQueue,
} from "@/lib/offline-queue";
import { lineConflictsSlot } from "@/lib/stocktake-count-slot";
import {
  CheckIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  MapPinIcon,
  SearchIcon,
} from "@/components/ui/Icons";
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

  const statusLabel =
    sessionStatus === "open" ? "ເປີດ" : sessionStatus === "pending_approval" ? "ລໍຖ້າ" : "ປິດ";
  const statusChip =
    sessionStatus === "open"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900"
      : sessionStatus === "pending_approval"
        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900"
        : "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700";

  return (
    <div className="-mx-6 -my-6 flex min-h-[calc(100dvh-3.5rem)] flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 lg:min-h-0">
      {/* ========== STICKY HEADER ========== */}
      <header className="sticky top-14 z-30 border-b border-zinc-200/70 bg-white/85 backdrop-blur-md dark:border-zinc-800/70 dark:bg-zinc-950/85">
        <div className="flex w-full items-center gap-2 px-3 py-2 sm:px-4">
          <Link
            href={`/stocktake/${sessionId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 transition hover:bg-zinc-200 active:scale-95 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            aria-label="ກັບໄປຮອບກວດນັບ"
          >
            <ChevronRightIcon className="h-4 w-4 rotate-180" />
          </Link>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-base font-bold leading-tight tracking-tight sm:text-lg">
                {labelCode}
              </h1>
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1 ${statusChip}`}
              >
                ● {statusLabel}
                {blind && " ·B"}
              </span>
              {!online && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-900">
                  <span className="h-1 w-1 animate-pulse rounded-full bg-rose-500" />
                  OFF
                </span>
              )}
            </div>
            <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400 sm:text-xs">
              {sessionCode} · {whCode}
              {whName ? ` (${whName})` : ""}
              {sessionName && ` · ${sessionName}`}
            </p>
          </div>

          <div className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-right text-white shadow-sm shadow-brand-500/25">
            <div className="font-mono text-base font-black leading-none tabular-nums sm:text-lg">
              {formatQty(totalQty)}
            </div>
            <div className="mt-0.5 text-[8px] font-bold uppercase tracking-wider opacity-90">
              {lines.length} ລາຍ
            </div>
          </div>
        </div>

        {/* Sub-row: chips (pinned/blind toggle) */}
        {(labelPinned || canRevealBalance) && (
          <div className="flex w-full flex-wrap items-center gap-1.5 px-3 pb-2 sm:px-4">
            {labelPinned && (
              <span className="inline-flex max-w-[60%] items-center gap-1 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-900">
                <MapPinIcon className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">
                  {labelRackCode}
                  {labelLocationCode && ` / ${labelLocationCode}`}
                </span>
              </span>
            )}
            {canRevealBalance && (
              <button
                type="button"
                onClick={toggleBlind}
                disabled={!sessionOpen || toggling}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-700 transition hover:bg-zinc-200 disabled:opacity-50 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              >
                {blind ? (
                  <EyeOffIcon className="h-2.5 w-2.5" />
                ) : (
                  <EyeIcon className="h-2.5 w-2.5" />
                )}
                {blind ? "Blind" : "ສະແດງຍອດ"}
              </button>
            )}
          </div>
        )}
      </header>

      {/* ========== MAIN ========== */}
      <main
        className={
          sessionOpen
            ? "w-full flex-1 px-3 pb-24 pt-3 sm:px-4 sm:pb-28 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] lg:gap-5 lg:pb-6"
            : "w-full flex-1 px-3 py-3 sm:px-4 sm:py-4"
        }
      >
        {/* ===== LEFT: COUNTING ===== */}
        {sessionOpen && (
          <section className="min-w-0">
            {showReEntryWarning && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/50 dark:bg-amber-950/30">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">
                  !
                </span>
                <div className="flex-1 text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">
                    ປ້າຍນີ້ມີ {initialLines.length} ລາຍການແລ້ວ
                  </span>
                  <span className="opacity-80"> — ການນັບໃໝ່ຈະຖືກເພີ່ມຕໍ່ທ້າຍ</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowReEntryWarning(false)}
                  className="shrink-0 text-amber-500 hover:text-amber-700 dark:text-amber-400"
                  aria-label="ປິດ"
                >
                  ✕
                </button>
              </div>
            )}

            <div className="space-y-3">
              {/* Search input */}
              <div className="relative isolate z-20">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    if (selected) setSelected(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (!selected && hits.length === 1) selectHit(hits[0]);
                      else if (selected && qty) addLine();
                    }
                  }}
                  placeholder="ຄົ້ນຫາລະຫັດສິນຄ້າ ຫຼື COM..."
                  className="relative z-0 h-11 w-full rounded-xl border-none bg-white pl-9 pr-12 text-sm font-medium shadow-sm ring-1 ring-zinc-200 transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-800"
                />
                <button
                  type="button"
                  title="ສະແກນບາໂຄດ"
                  onClick={() => setScannerOpen(true)}
                  className="absolute inset-y-1 right-1 z-20 flex w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm transition hover:bg-brand-500 active:scale-95"
                  aria-label="ສະແກນບາໂຄດ"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M3 7V5a2 2 0 0 1 2-2h2m10 0h2a2 2 0 0 1 2 2v2m0 10v2a2 2 0 0 1-2 2h-2m-10 0H5a2 2 0 0 1-2-2v-2M7 12h10M8 8h.01M16 8h.01M8 16h.01M16 16h.01" />
                  </svg>
                </button>

                {/* Dropdown */}
                {(hits.length > 0 || searching) && !selected && (
                  <div className="absolute inset-x-0 top-[calc(100%+0.4rem)] z-[60] max-h-72 overflow-auto rounded-xl bg-white p-1 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                    {searching && (
                      <div className="p-3 text-center text-xs font-medium text-zinc-400">
                        ກຳລັງຄົ້ນຫາ...
                      </div>
                    )}
                    {hits.map((h) => (
                      <button
                        key={h.item_code}
                        onClick={() => selectHit(h)}
                        className="flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-800/70 dark:active:bg-zinc-800"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[10px] font-bold text-brand-600 dark:text-brand-400">
                            {h.item_code}
                          </div>
                          <div className="mt-0.5 truncate text-xs font-medium">
                            {h.item_name}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          {showBalance && h.balance_qty !== null && (
                            <div className="font-mono text-xs font-black tabular-nums">
                              {formatQty(h.balance_qty)}
                            </div>
                          )}
                          <div className="text-[9px] font-bold uppercase text-zinc-400">
                            {h.unit_code}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Rack / Location selectors */}
              {!labelPinned && (racks.length > 0 || locations.length > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block pl-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Rack
                    </span>
                    <select
                      value={rackCode}
                      onChange={(e) => setRackCode(e.target.value)}
                      className="h-9 w-full rounded-lg bg-white px-2 text-xs font-semibold shadow-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-800"
                    >
                      <option value="">— ບໍ່ລະບຸ —</option>
                      {racks.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block pl-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      Location
                    </span>
                    <select
                      value={locationCode}
                      onChange={(e) => setLocationCode(e.target.value)}
                      className="h-9 w-full rounded-lg bg-white px-2 text-xs font-semibold shadow-sm ring-1 ring-zinc-200 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-900 dark:ring-zinc-800"
                    >
                      <option value="">— ບໍ່ລະບຸ —</option>
                      {availableLocations.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {/* Selected item card */}
              {selected && (
                <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-lg shadow-brand-600/25 dark:from-brand-500 dark:to-brand-600">
                  <div className="flex items-start justify-between gap-2 px-4 pb-1 pt-3">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] font-bold uppercase tracking-wider opacity-80">
                        {selected.item_code}
                      </div>
                      <h3 className="mt-0.5 text-sm font-bold leading-tight">
                        {selected.item_name}
                      </h3>
                    </div>
                    <button
                      onClick={clearSelection}
                      className="-mr-1 -mt-1 shrink-0 rounded-full bg-white/15 p-1.5 transition hover:bg-white/25 active:scale-95"
                      aria-label="ຍົກເລີກ"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="px-4 pb-3">
                    <div className="relative py-1">
                      <input
                        ref={qtyInputRef}
                        type="number"
                        inputMode="decimal"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="0"
                        className="w-full bg-transparent text-center font-mono text-5xl font-black tabular-nums tracking-tight text-white placeholder:text-white/30 focus:outline-none"
                      />
                      <div className="mt-0.5 text-center text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">
                        {selected.unit_code ?? "ຈຳນວນ"}
                      </div>
                    </div>

                    {showBalance && selected.balance_qty !== null && (
                      <div className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-black/15 px-3 py-1.5 text-[11px] font-bold">
                        <span className="opacity-80">SML:</span>
                        <span className="font-mono tabular-nums">
                          {formatQty(selected.balance_qty)} {selected.unit_code}
                        </span>
                      </div>
                    )}

                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="ບັນທຶກ..."
                      className="mt-2 w-full rounded-lg bg-white/10 px-3 py-2 text-xs font-medium placeholder:text-white/50 focus:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30"
                    />

                    {/* Desktop confirm (mobile uses fixed bar) */}
                    <button
                      type="button"
                      onClick={() => addLine()}
                      disabled={submitting || !qty}
                      className="mt-3 hidden h-10 w-full items-center justify-center gap-2 rounded-lg bg-white text-sm font-bold text-brand-700 shadow-sm transition hover:bg-zinc-50 active:scale-[0.98] disabled:opacity-50 lg:flex"
                    >
                      <CheckIcon className="h-4 w-4" />
                      {submitting ? "ກຳລັງບັນທຶກ..." : "ຢືນຢັນການນັບ"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ===== RIGHT: COUNTED LINES ===== */}
        <aside
          className={
            sessionOpen
              ? "mt-4 min-w-0 lg:mt-0 lg:flex lg:flex-col"
              : "mt-1 min-h-0 w-full"
          }
        >
          <div className="lg:sticky lg:top-32 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:overscroll-contain lg:pb-3">
            <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                ລາຍການນັບແລ້ວ
              </h2>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  {lines.length}
                </span>
                {pendingCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-900">
                    <span className="h-1 w-1 animate-pulse rounded-full bg-amber-500" />
                    Sync {pendingCount}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              {lines.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-200 py-8 text-center dark:border-zinc-800">
                  <p className="text-xs font-semibold text-zinc-400">
                    ຍັງບໍ່ມີການນັບ
                  </p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    ສະແກນ ຫຼື ຄົ້ນຫາສິນຄ້າເພື່ອນັບ
                  </p>
                </div>
              ) : (
                lines.map((l) => (
                  <div
                    key={l.line_id}
                    className="group rounded-xl bg-white px-3 py-2 shadow-sm ring-1 ring-zinc-200 transition hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-zinc-700"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                            {l.item_code}
                          </span>
                          {l.line_id < 0 && (
                            <span className="rounded bg-amber-100 px-1 py-0 text-[8px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              Offline
                            </span>
                          )}
                        </div>
                        <div className="truncate text-xs font-semibold leading-tight">
                          {l.item_name}
                        </div>
                        {(l.rack_code || l.location_code || l.note) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[10px] text-zinc-500 dark:text-zinc-400">
                            {(l.rack_code || l.location_code) && (
                              <span className="inline-flex items-center gap-0.5">
                                <MapPinIcon className="h-2.5 w-2.5" />
                                {l.rack_code ?? "—"}/{l.location_code ?? "—"}
                              </span>
                            )}
                            {l.note && (
                              <span className="truncate italic">
                                &ldquo;{l.note}&rdquo;
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 text-right">
                        {editingId === l.line_id ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              autoFocus
                              value={editingQty}
                              onChange={(e) => setEditingQty(e.target.value)}
                              className="w-16 rounded bg-zinc-100 px-1.5 py-1 text-right font-mono text-xs font-bold focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-zinc-800"
                            />
                            <button
                              onClick={() => saveEdit(l.line_id)}
                              className="rounded bg-brand-600 p-1 text-white hover:bg-brand-700"
                              aria-label="ບັນທຶກ"
                            >
                              <CheckIcon className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            disabled={!sessionOpen}
                            onClick={() => startEdit(l)}
                            className="text-right transition active:scale-95 disabled:opacity-100"
                          >
                            <div className="font-mono text-base font-black leading-none tabular-nums text-zinc-900 hover:text-brand-600 dark:text-white dark:hover:text-brand-400">
                              {formatQty(l.qty)}
                            </div>
                            <div className="mt-0.5 text-[9px] font-bold uppercase text-zinc-400">
                              {l.unit_code}
                            </div>
                          </button>
                        )}
                      </div>

                      {sessionOpen && editingId !== l.line_id && (
                        <button
                          onClick={() => deleteLine(l.line_id)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-zinc-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-zinc-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                          aria-label="ລຶບ"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
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

      {/* ========== MOBILE FIXED CONFIRM ========== */}
      {sessionOpen && selected && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-zinc-200 bg-white/95 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95 lg:hidden">
          <button
            onClick={() => addLine()}
            disabled={submitting || !qty}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white shadow-md shadow-brand-600/30 transition active:scale-[0.98] disabled:opacity-40"
          >
            <CheckIcon className="h-4 w-4" />
            {submitting ? "ກຳລັງບັນທຶກ..." : "ຢືນຢັນການນັບ"}
          </button>
        </div>
      )}

      {/* ========== TOAST ========== */}
      {toast && (
        <div className="fixed left-1/2 top-20 z-[100] -translate-x-1/2">
          <div
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-xl ${toast.kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`}
          >
            {toast.kind === "ok" ? (
              <CheckIcon className="h-3.5 w-3.5" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={4}
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            )}
            {toast.text}
          </div>
        </div>
      )}

      {/* ========== SCANNER ========== */}
      {scannerOpen && (
        <BarcodeScanner
          onDetect={handleScan}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}

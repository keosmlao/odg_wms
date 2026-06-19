"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "@/components/ui/Icons";

type Bill = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  transport_name: string | null;
  lines: number;
  items: number;
  qty_sum: string | null;
  tms_total: number;
  tms_shipped: number;
  tms_last_sent: string | null;
  selected: boolean;
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function billKey(b: { doc_no: string; trans_flag: number }) {
  return `${b.doc_no}::${b.trans_flag}`;
}

export default function PendingBillsDialog({
  sessionId,
  open,
  onClose,
  hasCountedLines,
}: {
  sessionId: number;
  open: boolean;
  onClose: () => void;
  hasCountedLines: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [bills, setBills] = useState<Bill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hideShipped, setHideShipped] = useState(true);
  const [serverSelectedCount, setServerSelectedCount] = useState(0);
  const [whCode, setWhCode] = useState<string | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{
    refreshed_at: string | null;
    row_count: number;
  } | null>(null);
  const [shown, setShown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mount/unmount animation
  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  async function load(opts?: {
    q?: string;
    from?: string;
    to?: string;
    hideShipped?: boolean;
  }) {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (opts?.q) params.set("q", opts.q);
      if (opts?.from) params.set("from", opts.from);
      if (opts?.to) params.set("to", opts.to);
      if (opts?.hideShipped ?? hideShipped) params.set("hide_shipped", "1");
      params.set("limit", "300");
      const res = await fetch(
        `/api/stocktake/sessions/${sessionId}/pending-bills?${params.toString()}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        bills?: Bill[];
        selected_count?: number;
        wh_code?: string;
        cache?: { refreshed_at: string | null; row_count: number } | null;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ໂຫລດບໍ່ສຳເລັດ");
      setBills(data.bills ?? []);
      setServerSelectedCount(data.selected_count ?? 0);
      if (data.wh_code) setWhCode(data.wh_code);
      setCacheInfo(data.cache ?? null);
      const next = new Set<string>();
      for (const b of data.bills ?? []) {
        if (b.selected) next.add(billKey(b));
      }
      setSelected(next);
    } catch (err) {
      alert(err instanceof Error ? err.message : "ໂຫລດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      setQ("");
      setFrom("");
      setTo("");
      setHideShipped(true);
      load({ hideShipped: true });
    }
  }, [open, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshCache() {
    if (!whCode) return;
    if (
      !confirm(
        "ດຶງຂໍ້ມູນບິນຄ້າງຈ່າຍຄືນ?\nຂັ້ນຕອນນີ້ໃຊ້ເວລາ 5-15 ວິນາທີ.",
      )
    )
      return;
    setRefreshingCache(true);
    try {
      const res = await fetch(`/api/stocktake/pending-bills-cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: whCode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        row_count?: number;
      };
      if (!res.ok || !data.ok)
        throw new Error(data.error ?? "Refresh ບໍ່ສຳເລັດ");
      await load({ q, from, to, hideShipped });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Refresh ບໍ່ສຳເລັດ");
    } finally {
      setRefreshingCache(false);
    }
  }

  // Aggregate selection summary
  const selectionTotals = useMemo(() => {
    let qty = 0;
    let lines = 0;
    for (const b of bills) {
      if (selected.has(billKey(b))) {
        qty += Number.parseFloat(b.qty_sum ?? "0") || 0;
        lines += b.lines;
      }
    }
    return { qty, lines };
  }, [bills, selected]);

  // Suggested = still in warehouse (TMS not shipped) + recent (doc_date ≤ 60 days)
  const recommended = useMemo(() => {
    const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const ok: Bill[] = [];
    for (const b of bills) {
      if (b.tms_shipped > 0) continue;
      if (b.doc_date) {
        const t = Date.parse(b.doc_date);
        if (Number.isFinite(t) && t < cutoff) continue;
      }
      ok.push(b);
    }
    return ok;
  }, [bills]);
  const recommendedUnselected = useMemo(
    () => recommended.filter((b) => !selected.has(billKey(b))).length,
    [recommended, selected],
  );

  if (!open) return null;
  if (typeof document === "undefined") return null;

  function toggle(b: Bill) {
    const k = billKey(b);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of bills) next.add(billKey(b));
      return next;
    });
  }

  function clearAll() {
    setSelected(new Set());
  }

  function selectRecommended() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of recommended) next.add(billKey(b));
      return next;
    });
  }

  async function save(mode: "replace" | "append", force = false) {
    setSaving(true);
    try {
      // Append mode only sends keys that aren't already in pending (delta).
      const keys =
        mode === "append"
          ? Array.from(selected).filter((k) => {
              const bill = bills.find((b) => billKey(b) === k);
              return bill ? !bill.selected : true;
            })
          : Array.from(selected);
      const payload = keys.map((k) => {
        const [doc_no, flag] = k.split("::");
        return { doc_no, trans_flag: Number.parseInt(flag, 10) };
      });
      const res = await fetch(
        `/api/stocktake/sessions/${sessionId}/pending-bills`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected: payload, force, mode }),
        },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        requires_confirmation?: boolean;
        counted_lines?: number;
        added_bills?: number;
        selected_bills?: number;
      };
      if (res.status === 409 && data.requires_confirmation) {
        if (
          confirm(
            `${data.error}.\n\nຢຶນຍັນ ${mode === "append" ? "ເພີ່ມ" : "ປ່ຽນ"} ເຖິງແມ່ນວ່າມີການນັບແລ້ວ ${data.counted_lines} ລາຍການ?`,
          )
        ) {
          setSaving(false);
          return save(mode, true);
        }
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບັນທຶກບໍ່ສຳເລັດ");
      router.refresh();
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  // Number of newly-checked bills that aren't yet in the pending table.
  const appendableCount = useMemo(() => {
    let n = 0;
    for (const b of bills) {
      if (selected.has(billKey(b)) && !b.selected) n++;
    }
    return n;
  }, [bills, selected]);

  const filterChanged = q !== "" || from !== "" || to !== "";
  const selectedDelta = selected.size - serverSelectedCount;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pending-bills-dialog-title"
      className={`fixed inset-0 z-[80] flex items-end justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-200 sm:items-center sm:p-4 ${
        shown ? "opacity-100" : "opacity-0"
      }`}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        className={`flex h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl shadow-zinc-900/20 transition-all duration-200 sm:h-[88vh] sm:max-w-3xl sm:rounded-2xl dark:bg-zinc-900 ${
          shown
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-4 scale-[0.98] opacity-0"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id="pending-bills-dialog-title"
              className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              ເລືອກບິນຄ້າງຈ່າຍ
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              ບິນທີ່ເລືອກຈະຖືກບວກກັບ SML ສຳລັບການສົມທຽບ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 active:scale-95 dark:hover:bg-zinc-800"
            aria-label="ປິດ"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Summary chips + cache freshness */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-5 py-2.5 text-xs dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <SummaryChip
              tone="zinc"
              label="ສະແດງ"
              value={`${bills.length.toLocaleString("en-US")} ບິນ`}
            />
            <SummaryChip
              tone="indigo"
              label="ເລືອກ"
              value={`${selected.size.toLocaleString("en-US")} ບິນ`}
            />
            {selected.size > 0 && (
              <SummaryChip
                tone="amber"
                label="qty"
                value={`+${formatQty(selectionTotals.qty)}`}
              />
            )}
            {selectedDelta !== 0 && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  selectedDelta > 0
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"
                }`}
              >
                {selectedDelta > 0 ? "+" : ""}
                {selectedDelta} ບໍ່ບັນທຶກ
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {cacheInfo?.refreshed_at
                ? `cache: ${cacheInfo.refreshed_at.slice(0, 16)}`
                : "ຍັງບໍ່ມີ cache"}
            </span>
            <button
              type="button"
              onClick={refreshCache}
              disabled={refreshingCache || loading || !whCode}
              title="ດຶງຂໍ້ມູນບິນຄ້າງຈ່າຍຄືນຈາກລະບົບ TMS"
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-3 w-3 ${refreshingCache ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
              {refreshingCache ? "ກຳລັງດຶງ..." : "ດຶງຄືນ"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            load({ q, from, to, hideShipped });
          }}
          className="flex flex-col gap-2 border-b border-zinc-100 px-5 py-2.5 dark:border-zinc-800 sm:flex-row sm:items-center"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="doc_no, ລູກຄ້າ, transport..."
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              aria-label="From"
            />
            <span className="text-xs text-zinc-400">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              aria-label="To"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              {loading ? "..." : "ກອງ"}
            </button>
            {filterChanged && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setFrom("");
                  setTo("");
                  load();
                }}
                className="text-[11px] text-zinc-500 hover:underline"
              >
                ລ້າງ
              </button>
            )}
          </div>
        </form>

        {/* Sticky toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/50 px-5 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/30">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectRecommended}
              disabled={recommended.length === 0 || recommendedUnselected === 0}
              title="ບິນທີ່ TMS ຍັງບໍ່ສົ່ງ ແລະ doc_date ບໍ່ເກີນ 60 ວັນ"
              className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-emerald-500 to-teal-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition hover:from-emerald-600 hover:to-teal-600 disabled:cursor-not-allowed disabled:from-zinc-300 disabled:to-zinc-300 disabled:opacity-60"
            >
              ✨ ແນະນຳ
              {recommended.length > 0 && (
                <span className="rounded-full bg-white/25 px-1.5 text-[10px] font-bold tabular-nums">
                  {recommendedUnselected > 0
                    ? `+${recommendedUnselected}`
                    : `${recommended.length}`}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={selectAllVisible}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-indigo-600 transition hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              ☐ ເລືອກທີ່ສະແດງ
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={selected.size === 0}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
            >
              ✕ ລ້າງ
            </button>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
            <input
              type="checkbox"
              checked={hideShipped}
              onChange={(e) => {
                const v = e.target.checked;
                setHideShipped(v);
                load({ q, from, to, hideShipped: v });
              }}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            ບໍ່ສະແດງບິນທີ່ສົ່ງແລ້ວ (TMS)
          </label>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="py-14 text-center text-sm text-zinc-500">
              <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-zinc-200 border-t-indigo-500" />
              ກຳລັງໂຫລດ...
            </div>
          ) : bills.length === 0 ? (
            <div className="py-14 text-center text-sm text-zinc-500">
              ບໍ່ມີບິນຄ້າງຈ່າຍຕາມເງື່ອນໄຂ
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bills.map((b) => {
                const k = billKey(b);
                const isOn = selected.has(k);
                const isRecommended =
                  b.tms_shipped === 0 &&
                  (!b.doc_date ||
                    Date.parse(b.doc_date) >=
                      Date.now() - 60 * 24 * 60 * 60 * 1000);
                return (
                  <li key={k}>
                    <label
                      className={`flex cursor-pointer items-center gap-3 px-5 py-2.5 transition ${
                        isOn
                          ? "bg-indigo-50/70 dark:bg-indigo-950/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      }`}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                          isOn
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
                        }`}
                      >
                        {isOn && <CheckIcon className="h-3 w-3" />}
                        <input
                          type="checkbox"
                          checked={isOn}
                          onChange={() => toggle(b)}
                          className="sr-only"
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0">
                          <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
                            {b.doc_no}
                          </span>
                          <span className="rounded bg-zinc-100 px-1.5 py-0 text-[9px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                            flag {b.trans_flag}
                          </span>
                          {b.doc_date && (
                            <span className="text-[11px] text-zinc-500">
                              {b.doc_date}
                            </span>
                          )}
                          <TmsBadge bill={b} />
                          {isRecommended && (
                            <span
                              title="ແນະນຳ: TMS ຍັງບໍ່ສົ່ງ ແລະ ບໍ່ເກີນ 60 ວັນ"
                              className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-0 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
                            >
                              ✨ ແນະນຳ
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-zinc-500 dark:text-zinc-400">
                          {b.cust_code && <span>{b.cust_code}</span>}
                          {b.transport_name && (
                            <span className="truncate">
                              · {b.transport_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-zinc-500 dark:text-zinc-400">
                        <div className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                          +{formatQty(b.qty_sum)}
                        </div>
                        <div>
                          {b.items} ສິນຄ້າ · {b.lines} ລາຍ
                        </div>
                      </div>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="min-w-0 text-xs text-zinc-600 dark:text-zinc-300">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <span>
                ເລືອກ:{" "}
                <span className="font-bold text-zinc-900 dark:text-zinc-50">
                  {selected.size}
                </span>{" "}
                ບິນ
              </span>
              {selected.size > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  · +{formatQty(selectionTotals.qty)} qty
                </span>
              )}
            </div>
            {hasCountedLines && (
              <span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                ມີການນັບແລ້ວ — ຕ້ອງຢຶນຍັນ
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              ຍົກເລີກ
            </button>
            <button
              type="button"
              onClick={() => save("append")}
              disabled={saving || appendableCount === 0}
              title="ເພີ່ມບິນທີ່ເລືອກໃໝ່ເຂົ້າຕາລາງ ໂດຍບໍ່ລົບບິນທີ່ມີຢູ່"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {saving
                ? "ກຳລັງ..."
                : `+ ເພີ່ມເຂົ້າຕາລາງ${appendableCount > 0 ? ` (${appendableCount})` : ""}`}
            </button>
            <button
              type="button"
              onClick={() => save("replace")}
              disabled={saving || selectedDelta === 0}
              title="ບັນທຶກລາຍການທີ່ໝາຍແທນບິນເກົ່າ"
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ (ແທນ)"}
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TmsBadge({ bill }: { bill: Bill }) {
  const total = bill.tms_total ?? 0;
  const shipped = bill.tms_shipped ?? 0;
  if (total === 0) return null;
  const allShipped = shipped >= total && total > 0;
  const partial = shipped > 0 && shipped < total;
  const tone = allShipped
    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
    : partial
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300";
  const label = allShipped
    ? `ສົ່ງແລ້ວ ${shipped}/${total}`
    : partial
      ? `ສົ່ງບາງສ່ວນ ${shipped}/${total}`
      : `TMS ${total}`;
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0 text-[9px] font-semibold ${tone}`}
      title={
        bill.tms_last_sent ? `last sent: ${bill.tms_last_sent.slice(0, 16)}` : ""
      }
    >
      {label}
    </span>
  );
}

function SummaryChip({
  tone,
  label,
  value,
}: {
  tone: "zinc" | "indigo" | "amber";
  label: string;
  value: string;
}) {
  const toneMap = {
    zinc: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    indigo:
      "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300",
    amber:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${toneMap[tone]}`}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

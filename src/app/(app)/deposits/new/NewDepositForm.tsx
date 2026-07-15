"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronRightIcon,
  SearchIcon,
} from "@/components/ui/Icons";
import {
  calculateFee,
  formatMoney,
  formatPct,
  tierSummary,
  type DepositSettings,
} from "@/lib/deposit";

type Warehouse = { code: string; name: string | null };

type Bill = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  transport_name: string | null;
  sale_code: string | null;
  sale_name: string | null;
  currency_code: string | null;
  lines: number;
  items: number;
  qty_sum: string | null;
  value_sum: string | null;
  tms_total: number;
  tms_shipped: number;
  tms_last_sent: string | null;
  in_active_deposit: boolean;
};

type ItemLine = {
  line_number: number | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  price: string | null;
  sum_amount: string | null;
};

function formatQty(v: string | number | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function billKey(b: { doc_no: string; trans_flag: number }) {
  return `${b.doc_no}::${b.trans_flag}`;
}

export default function NewDepositForm({
  warehouses,
  initialSettings,
}: {
  warehouses: Warehouse[];
  initialSettings: DepositSettings;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [whCode, setWhCode] = useState(warehouses[0]?.code ?? "");
  const [startDate, setStartDate] = useState(today);
  const [note, setNote] = useState("");
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [billItems, setBillItems] = useState<Record<string, ItemLine[]>>({});
  const [billItemsLoading, setBillItemsLoading] = useState<string | null>(null);

  const [bills, setBills] = useState<Bill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [hideShipped, setHideShipped] = useState(true);
  const [hideInDeposit, setHideInDeposit] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<{
    refreshed_at: string | null;
    row_count: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadBills(opts?: {
    q?: string;
    from?: string;
    to?: string;
    hideShipped?: boolean;
    hideInDeposit?: boolean;
  }) {
    if (!whCode) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ wh_code: whCode, limit: "300" });
      if (opts?.q ?? q) params.set("q", opts?.q ?? q);
      if (opts?.from ?? from) params.set("from", opts?.from ?? from);
      if (opts?.to ?? to) params.set("to", opts?.to ?? to);
      if (opts?.hideShipped ?? hideShipped) params.set("hide_shipped", "1");
      if (!(opts?.hideInDeposit ?? hideInDeposit))
        params.set("hide_in_deposit", "0");
      const res = await fetch(
        `/api/deposits/pending-bills?${params.toString()}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        bills?: Bill[];
        cache?: { refreshed_at: string | null; row_count: number } | null;
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ໂຫລດບໍ່ສຳເລັດ");
      setBills(data.bills ?? []);
      setCacheInfo(data.cache ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ໂຫລດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  // Reload when warehouse changes
  useEffect(() => {
    setSelected(new Set());
    setBills([]);
    if (whCode) {
      loadBills({ hideShipped: true, hideInDeposit: true });
    }
  }, [whCode]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshCache() {
    if (!whCode) return;
    if (!confirm("Refresh cache ບິນຄ້າງຈ່າຍ?\nໃຊ້ເວລາ 5-15 ວິນາທີ.")) return;
    setRefreshing(true);
    try {
      const res = await fetch(`/api/stocktake/pending-bills-cache`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wh_code: whCode }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      await loadBills();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Refresh ບໍ່ສຳເລັດ");
    } finally {
      setRefreshing(false);
    }
  }

  function toggle(b: Bill) {
    setSelected((prev) => {
      const next = new Set(prev);
      const k = billKey(b);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  // Read-only customer + sales staff derived from first selected bill
  const derived = useMemo(() => {
    const first = bills.find((b) => selected.has(billKey(b)));
    return {
      cust_code: first?.cust_code ?? "",
      cust_name: first?.cust_name ?? "",
      sale_code: first?.sale_code ?? "",
      sale_name: first?.sale_name ?? "",
    };
  }, [bills, selected]);

  async function fetchBillItems(b: Bill) {
    const k = billKey(b);
    if (billItems[k]) return;
    setBillItemsLoading(k);
    try {
      const params = new URLSearchParams({
        wh_code: whCode,
        doc_no: b.doc_no,
        trans_flag: String(b.trans_flag),
      });
      const res = await fetch(
        `/api/deposits/bill-items?${params.toString()}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        items?: ItemLine[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ໂຫລດບໍ່ສຳເລັດ");
      setBillItems((prev) => ({ ...prev, [k]: data.items ?? [] }));
    } catch (err) {
      alert(err instanceof Error ? err.message : "ໂຫລດສິນຄ້າບໍ່ສຳເລັດ");
    } finally {
      setBillItemsLoading(null);
    }
  }

  async function toggleExpand(b: Bill) {
    const k = billKey(b);
    if (expandedBill === k) {
      setExpandedBill(null);
    } else {
      setExpandedBill(k);
      await fetchBillItems(b);
    }
  }

  const totals = useMemo(() => {
    let items = 0;
    let qty = 0;
    let billCount = 0;
    const valueByCurrency = new Map<string, number>();
    for (const b of bills) {
      if (selected.has(billKey(b))) {
        items += b.items;
        qty += Number.parseFloat(b.qty_sum ?? "0") || 0;
        const v = Number.parseFloat(b.value_sum ?? "0") || 0;
        const cur = b.currency_code ?? initialSettings.currency;
        valueByCurrency.set(cur, (valueByCurrency.get(cur) ?? 0) + v);
        billCount += 1;
      }
    }
    return { items, qty, billCount, valueByCurrency };
  }, [bills, selected, initialSettings.currency]);

  const tiers = useMemo(() => tierSummary(initialSettings), [initialSettings]);

  async function submit() {
    if (!whCode || selected.size === 0) {
      setError("ກະລຸນາເລືອກສາງ ແລະ ບິນຢ່າງໜ້ອຍ 1 ບິນ");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        wh_code: whCode,
        start_date: startDate,
        // Customer / sale info is derived server-side from selected bills,
        // but pass detected values along for clarity / future overrides.
        cust_code: derived.cust_code || null,
        cust_name: derived.cust_name || null,
        note: note || null,
        bills: Array.from(selected).map((k) => {
          const [doc_no, flag] = k.split("::");
          return { doc_no, trans_flag: Number.parseInt(flag, 10) };
        }),
      };
      const res = await fetch("/api/deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        deposit_id?: number;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.deposit_id)
        throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.push(`/deposits/${data.deposit_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
      {/* LEFT: form fields */}
      <div className="space-y-4 lg:sticky lg:top-0">
        <section className="rounded-2xl border border-zinc-200/70 bg-white/90 p-4 shadow-sm ring-1 ring-black/[0.02] sm:p-5 dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            ຂໍ້ມູນຮັບຝາກ
          </h2>
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                ສາງ
              </span>
              <select
                value={whCode}
                onChange={(e) => setWhCode(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              >
                {warehouses.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code}
                    {w.name ? ` · ${w.name}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                ວັນທີ່ເລີ່ມຝາກ
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </label>
            <ReadOnlyField
              label="ລະຫັດລູກຄ້າ"
              value={derived.cust_code}
              placeholder="auto-fill ຈາກບິນທີ່ເລືອກ"
              mono
            />
            <ReadOnlyField
              label="ຊື່ລູກຄ້າ"
              value={derived.cust_name}
              placeholder="—"
            />
            <ReadOnlyField
              label="ພະນັກງານຂາຍ"
              value={
                derived.sale_name
                  ? `${derived.sale_name}${derived.sale_code ? ` (${derived.sale_code})` : ""}`
                  : derived.sale_code
              }
              placeholder="—"
            />
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                ບັນທຶກ
              </span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-zinc-200 bg-white py-2 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </label>
          </div>
        </section>

        {/* Preview totals */}
        <section className="rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50/90 to-violet-50/60 p-4 shadow-sm sm:p-5 dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-violet-950/10">
          <h2 className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
            ສະຫຼຸບ
          </h2>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-zinc-600 dark:text-zinc-300">ບິນທີ່ເລືອກ</dt>
              <dd className="font-mono font-bold tabular-nums text-zinc-900 dark:text-white">
                {totals.billCount}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-zinc-600 dark:text-zinc-300">ສິນຄ້າ</dt>
              <dd className="font-mono font-bold tabular-nums text-zinc-900 dark:text-white">
                {totals.items}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-zinc-600 dark:text-zinc-300">qty ລວມ</dt>
              <dd className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                {formatQty(totals.qty)}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-zinc-600 dark:text-zinc-300">ມູນຄ່າສິນຄ້າ</dt>
              <dd className="flex flex-col items-end gap-0.5">
                {totals.valueByCurrency.size === 0 ? (
                  <span className="font-mono tabular-nums text-zinc-400">—</span>
                ) : (
                  Array.from(totals.valueByCurrency.entries()).map(
                    ([cur, val]) => (
                      <span
                        key={cur}
                        className="font-mono font-bold tabular-nums text-indigo-700 dark:text-indigo-300"
                      >
                        {formatMoney(val, cur)}
                      </span>
                    ),
                  )
                )}
              </dd>
            </div>
          </dl>

          {totals.billCount > 0 && totals.valueByCurrency.size > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                ຄ່າຝາກຕາມຂັ້ນ
              </p>
              {totals.valueByCurrency.size > 1 ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  ⚠ ບິນທີ່ເລືອກມີຫຼາຍສະກຸນເງິນ — ກະລຸນາເລືອກສະກຸນດຽວ ຫຼື
                  ປ່ຽນຮັບຝາກແຍກ
                </p>
              ) : (
                <ul className="space-y-0.5 text-xs">
                  {(() => {
                    const [cur, val] = Array.from(
                      totals.valueByCurrency.entries(),
                    )[0];
                    return tiers.map((t, i) => {
                      const f = (val * t.pct) / 100;
                      return (
                        <li
                          key={i}
                          className="flex items-baseline justify-between gap-2"
                        >
                          <span className="text-zinc-600 dark:text-zinc-300">
                            {t.range}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatPct(t.pct)}
                          </span>
                          <span className="font-mono font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                            {formatMoney(f, cur)}
                          </span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={saving || selected.size === 0 || !whCode}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກຮັບຝາກ"}
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </section>
      </div>

      {/* RIGHT: bill picker */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
              ບິນຄ້າງຈ່າຍ
            </h2>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              ສະແດງ {bills.length} ບິນ · ເລືອກ{" "}
              <span className="font-semibold text-zinc-700 dark:text-zinc-200">
                {selected.size}
              </span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
              {cacheInfo?.refreshed_at
                ? `cache: ${cacheInfo.refreshed_at.slice(0, 16)}`
                : "ບໍ່ມີ cache"}
            </span>
            <button
              type="button"
              onClick={refreshCache}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
            >
              {refreshing ? "ກຳລັງດຶງ..." : "ດຶງຄືນ"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadBills();
          }}
          className="grid gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800 sm:grid-cols-[minmax(180px,1fr)_auto_auto_auto_auto] sm:items-center"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ຄົ້ນຫາ doc_no, ລູກຄ້າ..."
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
          </div>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <span className="hidden text-xs text-zinc-400 sm:inline">→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            ກອງ
          </button>
        </form>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-100 bg-zinc-50/50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950/30">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={hideShipped}
              onChange={(e) => {
                setHideShipped(e.target.checked);
                loadBills({ hideShipped: e.target.checked });
              }}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            ບໍ່ສະແດງບິນທີ່ສົ່ງແລ້ວ
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={hideInDeposit}
              onChange={(e) => {
                setHideInDeposit(e.target.checked);
                loadBills({ hideInDeposit: e.target.checked });
              }}
              className="h-3.5 w-3.5 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
            />
            ບໍ່ສະແດງບິນທີ່ຝາກຢູ່ແລ້ວ
          </label>
        </div>

        {/* List */}
        <div className="max-h-[68vh] overflow-y-auto overscroll-contain lg:h-[calc(100dvh-280px)] lg:max-h-none lg:min-h-[460px]">
          {loading ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              ກຳລັງໂຫລດ...
            </div>
          ) : bills.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">
              ບໍ່ມີບິນຄ້າງຈ່າຍ
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bills.map((b) => {
                const k = billKey(b);
                const isOn = selected.has(k);
                const isExpanded = expandedBill === k;
                const items = billItems[k];
                return (
                  <li key={k}>
                    <div
                      className={`px-4 py-2 transition ${
                        isOn
                          ? "bg-indigo-50/70 dark:bg-indigo-950/30"
                          : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => toggle(b)}
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                            isOn
                              ? "border-indigo-600 bg-indigo-600 text-white"
                              : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
                          }`}
                          aria-label={isOn ? "uncheck" : "check"}
                        >
                          {isOn && <CheckIcon className="h-3 w-3" />}
                        </button>
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
                            {b.tms_total > 0 && (
                              <span
                                className={`rounded px-1.5 py-0 text-[9px] font-bold ${
                                  b.tms_shipped >= b.tms_total
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                                    : b.tms_shipped > 0
                                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                }`}
                              >
                                TMS {b.tms_shipped}/{b.tms_total}
                              </span>
                            )}
                            {b.in_active_deposit && (
                              <span className="rounded bg-violet-100 px-1.5 py-0 text-[9px] font-bold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                                ຝາກຢູ່ແລ້ວ
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {(b.cust_name || b.cust_code) && (
                              <span className="truncate">
                                <span className="text-zinc-400">ລູກຄ້າ:</span>{" "}
                                {b.cust_name ?? b.cust_code}
                                {b.cust_code && b.cust_name && (
                                  <span className="text-zinc-400">
                                    {" "}
                                    ({b.cust_code})
                                  </span>
                                )}
                              </span>
                            )}
                            {(b.sale_name || b.sale_code) && (
                              <>
                                <span className="text-zinc-300 dark:text-zinc-600">
                                  ·
                                </span>
                                <span className="truncate">
                                  <span className="text-zinc-400">ຂາຍ:</span>{" "}
                                  {b.sale_name ?? b.sale_code}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[11px] text-zinc-500 dark:text-zinc-400">
                          <div className="font-mono font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                            {formatMoney(
                              b.value_sum ?? 0,
                              b.currency_code ?? initialSettings.currency,
                            )}
                          </div>
                          <div className="font-mono tabular-nums text-amber-700 dark:text-amber-400">
                            qty {formatQty(b.qty_sum)}
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              toggleExpand(b);
                            }}
                            className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                          >
                            {b.items} ສິນຄ້າ · {b.lines} ລາຍ
                            <span
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            >
                              ›
                            </span>
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="mt-2 ml-8 rounded-lg border border-zinc-200/70 bg-white p-2 dark:border-zinc-700 dark:bg-zinc-950/50">
                          {billItemsLoading === k && !items ? (
                            <p className="py-2 text-center text-[11px] text-zinc-500">
                              ກຳລັງໂຫລດສິນຄ້າ...
                            </p>
                          ) : !items || items.length === 0 ? (
                            <p className="py-2 text-center text-[11px] text-zinc-500">
                              ບໍ່ມີສິນຄ້າ
                            </p>
                          ) : (
                            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                              {items.map((it, i) => (
                                <li
                                  key={`${it.item_code}-${i}`}
                                  className="flex items-baseline justify-between gap-2 py-1 text-[11px]"
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                                      {it.item_code}
                                    </span>
                                    {it.item_name && (
                                      <span
                                        className="ml-1.5 truncate text-zinc-600 dark:text-zinc-400"
                                        title={it.item_name}
                                      >
                                        {it.item_name}
                                      </span>
                                    )}
                                  </div>
                                  <span className="shrink-0 font-mono tabular-nums text-zinc-700 dark:text-zinc-300">
                                    {formatQty(it.qty)}
                                    {it.unit_code && (
                                      <span className="ml-0.5 text-zinc-400">
                                        {it.unit_code}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 w-24 text-right font-mono font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                                    {formatMoney(
                                      it.sum_amount ?? 0,
                                      b.currency_code ??
                                        initialSettings.currency,
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ReadOnlyField({
  label,
  value,
  placeholder = "—",
  mono = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  mono?: boolean;
}) {
  const isEmpty = !value;
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <div
        className={`flex h-9 w-full items-center rounded-lg border border-zinc-200/70 bg-zinc-50 px-3 text-sm dark:border-zinc-700/70 dark:bg-zinc-800/40 ${
          mono ? "font-mono" : ""
        } ${isEmpty ? "text-zinc-400" : "text-zinc-800 dark:text-zinc-100"}`}
      >
        {isEmpty ? placeholder : value}
      </div>
    </div>
  );
}

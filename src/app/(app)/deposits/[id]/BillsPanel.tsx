"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, PlusIcon, SearchIcon } from "@/components/ui/Icons";
import { formatDate, formatMoney } from "@/lib/deposit";

export type DepositBill = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  currency_code: string | null;
  lines: number;
  items: number;
  qty_sum: string;
  value_sum: string;
};

type PendingBill = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  currency_code: string | null;
  lines: number;
  items: number;
  qty_sum: string | null;
  value_sum: string | null;
  in_active_deposit: boolean;
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function billKey(b: { doc_no: string; trans_flag: number }) {
  return `${b.doc_no}::${b.trans_flag}`;
}

/**
 * Bills attached to a deposit. While the deposit is active the list is
 * editable — bills can be detached, and more can be pulled in from the pending
 * bill cache. Header totals are recomputed server-side on every change.
 */
export default function BillsPanel({
  depositId,
  whCode,
  currency,
  bills,
  editable,
}: {
  depositId: number;
  whCode: string;
  currency: string;
  bills: DepositBill[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState<PendingBill[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadPending(search = q) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ wh_code: whCode, limit: "200" });
      if (search.trim()) params.set("q", search.trim());
      const res = await fetch(`/api/deposits/pending-bills?${params}`);
      const data = (await res.json()) as {
        ok?: boolean;
        bills?: PendingBill[];
        error?: string;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ໂຫລດບໍ່ສຳເລັດ");
      setPending(data.bills ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ໂຫລດບໍ່ສຳເລັດ");
    } finally {
      setLoading(false);
    }
  }

  async function openPicker() {
    setPicking(true);
    setSelected(new Set());
    if (pending.length === 0) await loadPending();
  }

  async function addSelected() {
    if (selected.size === 0) return;
    setBusy("add");
    setError(null);
    try {
      const res = await fetch(`/api/deposits/${depositId}/bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bills: Array.from(selected).map((k) => {
            const [doc_no, flag] = k.split("::");
            return { doc_no, trans_flag: Number.parseInt(flag, 10) };
          }),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setPicking(false);
      setPending([]);
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(null);
    }
  }

  async function removeBill(b: DepositBill) {
    if (!confirm(`ຖອນບິນ ${b.doc_no} ອອກຈາກຮັບຝາກນີ້?`)) return;
    setBusy(billKey(b));
    setError(null);
    try {
      const params = new URLSearchParams({
        doc_no: b.doc_no,
        trans_flag: String(b.trans_flag),
      });
      const res = await fetch(`/api/deposits/${depositId}/bills?${params}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(null);
    }
  }

  const attached = new Set(bills.map(billKey));

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
          ບິນທີ່ຝາກ ({bills.length})
        </h2>
        {editable && (
          <button
            type="button"
            onClick={() => (picking ? setPicking(false) : openPicker())}
            className="inline-flex items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-700 transition hover:bg-brand-100 dark:border-brand-900/50 dark:bg-brand-950/40 dark:text-brand-300"
          >
            <PlusIcon className="h-3 w-3" />
            {picking ? "ປິດ" : "ເພີ່ມບິນ"}
          </button>
        )}
      </div>

      {error && (
        <p className="border-b border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Add-bill picker */}
      {picking && (
        <div className="border-b border-zinc-100 bg-zinc-50/60 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950/30">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadPending();
            }}
            className="mb-2 flex items-center gap-2"
          >
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="ຄົ້ນຫາ doc_no, ລູກຄ້າ..."
                className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              ຄົ້ນຫາ
            </button>
            <button
              type="button"
              onClick={addSelected}
              disabled={selected.size === 0 || busy === "add"}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-500 disabled:opacity-40"
            >
              {busy === "add" ? "ກຳລັງເພີ່ມ..." : `ເພີ່ມ (${selected.size})`}
            </button>
          </form>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
            {loading ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                ກຳລັງໂຫລດ...
              </p>
            ) : pending.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                ບໍ່ມີບິນຄ້າງຈ່າຍໃຫ້ເພີ່ມ
              </p>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pending
                  .filter((b) => !attached.has(billKey(b)))
                  .map((b) => {
                    const k = billKey(b);
                    const on = selected.has(k);
                    return (
                      <li key={k}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(k)) next.delete(k);
                              else next.add(k);
                              return next;
                            })
                          }
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                            on
                              ? "bg-brand-50/70 dark:bg-brand-950/30"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              on
                                ? "border-brand-600 bg-brand-600 text-white"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
                          >
                            {on && <CheckIcon className="h-2.5 w-2.5" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
                              {b.doc_no}
                              <span className="ml-1.5 font-sans text-[10px] font-normal text-zinc-500">
                                {formatDate(b.doc_date)}
                              </span>
                            </span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {b.cust_name ?? b.cust_code ?? "—"}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-mono text-[11px] font-semibold tabular-nums text-brand-700 dark:text-brand-300">
                              {formatMoney(
                                b.value_sum ?? 0,
                                b.currency_code ?? currency,
                              )}
                            </span>
                            <span className="block text-[10px] text-zinc-500">
                              {b.items} ສິນຄ້າ
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      )}

      {bills.length === 0 ? (
        <div className="py-8 text-center text-sm text-zinc-500">ບໍ່ມີບິນ</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50/60 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">doc_no</th>
                <th className="hidden px-4 py-2 text-left sm:table-cell">
                  ວັນທີ
                </th>
                <th className="hidden px-4 py-2 text-left lg:table-cell">
                  ລູກຄ້າ
                </th>
                <th className="px-4 py-2 text-right">ສິນຄ້າ</th>
                <th className="px-4 py-2 text-right">qty</th>
                <th className="px-4 py-2 text-right">ມູນຄ່າ</th>
                {editable && <th className="w-10 px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {bills.map((b) => (
                <tr key={billKey(b)}>
                  <td className="px-4 py-2 font-mono text-xs font-semibold">
                    {b.doc_no}
                    <div className="text-[10px] font-normal text-zinc-500">
                      flag {b.trans_flag}
                    </div>
                  </td>
                  <td className="hidden px-4 py-2 text-xs text-zinc-600 sm:table-cell dark:text-zinc-300">
                    {formatDate(b.doc_date)}
                  </td>
                  <td className="hidden px-4 py-2 text-xs text-zinc-600 lg:table-cell dark:text-zinc-300">
                    {b.cust_name ?? b.cust_code ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {b.items} / {b.lines}
                  </td>
                  <td className="px-4 py-2 text-right font-mono tabular-nums">
                    {formatQty(b.qty_sum)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-semibold tabular-nums">
                    {formatMoney(b.value_sum, b.currency_code ?? currency)}
                  </td>
                  {editable && (
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeBill(b)}
                        disabled={busy === billKey(b)}
                        title="ຖອນບິນອອກ"
                        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-zinc-300 transition hover:bg-rose-100 hover:text-rose-600 disabled:opacity-40 dark:text-zinc-600 dark:hover:bg-rose-950/40"
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

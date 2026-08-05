"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { calculateFee, formatMoney, formatPct } from "@/lib/deposit";

export default function SettleForm({
  depositId,
  startDate,
  freeDaysMax,
  tier1DaysMax,
  tier1Pct,
  tier2DaysMax,
  tier2Pct,
  tier3DaysMax,
  tier3Pct,
  tier4Pct,
  minCharge,
  maxCharge,
  totalValue,
  currency,
}: {
  depositId: number;
  startDate: string;
  freeDaysMax: number;
  tier1DaysMax: number;
  tier1Pct: string;
  tier2DaysMax: number;
  tier2Pct: string;
  tier3DaysMax: number;
  tier3Pct: string;
  tier4Pct: string;
  minCharge: string;
  maxCharge: string;
  totalValue: string;
  currency: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [endDate, setEndDate] = useState(today);
  const [method, setMethod] = useState<"cash" | "transfer" | "other">("cash");
  const [reference, setReference] = useState("");
  const [overrideFee, setOverrideFee] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const calc = useMemo(
    () =>
      calculateFee({
        start_date: startDate,
        end_date: endDate,
        free_days_max: freeDaysMax,
        tier1_days_max: tier1DaysMax,
        tier1_pct: tier1Pct,
        tier2_days_max: tier2DaysMax,
        tier2_pct: tier2Pct,
        tier3_days_max: tier3DaysMax,
        tier3_pct: tier3Pct,
        tier4_pct: tier4Pct,
        min_charge: minCharge,
        max_charge: maxCharge,
        total_value: totalValue,
      }),
    [
      startDate,
      endDate,
      freeDaysMax,
      tier1DaysMax,
      tier1Pct,
      tier2DaysMax,
      tier2Pct,
      tier3DaysMax,
      tier3Pct,
      tier4Pct,
      minCharge,
      maxCharge,
      totalValue,
    ],
  );

  const overrideValue = overrideFee.trim()
    ? Number.parseFloat(overrideFee)
    : null;
  const finalFee =
    overrideValue !== null && Number.isFinite(overrideValue) && overrideValue >= 0
      ? overrideValue
      : calc.fee;

  async function send(action: "settle" | "cancel") {
    if (action === "settle" && !confirm("ຢຶນຍັນສຳເລັດຮັບຝາກ + ຮັບເງິນ?"))
      return;
    if (action === "cancel" && !confirm("ຢຶນຍັນຍົກເລີກຮັບຝາກ?")) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { action };
      if (action === "settle") {
        body.end_date = endDate;
        body.payment_method = method;
        body.payment_reference = reference || null;
        body.note = note || null;
        if (overrideValue !== null && Number.isFinite(overrideValue))
          body.override_fee = overrideValue;
      }
      const res = await fetch(`/api/deposits/${depositId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  const tierBadge =
    calc.tier === 0
      ? {
          label: "ຟຣີ",
          cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
        }
      : calc.tier === 4
        ? {
            label: "ຂັ້ນ 4",
            cls: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
          }
        : {
            label: `ຂັ້ນ ${calc.tier}`,
            cls: "bg-brand-100 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
          };

  return (
    <div className="rounded-2xl border border-brand-200/70 bg-brand-50/40 p-5 dark:border-brand-900/40 dark:bg-brand-950/20">
      <h2 className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
        ສຳເລັດຮັບຝາກ ແລະ ຮັບເງິນ
      </h2>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            ວັນທີ່ມາຮັບ
          </span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            min={startDate}
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </label>

        {/* Calculated fee */}
        <div className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-zinc-500">ໄລຍະຝາກ</span>
            <span className="font-mono font-semibold tabular-nums">
              {calc.duration_days} ມື້
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-zinc-500">ເຂດທີ່ໃຊ້</span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tierBadge.cls}`}
              >
                {tierBadge.label}
              </span>
              <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                {formatPct(calc.applied_pct)}
              </span>
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-zinc-500">ມູນຄ່າສິນຄ້າ</span>
            <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-300">
              {formatMoney(calc.total_value, currency)}
            </span>
          </div>
          <div className="mt-1 border-t border-zinc-100 pt-1 dark:border-zinc-800">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-zinc-500">ຄ່າຄຳນວນ</span>
              <span className="font-mono text-lg font-bold tabular-nums text-brand-700 dark:text-brand-300">
                {formatMoney(calc.fee, currency)}
              </span>
            </div>
            {calc.raw_fee !== calc.fee && (
              <p className="text-[10px] text-zinc-500">
                raw: {formatMoney(calc.raw_fee, currency)} (clamped)
              </p>
            )}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            ປັບຄ່າດ້ວຍຕົນເອງ (optional)
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={overrideFee}
            onChange={(e) => setOverrideFee(e.target.value)}
            placeholder={`default: ${calc.fee}`}
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm font-mono shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              ວິທີຈ່າຍ
            </span>
            <select
              value={method}
              onChange={(e) =>
                setMethod(e.target.value as "cash" | "transfer" | "other")
              }
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            >
              <option value="cash">ເງິນສົດ</option>
              <option value="transfer">ໂອນ</option>
              <option value="other">ອື່ນໆ</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Reference
            </span>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="(optional)"
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
            ບັນທຶກ
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm shadow-sm focus:border-brand-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
        </label>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={() => send("settle")}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "..." : `ຮັບເງິນ ${formatMoney(finalFee, currency)}`}
          </button>
          <button
            type="button"
            onClick={() => send("cancel")}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3.5 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-rose-400"
          >
            ຍົກເລີກຮັບຝາກ
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  calculateFee,
  formatMoney,
  formatPct,
  tierSummary,
  type DepositSettings,
} from "@/lib/deposit";

export default function DepositSettingsForm({
  initialSettings,
}: {
  initialSettings: DepositSettings;
}) {
  const router = useRouter();
  const [s, setS] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Preview total value for tier examples
  const [previewValue, setPreviewValue] = useState(1_000_000);

  function update<K extends keyof DepositSettings>(
    key: K,
    value: DepositSettings[K],
  ) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  const tiers = useMemo(() => tierSummary(s), [s]);
  const previewExamples = useMemo(() => {
    return [
      { days: Math.max(1, s.free_days_max), label: `${s.free_days_max} ມື້` },
      { days: s.tier1_days_max, label: `${s.tier1_days_max} ມື້` },
      { days: s.tier2_days_max, label: `${s.tier2_days_max} ມື້` },
      { days: s.tier3_days_max, label: `${s.tier3_days_max} ມື້` },
      { days: s.tier3_days_max + 30, label: `${s.tier3_days_max + 30} ມື້` },
    ];
  }, [s]);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/deposits/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setMsg("ບັນທຶກສຳເລັດ");
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "ບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      {/* Tier table editor */}
      <section className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-900/80">
        <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
            ອັດຕາຄ່າຝາກຕາມໄລຍະ
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            ຄ່າຝາກ = ມູນຄ່າສິນຄ້າ × % ຕາມໄລຍະ. ສິ້ນສຸດເຂດໃດໃຫ້ໃຊ້ %
            ຂອງເຂດນັ້ນ.
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-zinc-50/60 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-900/40 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-2 text-left">ເຂດ</th>
              <th className="px-4 py-2 text-left">ໄລຍະ</th>
              <th className="px-4 py-2 text-right">ຫາສຸດ (ມື້)</th>
              <th className="px-4 py-2 text-right">% ມູນຄ່າ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            <tr className="bg-emerald-50/30 dark:bg-emerald-950/15">
              <td className="px-4 py-2 font-semibold text-emerald-700 dark:text-emerald-400">
                ຟຣີ
              </td>
              <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                1 - {s.free_days_max} ມື້
              </td>
              <td className="px-4 py-2 text-right">
                <NumberCell
                  value={s.free_days_max}
                  onChange={(v) => update("free_days_max", v)}
                  step="1"
                />
              </td>
              <td className="px-4 py-2 text-right text-xs font-bold text-emerald-700 dark:text-emerald-400">
                0%
              </td>
            </tr>
            <TierRow
              label="ຂັ້ນ 1"
              prevMax={s.free_days_max}
              days={s.tier1_days_max}
              pct={s.tier1_pct}
              onDays={(v) => update("tier1_days_max", v)}
              onPct={(v) => update("tier1_pct", v)}
            />
            <TierRow
              label="ຂັ້ນ 2"
              prevMax={s.tier1_days_max}
              days={s.tier2_days_max}
              pct={s.tier2_pct}
              onDays={(v) => update("tier2_days_max", v)}
              onPct={(v) => update("tier2_pct", v)}
            />
            <TierRow
              label="ຂັ້ນ 3"
              prevMax={s.tier2_days_max}
              days={s.tier3_days_max}
              pct={s.tier3_pct}
              onDays={(v) => update("tier3_days_max", v)}
              onPct={(v) => update("tier3_pct", v)}
            />
            <tr>
              <td className="px-4 py-2 font-semibold text-zinc-700 dark:text-zinc-200">
                ຂັ້ນ 4
              </td>
              <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">
                &gt; {s.tier3_days_max} ມື້
              </td>
              <td className="px-4 py-2 text-right text-xs text-zinc-400">
                (ບໍ່ມີຂອບເຂດ)
              </td>
              <td className="px-4 py-2 text-right">
                <NumberCell
                  value={s.tier4_pct}
                  onChange={(v) => update("tier4_pct", v)}
                  step="0.01"
                  suffix="%"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Additional limits */}
      <section className="rounded-2xl border border-zinc-200/70 bg-white/90 p-5 shadow-sm dark:border-zinc-800/70 dark:bg-zinc-900/80">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
          ຂັ້ນຕ່ຳ / ສູງສຸດ / ສະກຸນເງິນ
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field
            label="ຄ່າຝາກຂັ້ນຕ່ຳ"
            unit={s.currency}
            value={s.min_charge}
            onChange={(v) => update("min_charge", v)}
            hint="0 = ບໍ່ຈຳກັດ"
          />
          <Field
            label="ຄ່າຝາກສູງສຸດ"
            unit={s.currency}
            value={s.max_charge}
            onChange={(v) => update("max_charge", v)}
            hint="0 = ບໍ່ຈຳກັດ"
          />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              ສະກຸນເງິນ
            </span>
            <input
              type="text"
              value={s.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
              maxLength={8}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-mono uppercase shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
          </label>
        </div>
      </section>

      {/* Live preview */}
      <section className="rounded-2xl border border-brand-200/70 bg-brand-50/40 p-5 dark:border-brand-900/40 dark:bg-brand-950/20">
        <h2 className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-300">
          ຕົວຢ່າງ
        </h2>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <label className="text-xs text-zinc-700 dark:text-zinc-300">
            ມູນຄ່າສິນຄ້າ
          </label>
          <input
            type="number"
            step="1000"
            value={previewValue}
            onChange={(e) =>
              setPreviewValue(Number.parseFloat(e.target.value) || 0)
            }
            className="w-40 rounded-lg border border-zinc-200 bg-white px-3 py-1 text-sm font-mono shadow-sm focus:border-brand-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <span className="text-xs text-zinc-500">{s.currency}</span>
        </div>
        <div className="mt-3 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40">
              <tr>
                <th className="px-3 py-1.5 text-left">ໄລຍະ</th>
                <th className="px-3 py-1.5 text-right">%</th>
                <th className="px-3 py-1.5 text-right">ຄ່າຝາກ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {previewExamples.map((ex, i) => {
                const calc = calculateFee({
                  start_date: new Date(Date.now() - ex.days * 86400000),
                  end_date: new Date(),
                  free_days_max: s.free_days_max,
                  tier1_days_max: s.tier1_days_max,
                  tier1_pct: s.tier1_pct,
                  tier2_days_max: s.tier2_days_max,
                  tier2_pct: s.tier2_pct,
                  tier3_days_max: s.tier3_days_max,
                  tier3_pct: s.tier3_pct,
                  tier4_pct: s.tier4_pct,
                  min_charge: s.min_charge,
                  max_charge: s.max_charge,
                  total_value: previewValue,
                });
                return (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{ex.label}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      {formatPct(calc.applied_pct)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-brand-700 dark:text-brand-300">
                      {formatMoney(calc.fee, s.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
          <span className="font-semibold">ສະຫຼຸບ:</span>{" "}
          {tiers.map((t, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {t.range}: {formatPct(t.pct)}
            </span>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3">
        {msg && (
          <span
            className={`text-xs ${msg === "ບັນທຶກສຳເລັດ" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
          >
            {msg}
          </span>
        )}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 disabled:opacity-60"
        >
          {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
        </button>
      </div>
    </form>
  );
}

function TierRow({
  label,
  prevMax,
  days,
  pct,
  onDays,
  onPct,
}: {
  label: string;
  prevMax: number;
  days: number;
  pct: number;
  onDays: (v: number) => void;
  onPct: (v: number) => void;
}) {
  return (
    <tr>
      <td className="px-4 py-2 font-semibold text-zinc-700 dark:text-zinc-200">
        {label}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-600 dark:text-zinc-300">
        {prevMax + 1} - {days} ມື້
      </td>
      <td className="px-4 py-2 text-right">
        <NumberCell value={days} onChange={onDays} step="1" />
      </td>
      <td className="px-4 py-2 text-right">
        <NumberCell value={pct} onChange={onPct} step="0.01" suffix="%" />
      </td>
    </tr>
  );
}

function NumberCell({
  value,
  onChange,
  step = "0.01",
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
}) {
  return (
    <div className="relative inline-block">
      <input
        type="number"
        step={step}
        min="0"
        value={value}
        onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
        className={`w-24 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-right text-sm font-mono tabular-nums shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white ${suffix ? "pr-6" : ""}`}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-zinc-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  unit,
  onChange,
  hint,
  step = "0.01",
}: {
  label: string;
  value: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <div className="relative">
        <input
          type="number"
          step={step}
          min="0"
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value) || 0)}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 pr-12 text-sm font-mono tabular-nums shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
        />
        {unit && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-zinc-400">
            {unit}
          </span>
        )}
      </div>
      {hint && (
        <span className="mt-1 block text-[10px] text-zinc-500 dark:text-zinc-400">
          {hint}
        </span>
      )}
    </label>
  );
}

"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export type WarehouseOption = { code: string; name: string | null };

const PRESETS: { days: number; label: string }[] = [
  { days: 7, label: "7 ມື້" },
  { days: 30, label: "30 ມື້" },
  { days: 90, label: "90 ມື້" },
];

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

function isoShift(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * ຕົວກັ່ນຕອງຂອງລາຍງານ — ຂຽນລົງ URL ທັງໝົດ ບໍ່ໄດ້ເກັບເປັນ state ພາຍໃນ
 * ເພື່ອໃຫ້ **ສົ່ງລິ້ງໃຫ້ກັນເບິ່ງລາຍງານດຽວກັນໄດ້** ແລະ refresh ແລ້ວບໍ່ຫາຍ.
 */
export default function PerformanceFilters({
  warehouses,
  wh,
  from,
  to,
}: {
  warehouses: WarehouseOption[];
  wh: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);

  function go(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    setBusy(true);
    router.push(`/movements/performance?${q.toString()}`);
    router.refresh();
    setTimeout(() => setBusy(false), 600);
  }

  const activePreset = PRESETS.find((p) => {
    const r = isoShift(p.days);
    return r.from === from && r.to === to;
  });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <select value={wh} onChange={(e) => go({ wh: e.target.value })} className={inputCls} aria-label="ສາງ">
        <option value="">ທຸກສາງທີ່ຮັບຜິດຊອບ</option>
        {warehouses.map((w) => (
          <option key={w.code} value={w.code}>
            {w.code} · {w.name ?? "—"}
          </option>
        ))}
      </select>

      <div className="flex gap-1">
        {PRESETS.map((p) => {
          const on = activePreset?.days === p.days;
          return (
            <button
              key={p.days}
              type="button"
              onClick={() => go(isoShift(p.days))}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                on
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <input type="date" value={from} onChange={(e) => go({ from: e.target.value })} className={inputCls} aria-label="ແຕ່ວັນທີ" />
      <span className="text-xs text-zinc-400">→</span>
      <input type="date" value={to} onChange={(e) => go({ to: e.target.value })} className={inputCls} aria-label="ຮອດວັນທີ" />

      {busy && <span className="text-xs text-zinc-400">ກຳລັງໂຫຼດ...</span>}
    </div>
  );
}

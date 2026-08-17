"use client";

import { useState } from "react";
import { CheckIcon, LayersIcon } from "@/components/ui/Icons";
import PendingBillsDialog from "./PendingBillsDialog";
import RefreshSnapshotDialog from "./RefreshSnapshotDialog";

export default function SnapshotPanel({
  sessionId,
  snapshotItems,
  pendingItems,
  pendingBills,
  countedLines,
}: {
  sessionId: number;
  snapshotItems: number;
  pendingItems: number;
  pendingBills: number;
  countedLines: number;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [refreshOpen, setRefreshOpen] = useState(false);

  const smlEmpty = snapshotItems === 0;
  const noPending = pendingBills === 0;
  const hasCounts = countedLines > 0;

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
              smlEmpty
                ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                : "bg-brand-100 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300"
            }`}
          >
            {smlEmpty ? (
              <LayersIcon className="h-4 w-4" />
            ) : (
              <CheckIcon className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              ຍອດອ້າງອີງ
            </p>
            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              SML
              {pendingItems > 0 ? " + ບິນຄ້າງຈ່າຍທີ່ເລືອກ" : ""}
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              {smlEmpty
                ? "ກົດ ‘ດຶງ SML’ ກ່ອນເລີ່ມນັບ"
                : hasCounts
                  ? `ມີການນັບແລ້ວ ${countedLines.toLocaleString("en-US")} ລາຍການ — ປ່ຽນຍອດອ້າງອີງຈະຕ້ອງຢຶນຍັນ`
                  : noPending
                    ? "ຖ້າມີບິນຄ້າງຈ່າຍທີ່ຍັງຄ້າງສິນຄ້າຢູ່ສາງ, ກົດ ‘ເລືອກບິນ’ ເພື່ອບວກກັບ SML"
                    : "ກົດ ‘ດຶງຄືນ’ ເພື່ອ refresh, ຫຼື ‘ເລືອກບິນ’ ເພື່ອປ່ຽນບິນທີ່ຮວມ"}
            </p>
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="SML"
            value={snapshotItems}
            tone="brand"
            hint="ສິນຄ້າ"
          />
          <Stat
            label="ບິນຄ້າງ"
            value={pendingBills}
            tone="amber"
            hint="ບິນທີ່ເລືອກ"
          />
          <Stat
            label="ສິນຄ້າຄ້າງ"
            value={pendingItems}
            tone="amber"
            hint="ບວກກັບ SML"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50"
          >
            {noPending ? "ເລືອກບິນຄ້າງຈ່າຍ" : "ປ່ຽນບິນທີ່ເລືອກ"}
          </button>
          <button
            type="button"
            onClick={() => setRefreshOpen(true)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              smlEmpty
                ? "bg-brand-600 text-white shadow-sm hover:bg-brand-500"
                : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            }`}
          >
            {smlEmpty ? "ດຶງ SML" : "ດຶງຄືນ"}
          </button>
        </div>
      </div>

      <PendingBillsDialog
        sessionId={sessionId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        hasCountedLines={hasCounts}
      />

      <RefreshSnapshotDialog
        sessionId={sessionId}
        open={refreshOpen}
        onClose={() => setRefreshOpen(false)}
        countedLines={countedLines}
        hasSnapshot={!smlEmpty}
      />
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "brand" | "amber";
  hint?: string;
}) {
  const toneMap = {
    brand:
      "bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300",
    amber:
      "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300",
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${toneMap[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums">
        {value.toLocaleString("en-US")}
      </div>
      {hint && (
        <div className="text-[10px] opacity-70">{hint}</div>
      )}
    </div>
  );
}

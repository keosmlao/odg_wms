"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Mode = "all" | "date" | "category" | "brand";

type Props = {
  sessionId: number;
  open: boolean;
  onClose: () => void;
  countedLines: number;
  hasSnapshot: boolean;
};

export default function RefreshSnapshotDialog({
  sessionId,
  open,
  onClose,
  countedLines,
  hasSnapshot,
}: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ snapshot: number; pending: number } | null>(
    null,
  );

  function run(force = false) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const body: Record<string, unknown> = { force };
        if (mode === "date") {
          if (!dateFrom && !dateTo) {
            setError("ກະລຸນາໃສ່ວັນທີ");
            return;
          }
          body.filters = {
            date_from: dateFrom || null,
            date_to: dateTo || null,
          };
        }
        const res = await fetch(
          `/api/stocktake/sessions/${sessionId}/snapshot`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          requires_confirmation?: boolean;
          counted_lines?: number;
          snapshot_items?: number;
          pending_items?: number;
        };
        if (res.status === 409 && data.requires_confirmation) {
          if (
            confirm(
              `${data.error}.\n\nຢຶນຍັນດຶງຄືນ ເຖິງແມ່ນວ່າມີການນັບ ${data.counted_lines ?? countedLines} ລາຍການ?`,
            )
          ) {
            return run(true);
          }
          return;
        }
        if (!res.ok || !data.ok) {
          setError(data.error ?? "ບໍ່ສຳເລັດ");
          return;
        }
        setResult({
          snapshot: data.snapshot_items ?? 0,
          pending: data.pending_items ?? 0,
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      }
    });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-50">
            ດຶງ SML ຄືນ
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            ເລືອກວິທີດຶງ SML ໃໝ່ — ປ່ຽນຍອດອ້າງອີງຂອງຮອບກວດນັບ
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <ModeOption
            value="all"
            current={mode}
            onChange={setMode}
            label="ດຶງທັງໝົດ"
            detail="ໃຊ້ສິນຄ້າທັງໝົດໃນສາງ (ຄ່າເລີ່ມຕົ້ນ)"
          />
          <ModeOption
            value="date"
            current={mode}
            onChange={setMode}
            label="ກອງຕາມວັນເວລາ"
            detail="ສະເພາະທຸລະກຳໃນຊ່ວງວັນທີ doc_date"
          />
          {mode === "date" && (
            <div className="ml-7 grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  ຈາກວັນທີ
                </label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  ເຖິງວັນທີ
                </label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
                />
              </div>
            </div>
          )}
          <ModeOption
            value="category"
            current={mode}
            onChange={setMode}
            label="ກອງຕາມໝວດ"
            detail="ຍັງລໍຖ້າສ້າງ table SML inventory ກ່ອນ"
            disabled
          />
          <ModeOption
            value="brand"
            current={mode}
            onChange={setMode}
            label="ກອງຕາມ brand"
            detail="ຍັງລໍຖ້າສ້າງ table SML inventory ກ່ອນ"
            disabled
          />

          {hasSnapshot && countedLines === 0 && mode === "all" && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              ⚠ ຍອດ SML ປັດຈຸບັນ ({" "}
              <b>{hasSnapshot ? "ມີຢູ່" : "ບໍ່ມີ"}</b>) ຈະຖືກລ້າງ ແລະ ດຶງໃໝ່.
            </div>
          )}
          {countedLines > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-800 dark:bg-red-950/30 dark:text-red-200">
              ⚠ ມີການນັບແລ້ວ {countedLines.toLocaleString("en-US")} ລາຍການ —
              ການດຶງຄືນຈະປ່ຽນຍອດອ້າງອີງ (ຕ້ອງຢຶນຍັນຄັ້ງທີສອງ).
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}
          {result && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              ✓ ດຶງສຳເລັດ — SML {result.snapshot.toLocaleString("en-US")} ສິນຄ້າ ·
              ຄ້າງຈ່າຍ {result.pending.toLocaleString("en-US")} ສິນຄ້າ
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            ປິດ
          </button>
          <button
            type="button"
            onClick={() => run(false)}
            disabled={pending}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
          >
            {pending ? "ກຳລັງດຶງ..." : "ດຶງ SML"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModeOption({
  value,
  current,
  onChange,
  label,
  detail,
  disabled,
}: {
  value: Mode;
  current: Mode;
  onChange: (v: Mode) => void;
  label: string;
  detail: string;
  disabled?: boolean;
}) {
  const active = current === value;
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition ${
        disabled
          ? "cursor-not-allowed border-zinc-200 bg-zinc-50/60 opacity-60 dark:border-zinc-800 dark:bg-zinc-900/40"
          : active
            ? "border-brand-300 bg-brand-50/60 dark:border-brand-700 dark:bg-brand-950/30"
            : "border-zinc-200 hover:border-brand-200 hover:bg-brand-50/30 dark:border-zinc-800 dark:hover:border-brand-800"
      }`}
    >
      <input
        type="radio"
        name="snapshot-mode"
        value={value}
        checked={active}
        onChange={() => !disabled && onChange(value)}
        disabled={disabled}
        className="mt-0.5 h-4 w-4 cursor-pointer accent-brand-600 disabled:cursor-not-allowed"
      />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {label}
        </div>
        <div className="text-[11px] text-zinc-500">{detail}</div>
      </div>
    </label>
  );
}

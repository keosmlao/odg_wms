"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type Group = {
  item_code: string;
  sml_unit: string | null;
  line_ids: number[];
};

export default function BulkFixButton({
  sessionId,
  groups,
}: {
  sessionId: number;
  groups: Group[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [result, setResult] = useState<
    | null
    | {
        updated: number;
        failed: number;
        firstError?: string;
      }
  >(null);

  const fixable = groups.filter((g) => g.sml_unit && g.line_ids.length > 0);
  const totalLines = fixable.reduce((s, g) => s + g.line_ids.length, 0);
  const compareUrl = `/stocktake/${sessionId}/report?scope=counted&filter=variance`;

  function run() {
    if (fixable.length === 0 || pending) return;
    setResult(null);
    setProgress({ done: 0, total: fixable.length });
    startTransition(async () => {
      let updated = 0;
      let failed = 0;
      let firstError: string | undefined;
      let done = 0;
      for (const g of fixable) {
        try {
          const res = await fetch(
            `/api/stocktake/sessions/${sessionId}/units`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                item_code: g.item_code,
                line_ids: g.line_ids,
                new_unit_code: g.sml_unit,
                note: "ປັບຫົວໜ່ວຍຕາມ SML — bulk fix-all",
              }),
            },
          );
          const data = (await res.json()) as {
            ok?: boolean;
            error?: string;
            updated_count?: number;
          };
          if (!res.ok || !data.ok) {
            failed++;
            if (!firstError) firstError = data.error ?? "ບໍ່ສຳເລັດ";
          } else {
            updated += data.updated_count ?? g.line_ids.length;
          }
        } catch (e) {
          failed++;
          if (!firstError)
            firstError = e instanceof Error ? e.message : "ບໍ່ສຳເລັດ";
        }
        done++;
        setProgress({ done, total: fixable.length });
      }
      setResult({ updated, failed, firstError });
      setProgress(null);
      router.refresh();
    });
  }

  if (fixable.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-aqua-50 px-4 py-3 dark:border-brand-900/60 dark:from-brand-950/30 dark:to-aqua-950/30">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-brand-900 dark:text-brand-100">
          ປັບຫົວໜ່ວຍຕາມ SML ໝົດທຸກລາຍການ
        </div>
        <div className="mt-0.5 text-[11px] text-brand-700 dark:text-brand-300">
          {fixable.length} ສິນຄ້າ · {totalLines} ໃບກວດນັບ
          {result && (
            <>
              <span className="mx-1 text-brand-300 dark:text-brand-700">·</span>
              <span className="text-emerald-700 dark:text-emerald-400">
                ✓ ສຳເລັດ {result.updated.toLocaleString("en-US")}
              </span>
              {result.failed > 0 && (
                <span className="ml-1 text-red-700 dark:text-red-400">
                  · ບໍ່ສຳເລັດ {result.failed}
                  {result.firstError ? ` (${result.firstError})` : ""}
                </span>
              )}
            </>
          )}
          {progress && (
            <>
              <span className="mx-1 text-brand-300 dark:text-brand-700">·</span>
              <span className="font-mono">
                {progress.done}/{progress.total}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {result && result.updated > 0 && (
          <Link
            href={compareUrl}
            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold text-brand-700 ring-1 ring-brand-200 transition hover:bg-brand-50 dark:bg-zinc-900 dark:text-brand-300 dark:ring-brand-800/60 dark:hover:bg-brand-950/40"
          >
            ສົມທຽບໃໝ່ →
          </Link>
        )}
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-aqua-600 px-4 py-2 text-sm font-bold text-white shadow-md shadow-brand-500/30 transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? (
            <>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4 animate-spin"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              ກຳລັງ update…
            </>
          ) : (
            <>
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              ໃຊ້ SML ໝົດທຸກລາຍການ
            </>
          )}
        </button>
      </div>
    </div>
  );
}

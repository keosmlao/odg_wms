"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LabelInfo } from "./page";

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default function LabelGrid({
  sessionId,
  labels,
  canEdit,
}: {
  sessionId: number;
  labels: LabelInfo[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);

  async function removeLabel(labelId: number, hasLines: boolean) {
    if (hasLines) {
      if (!confirm("ປ້າຍນີ້ມີລາຍການນັບແລ້ວ — ລຶບຈະຫາຍຫມົດ. ຍຶນຍັນ?")) return;
    } else if (!confirm("ລຶບປ້າຍນີ້?")) {
      return;
    }
    setBusyId(labelId);
    try {
      const res = await fetch(`/api/stocktake/labels/${labelId}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ລຶບບໍ່ສຳເລັດ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {labels.map((l) => {
        const counted = l.line_count > 0;
        return (
          <div key={l.label_id} className="group relative">
            <Link
              href={`/stocktake/${sessionId}/count/${l.label_id}`}
              className={
                counted
                  ? // ━━━ NABBED state ━━━ vibrant emerald gradient + checkmark
                    "block overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-600 p-4 text-white shadow-lg shadow-emerald-500/30 ring-1 ring-emerald-400/30 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-emerald-500/40"
                  : // ━━━ PENDING state ━━━ muted white with dashed border
                    "block overflow-hidden rounded-2xl border-2 border-dashed border-zinc-300 bg-white p-4 transition hover:-translate-y-0.5 hover:border-indigo-400 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-indigo-500"
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        counted
                          ? "font-mono text-xl font-bold tracking-tight text-white"
                          : "font-mono text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50"
                      }
                    >
                      {l.label_code}
                    </span>
                    {counted ? (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/25 ring-1 ring-white/40">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m5 13 4 4L19 7" />
                        </svg>
                      </span>
                    ) : null}
                  </div>

                  {(l.rack_code || l.location_code) && (
                    <div
                      className={
                        counted
                          ? "mt-1 truncate font-mono text-[10px] font-medium text-white/85"
                          : "mt-1 truncate font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400"
                      }
                    >
                      📍 {l.rack_code ?? "—"}
                      {l.location_code && ` / ${l.location_code}`}
                    </div>
                  )}
                  {l.note && !l.rack_code && !l.location_code && (
                    <div
                      className={
                        counted
                          ? "mt-1 truncate text-xs text-white/75"
                          : "mt-1 truncate text-xs text-zinc-500"
                      }
                    >
                      {l.note}
                    </div>
                  )}
                </div>

                {counted && (
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-2xl font-bold tabular-nums leading-none text-white">
                      {formatQty(l.qty_sum)}
                    </div>
                    <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-white/75">
                      {l.line_count} ລາຍການ
                    </div>
                  </div>
                )}
              </div>

              <div
                className={
                  counted
                    ? "mt-3 flex items-center justify-between border-t border-white/15 pt-2.5 text-[10px] font-semibold uppercase tracking-widest text-white/80"
                    : "mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-zinc-400"
                }
              >
                <span>{counted ? "✓ ນັບແລ້ວ — ກົດເພື່ອແກ້ໄຂ" : "ຍັງບໍ່ໄດ້ນັບ"}</span>
                <span aria-hidden>→</span>
              </div>
            </Link>

            {canEdit && (
              <button
                type="button"
                onClick={() => removeLabel(l.label_id, counted)}
                disabled={busyId === l.label_id}
                className={`absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full opacity-0 backdrop-blur transition group-hover:opacity-100 ${
                  counted
                    ? "bg-white/15 text-white/80 hover:bg-white/25 hover:text-white"
                    : "bg-white/80 text-zinc-400 ring-1 ring-zinc-200 hover:bg-red-50 hover:text-red-600 dark:bg-zinc-900/80 dark:text-zinc-500 dark:ring-zinc-700"
                } disabled:opacity-50`}
                aria-label="ລຶບປ້າຍ"
              >
                {busyId === l.label_id ? (
                  "..."
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-3.5 w-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  </svg>
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

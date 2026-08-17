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

function dateKey(value: string | null | undefined) {
  return value?.slice(0, 10) || "uncounted";
}

function dateLabel(key: string) {
  if (key === "uncounted") return "ຍັງບໍ່ໄດ້ນັບ";
  return key;
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
  const groups = Array.from(
    labels.reduce((map, label) => {
      const key = label.line_count > 0 ? dateKey(label.last_counted_at) : "uncounted";
      const list = map.get(key) ?? [];
      list.push(label);
      map.set(key, list);
      return map;
    }, new Map<string, LabelInfo[]>()),
  ).sort(([a], [b]) => {
    if (a === "uncounted") return -1;
    if (b === "uncounted") return 1;
    return b.localeCompare(a);
  });

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
    <div className="space-y-5">
      {groups.map(([key, items]) => {
        const groupLines = items.reduce((s, l) => s + l.line_count, 0);
        const groupQty = items.reduce(
          (s, l) => s + (Number.parseFloat(l.qty_sum) || 0),
          0,
        );
        return (
          <section key={key} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
                {dateLabel(key)}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span>{items.length.toLocaleString("en-US")} ປ້າຍ</span>
                {key !== "uncounted" && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-600">·</span>
                    <span>{groupLines.toLocaleString("en-US")} ລາຍການ</span>
                    <span className="text-zinc-300 dark:text-zinc-600">·</span>
                    <span className="font-mono font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                      {formatQty(groupQty)}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((l) => {
                const counted = l.line_count > 0;
                return (
                  <div key={l.label_id} className="group relative">
                    <Link
                      href={`/stocktake/${sessionId}/count/${l.label_id}`}
                      className={
                        counted
                          ? "block overflow-hidden rounded-2xl border border-brand-300/40 bg-gradient-to-br from-brand-600 via-brand-700 to-slate-900 p-4 text-white shadow-lg shadow-brand-900/25 ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-brand-900/30"
                          : "block overflow-hidden rounded-2xl border-2 border-dashed border-brand-200 bg-white/95 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-400 hover:bg-white hover:shadow-md dark:border-brand-900/50 dark:bg-slate-900/80 dark:hover:border-brand-500"
                      }
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                counted
                                  ? "font-mono text-xl font-bold tracking-tight text-white"
                                  : "font-mono text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50"
                              }
                            >
                              {l.label_code}
                            </span>
                            {counted ? (
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/35">
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
                                  : "mt-1 truncate font-mono text-[10px] font-semibold text-brand-700 dark:text-brand-300"
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
                                  : "mt-1 truncate text-xs text-slate-500 dark:text-slate-400"
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
                            : "mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400"
                        }
                      >
                        <span>
                          {counted
                            ? "✓ ນັບແລ້ວ — ກົດເພື່ອແກ້ໄຂ"
                            : "ຍັງບໍ່ໄດ້ນັບ"}
                        </span>
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
                            : "ring-1 bg-white/90 text-slate-500 ring-slate-200 hover:bg-red-50 hover:text-red-600 dark:bg-slate-900/90 dark:text-slate-400 dark:ring-slate-700"
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
          </section>
        );
      })}
    </div>
  );
}

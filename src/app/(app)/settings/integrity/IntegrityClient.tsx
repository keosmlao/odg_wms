"use client";

import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/ui/Icons";

type Check = {
  key: string;
  label: string;
  meaning: string;
  count: number;
  expect: number;
  severity: "error" | "warn" | "info";
};

const TONE: Record<Check["severity"], { pill: string; dot: string }> = {
  error: {
    pill: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50",
    dot: "bg-rose-500",
  },
  warn: {
    pill: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50",
    dot: "bg-amber-500",
  },
  info: {
    pill: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
    dot: "bg-zinc-400",
  },
};

export default function IntegrityClient() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/integrity", { cache: "no-store" });
        const j = (await r.json()) as { checks?: Check[]; cached?: boolean; error?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(j.error ?? "ກວດບໍ່ສຳເລັດ");
        setChecks(j.checks ?? []);
        setCached(Boolean(j.cached));
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "ກວດບໍ່ສຳເລັດ");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) {
    return (
      <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
        {err}
      </p>
    );
  }

  if (!checks) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
        ))}
      </div>
    );
  }

  const bad = checks.filter((c) => c.count !== c.expect);

  return (
    <div className="space-y-3">
      {bad.length === 0 ? (
        <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
          <CheckIcon className="h-5 w-5" />
          ຜ່ານທຸກຂໍ້ — ບໍ່ພົບຄວາມຜິດປົກກະຕິ
        </div>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ພົບ <strong className="text-zinc-900 dark:text-zinc-50">{bad.length}</strong> ຂໍ້ທີ່ຄວນເບິ່ງ.
          ໜ້ານີ້ບໍ່ໄດ້ແກ້ຫຍັງໃຫ້ — ການແກ້ຂໍ້ມູນເກົ່າຄວນເປັນການຕັດສິນໃຈຂອງຄົນ.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {checks.map((c) => {
          const ok = c.count === c.expect;
          const tone = TONE[c.severity];
          return (
            <li
              key={c.key}
              className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-emerald-500" : tone.dot}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{c.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-xs font-bold ring-1 ${
                        ok
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
                          : tone.pill
                      }`}
                    >
                      {c.count.toLocaleString("en-US")}
                    </span>
                    {!ok && (
                      <span className="text-[11px] text-zinc-400">ຄວນເປັນ {c.expect}</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    {c.meaning}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-[11px] text-zinc-400">
        {cached ? "ຜົນຈາກ cache (ບໍ່ເກີນ 10 ນາທີ)" : "ຄິດໃໝ່ດຽວນີ້"} · ການກວດສະແກນບັນຊີທັງໝົດ
        ຈຶ່ງເກັບຜົນໄວ້ 10 ນາທີ
      </p>
    </div>
  );
}

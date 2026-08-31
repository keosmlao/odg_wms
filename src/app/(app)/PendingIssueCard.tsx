"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpIcon, ChevronRightIcon } from "@/components/ui/Icons";

type TypeCount = { docs: number; qty: number };
type PendingCount = {
  by_type: { sale: TypeCount; req: TypeCount; transfer: TypeCount };
  total_docs: number;
  total_qty: number;
};

/**
 * ຄ້າງຈ່າຍຢູ່ໜ້າຫຼັກ — ຈຳນວນໃບທີ່ລໍຖ້າຈັດເຄື່ອງ ແຍກຕາມປະເພດເອກະສານ.
 *
 * ດຶງຫຼັງ paint (ຄືກັບ HealthBadges) ເພາະການນັບຄ້າງຈ່າຍເປັນ aggregate ໜັກ —
 * ໜ້າຫຼັກຕ້ອງຂຶ້ນທັນທີ ບໍ່ຄວນລໍຕົວເລກນີ້.
 *
 * ແຕ່ລະປະເພດເປັນລິ້ງໄປ tab ຂອງມັນເລີຍ: ເຫັນວ່າຄ້າງ ແລ້ວກົດເຂົ້າໄປເຮັດຕໍ່ໄດ້
 * ໃນຄລິກດຽວ — ບໍ່ແມ່ນເຫັນຕົວເລກແລ້ວຕ້ອງໄປໄລ່ຫາເອງ.
 */
const TYPES = [
  { key: "sale", label: "ບິນຂາຍ", tab: "sale" },
  { key: "req", label: "ໃບຂໍເບີກ", tab: "req" },
  { key: "transfer", label: "ໃບຂໍໂອນ", tab: "transfer" },
] as const;

export default function PendingIssueCard() {
  const [data, setData] = useState<PendingCount | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/movements/issue/pending/count");
        if (!res.ok) throw new Error();
        const d = (await res.json()) as PendingCount;
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (err) return null;

  return (
    <section className="rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm dark:border-zinc-800/60 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300">
            <ArrowUpIcon className="h-5 w-5" />
          </span>
          <div>
            <div className="text-sm font-bold text-zinc-900 dark:text-zinc-50">ຄ້າງຈ່າຍ</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">ໃບທີ່ລໍຖ້າຈັດເຄື່ອງ</div>
          </div>
        </div>

        {!data ? (
          <span className="animate-pulse text-[11px] text-zinc-400">ກຳລັງນັບ...</span>
        ) : data.total_docs === 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
            ✓ ບໍ່ມີໃບຄ້າງຈ່າຍ
          </span>
        ) : (
          <>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums leading-none text-red-600 dark:text-red-400">
                {data.total_docs}
              </span>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                ໃບ · {data.total_qty.toLocaleString("en-US")} ໜ່ວຍ
              </span>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {TYPES.map((t) => {
                const c = data.by_type[t.key];
                if (!c || c.docs === 0) return null;
                return (
                  <Link
                    key={t.key}
                    href={`/movements/issue?type=${t.tab}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-red-50 hover:text-red-700 hover:ring-red-200 dark:bg-zinc-800/60 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                  >
                    {t.label}
                    <span className="font-mono font-bold tabular-nums">{c.docs}</span>
                  </Link>
                );
              })}
              <Link
                href="/movements/issue"
                className="inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-3 py-1.5 text-xs font-bold text-white transition hover:shadow"
              >
                ໄປຈັດເຄື່ອງ
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </Link>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

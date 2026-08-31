"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Health = {
  dead_items: number;
  dead_qty: number;
  sn_mismatch: number;
  min_below?: number;
  /** ບ່ອນເກັບທີ່ຍອດຕິດລົບ — ເປັນໄປບໍ່ໄດ້ໃນຄວາມຈິງ ຈຶ່ງເປັນສັນຍານວ່າມີການບັນທຶກຜິດ. */
  negative_bins?: number;
  negative_qty?: number;
  cached?: boolean;
};

/** Async health chips for the home control-tower section — never blocks render. */
export default function HealthBadges() {
  const [data, setData] = useState<Health | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/movements/health");
        if (!res.ok) throw new Error();
        const d = (await res.json()) as Health;
        if (!cancelled) setData(d);
      } catch {
        if (!cancelled) setErr(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (err) return null;
  if (!data) {
    return <span className="text-[11px] text-zinc-400 animate-pulse">ກຳລັງກວດສຸຂະພາບ...</span>;
  }

  const minBelow = data.min_below ?? 0;
  const negBins = data.negative_bins ?? 0;
  const ok = data.dead_items === 0 && data.sn_mismatch === 0 && minBelow === 0 && negBins === 0;
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50">
        ✓ ສາງສຸຂະພາບດີ
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* ຍອດຕິດລົບຂຶ້ນກ່ອນເພື່ອນ — ມັນບໍ່ແມ່ນ "ຄວນລະວັງ" ແຕ່ເປັນ "ຂໍ້ມູນຜິດ".
          ຈ່າຍອອກຫຼາຍກວ່າທີ່ເຄີຍຮັບເຂົ້າ ເປັນໄປບໍ່ໄດ້ໃນຄວາມຈິງ. */}
      {negBins > 0 && (
        <Link
          href="/movements/accuracy"
          title={`ຍອດຕິດລົບລວມ ${(data.negative_qty ?? 0).toLocaleString("en-US")} ໜ່ວຍ — ຈ່າຍອອກຫຼາຍກວ່າທີ່ຮັບເຂົ້າ ແປວ່າມີການເຄື່ອນໄຫວທີ່ບໍ່ໄດ້ບັນທຶກ ຫຼື ບັນທຶກຜິດບ່ອນ`}
          className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-rose-700 transition hover:bg-rose-700"
        >
          ⛔ {negBins.toLocaleString("en-US")} ບ່ອນເກັບຍອດຕິດລົບ
        </Link>
      )}
      {minBelow > 0 && (
        <Link
          href="/movements/min-stock"
          className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50"
        >
          ⚠ {minBelow.toLocaleString("en-US")} ຕ່ຳກວ່າ stock ຂັ້ນຕ່ຳ
        </Link>
      )}
      {data.dead_items > 0 && (
        <Link
          href="/movements/aging"
          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50"
        >
          ⚠ {data.dead_items.toLocaleString("en-US")} ສິນຄ້າຄ້າງ
        </Link>
      )}
      {data.sn_mismatch > 0 && (
        <Link
          href="/movements/sn-check"
          className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900/50"
        >
          ⚠ {data.sn_mismatch.toLocaleString("en-US")} SN ບໍ່ຕົງ
        </Link>
      )}
    </div>
  );
}

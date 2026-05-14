"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LabelFromLocation({
  sessionId,
  locationCount,
}: {
  sessionId: number;
  /** Number of locations available in master (0 = no master defined). */
  locationCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    inserted: number;
    skipped: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    if (
      !confirm(
        `ສ້າງປ້າຍຈາກ location master?\nຄາດວ່າ ${locationCount} ປ້າຍ (ປ້າຍຊ້ຳຈະຂ້າມໂດຍອັດຕະໂນມັດ)`,
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/stocktake/sessions/${sessionId}/labels/from-locations`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        inserted?: number;
        skipped?: number;
      };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setResult({
        inserted: data.inserted ?? 0,
        skipped: data.skipped ?? 0,
      });
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  if (locationCount === 0) {
    return (
      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/40">
        ສາງນີ້ຍັງບໍ່ມີ location ໃນ master —{" "}
        <a
          href="/settings/warehouses"
          className="text-indigo-600 hover:underline"
        >
          ໄປຕັ້ງຄ່າ
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs text-zinc-600 dark:text-zinc-400">
        ສາງນີ້ມີ <span className="font-semibold text-zinc-900 dark:text-zinc-50">
          {locationCount.toLocaleString("en-US")}
        </span>{" "}
        location ໃນ master. ກົດປຸ່ມເພື່ອສ້າງປ້າຍຄອບຄຸມທຸກ location (label =
        rack-location).
      </div>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-500/20 transition hover:shadow-lg disabled:opacity-60"
      >
        {busy ? "ກຳລັງສ້າງ..." : `ສ້າງປ້າຍຈາກ ${locationCount} location`}
      </button>
      {result && (
        <div className="w-full rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300">
          ສ້າງສຳເລັດ {result.inserted} ປ້າຍ
          {result.skipped > 0 && ` (ຂ້າມຊ້ຳ ${result.skipped})`}
        </div>
      )}
      {err && (
        <div className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/40 dark:text-red-300">
          {err}
        </div>
      )}
    </div>
  );
}

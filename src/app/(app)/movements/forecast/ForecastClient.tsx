"use client";

import { useEffect, useRef, useState } from "react";
import { SearchIcon, TrendIcon } from "@/components/ui/Icons";
import { DataList } from "@/components/ui/DataList";

type Row = {
  wh_code: string;
  wh_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  on_hand: number;
  incoming: number;
  reserved: number;
  forecast: number;
};

const fmt = (v: number) =>
  Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "0";

/**
 * ຄົ້ນຫາຈຳນວນຄາດການ.
 *
 * ຕ້ອງພິມກ່ອນຈຶ່ງຄິດ — ການລວມຍອດທຸກສິນຄ້າທຸກສາງພ້ອມກັນໜັກ ແລະ ບໍ່ມີໃຜອ່ານໝົດ.
 * ຄຳຖາມທີ່ໜ້ານີ້ຕອບເປັນຄຳຖາມຕໍ່ສິນຄ້າຢູ່ແລ້ວ ("ຮັບຄຳສັ່ງນີ້ໄດ້ບໍ່").
 */
export default function ForecastClient() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRows(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const r = await fetch(`/api/movements/forecast?q=${encodeURIComponent(term)}`);
        const j = (await r.json()) as { rows?: Row[]; error?: string };
        if (cancelled) return;
        if (!r.ok) throw new Error(j.error ?? "ຄົ້ນຫາບໍ່ສຳເລັດ");
        setRows(j.rows ?? []);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "ຄົ້ນຫາບໍ່ສຳເລັດ");
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ພິມ ລະຫັດ ຫຼື ຊື່ສິນຄ້າ (ຢ່າງໜ້ອຍ 2 ຕົວ)"
          className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-10 pr-3 text-base outline-none focus:border-brand-500 dark:border-zinc-800 dark:bg-zinc-900"
        />
        {busy && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-zinc-400">
            ກຳລັງຄິດ…
          </span>
        )}
      </div>

      {/* ອະທິບາຍສູດໄວ້ຕິດກັບຕົວເລກ — ຄົນຕ້ອງເຊື່ອຕົວເລກນີ້ຈຶ່ງຈະໃຊ້ມັນ */}
      <p className="rounded-xl bg-aqua-50/60 px-4 py-2.5 text-xs leading-relaxed text-zinc-600 dark:bg-aqua-950/20 dark:text-zinc-400">
        <strong className="text-zinc-800 dark:text-zinc-200">ຄາດການ = ຄົງເຫຼືອ + ກຳລັງມາ − ຖືກຈອງ</strong>
        {" · "}ກຳລັງມາ = ຄ້າງຮັບຕາມໃບສັ່ງຊື້ທີ່ຍັງບໍ່ໄດ້ຮັບເຂົ້າ
        {" · "}ຖືກຈອງ = ຢູ່ໃນໃບ pick ທີ່ຍັງບໍ່ໄດ້ຢືນຢັນຈ່າຍ
      </p>

      {err && (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {err}
        </p>
      )}

      {rows === null ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-14 text-center dark:border-zinc-700">
          <TrendIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-3 font-semibold text-zinc-600 dark:text-zinc-300">
            ພິມລະຫັດ ຫຼື ຊື່ສິນຄ້າເພື່ອເລີ່ມ
          </p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            ຈະສະແດງທຸກສາງທີ່ທ່ານມີສິດ
          </p>
        </div>
      ) : (
        <DataList
          rows={rows}
          rowKey={(r) => `${r.wh_code}:${r.item_code}`}
          empty={`ບໍ່ພົບສິນຄ້າທີ່ຕົງກັບ "${q.trim()}"`}
          columns={[
            {
              header: "ສິນຄ້າ",
              card: "title",
              cell: (r) => (
                <>
                  <div className="font-mono text-[11px] font-bold text-brand-600 dark:text-brand-400">
                    {r.item_code}
                  </div>
                  <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.item_name ?? ""}>
                    {r.item_name ?? "—"}
                  </div>
                </>
              ),
            },
            {
              header: "ຄາດການ",
              align: "right",
              card: "value",
              cell: (r) => (
                <span
                  className={`font-mono font-bold tabular-nums ${
                    r.forecast > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : r.forecast < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-zinc-400"
                  }`}
                  title={`${fmt(r.on_hand)} + ${fmt(r.incoming)} − ${fmt(r.reserved)}`}
                >
                  {fmt(r.forecast)}
                </span>
              ),
            },
            {
              header: "ສາງ",
              cell: (r) => (
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  <span className="font-mono">{r.wh_code}</span>
                  {r.wh_name ? ` · ${r.wh_name}` : ""}
                </span>
              ),
            },
            {
              header: "ຄົງເຫຼືອ",
              align: "right",
              cell: (r) => (
                <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmt(r.on_hand)}
                  <span className="ml-1 text-[10px] uppercase text-zinc-400">{r.unit_code}</span>
                </span>
              ),
            },
            {
              header: "ກຳລັງມາ",
              align: "right",
              cell: (r) =>
                r.incoming > 0 ? (
                  <span className="font-mono font-semibold tabular-nums text-aqua-600 dark:text-aqua-400">
                    +{fmt(r.incoming)}
                  </span>
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-700">—</span>
                ),
            },
            {
              header: "ຖືກຈອງ",
              align: "right",
              cell: (r) =>
                r.reserved > 0 ? (
                  <span className="font-mono font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    −{fmt(r.reserved)}
                  </span>
                ) : (
                  <span className="text-zinc-300 dark:text-zinc-700">—</span>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

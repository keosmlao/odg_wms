"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { SearchIcon } from "@/components/ui/Icons";
import type { DefectShelfOption } from "@/lib/defects-shared";

/**
 * ລາຍງານຄົງເຫຼືອໃນສາງມີຕຳນິ — what SML says is sitting on a defect shelf versus
 * what has actually been written up in the defect register.
 *
 * The gap column (ຍັງບໍ່ໄດ້ບັນທຶກ) is the point of the report: stock parked on the
 * defect shelf that nobody has registered yet.
 *
 * One shelf at a time — the SML balance function is slow when unfiltered, so the
 * shelf has to be chosen before anything loads (same as the legacy screen).
 */

type Row = {
  ic_code: string;
  ic_name: string | null;
  unit_code: string | null;
  item_brand: string | null;
  warehouse: string;
  warehouse_name: string | null;
  location: string;
  location_name: string | null;
  sml_qty: string;
  registered_qty: string;
  unregistered_qty: string;
};

type Kpi = {
  items: number;
  sml_qty: number;
  registered_qty: number;
  unregistered_qty: number;
};

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-rose-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

export default function SmlDefectClient({ shelves }: { shelves: DefectShelfOption[] }) {
  const [location, setLocation] = useState(shelves.length === 1 ? shelves[0].code : "");
  const [rows, setRows] = useState<Row[]>([]);
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyGap, setOnlyGap] = useState(false);

  async function load() {
    if (!location) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/defects/sml?location=${encodeURIComponent(location)}`);
      const data = (await res.json()) as { kpi?: Kpi; rows?: Row[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "ບໍ່ສຳເລັດ");
      setKpi(data.kpi ?? null);
      setRows(data.rows ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ບໍ່ສຳເລັດ");
      setRows([]);
      setKpi(null);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyGap && (Number.parseFloat(r.unregistered_qty) || 0) <= 0) return false;
      if (!s) return true;
      return (
        r.ic_code.toLowerCase().includes(s) || (r.ic_name ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, q, onlyGap]);

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[280px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ບ່ອນຈັດເກັບເຄື່ອງມີຕຳນິ *</label>
            <select
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setRows([]);
                setKpi(null);
              }}
              className={`${inputCls} w-full`}
            >
              <option value="">— ເລືອກບ່ອນຈັດເກັບ —</option>
              {shelves.map((s) => (
                <option key={`${s.wh_code}-${s.code}`} value={s.code}>
                  {s.wh_code} {s.wh_name ?? ""} → {s.code} {s.name ?? ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={!location || loading}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-rose-500 to-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-rose-500/20 transition hover:shadow-lg disabled:opacity-50"
          >
            <SearchIcon className="h-4 w-4" />
            {loading ? "ກຳລັງກວດ..." : "ກວດຄົງເຫຼືອ"}
          </button>
        </div>
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
        {!kpi && !loading && !err && (
          <p className="mt-3 text-[11px] text-zinc-400">
            ⓘ ເລືອກບ່ອນຈັດເກັບ ແລ້ວກົດ &quot;ກວດຄົງເຫຼືອ&quot; — ການດຶງຍອດ SML ໃຊ້ເວລາ ຈຶ່ງໂຫຼດເທື່ອລະບ່ອນ
          </p>
        )}
      </section>

      {kpi && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="ສິນຄ້າ" value={kpi.items.toLocaleString("en-US")} sub="ລາຍການຢູ່ບ່ອນນີ້" />
          <Kpi label="ຍອດ SML" value={fmt(kpi.sml_qty)} sub="ຄົງເຫຼືອຕາມ SML" />
          <Kpi label="ບັນທຶກແລ້ວ" value={fmt(kpi.registered_qty)} tone="text-emerald-600 dark:text-emerald-400" sub="ມີໃນລາຍງານຕຳນິ" />
          <Kpi label="ຍັງບໍ່ໄດ້ບັນທຶກ" value={fmt(kpi.unregistered_qty)} tone="text-rose-600 dark:text-rose-400" sub="ຄວນບັນທຶກເພິ່ມ" />
        </section>
      )}

      {kpi && (
        <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
                {filtered.length.toLocaleString("en-US")} ລາຍການ
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                <input type="checkbox" checked={onlyGap} onChange={(e) => setOnlyGap(e.target.checked)} className="h-3.5 w-3.5 accent-rose-500" />
                ສະເພາະທີ່ຍັງບໍ່ໄດ້ບັນທຶກ
              </label>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ກອງສິນຄ້າ..." className={`${inputCls} py-2 pl-8 text-xs`} />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2.5">ສິນຄ້າ</th>
                  <th className="px-4 py-2.5">ຍີ່ຫໍ້</th>
                  <th className="px-4 py-2.5">ສາງ / ບ່ອນຈັດເກັບ</th>
                  <th className="px-4 py-2.5 text-right">ຍອດ SML</th>
                  <th className="px-4 py-2.5 text-right">ບັນທຶກແລ້ວ</th>
                  <th className="px-4 py-2.5 text-right">ຍັງບໍ່ໄດ້ບັນທຶກ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                      ບໍ່ມີລາຍການ
                    </td>
                  </tr>
                )}
                {filtered.map((r) => {
                  const gap = Number.parseFloat(r.unregistered_qty) || 0;
                  return (
                    <tr key={`${r.warehouse}-${r.ic_code}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-[11px] font-bold text-rose-700 dark:text-rose-400">{r.ic_code}</div>
                        <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.ic_name ?? ""}>
                          {r.ic_name ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{r.item_brand ?? "—"}</td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono">{r.warehouse}</span> · <span className="font-mono">{r.location}</span>
                        <div className="truncate text-[10px] text-zinc-400">{r.warehouse_name ?? ""}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-200">
                        {fmt(r.sml_qty)}
                        <span className="ml-1 text-[10px] text-zinc-400">{r.unit_code}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-sm tabular-nums text-emerald-600 dark:text-emerald-400">
                        {fmt(r.registered_qty)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-sm font-bold tabular-nums ${
                          gap > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : gap < 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-zinc-400"
                        }`}
                      >
                        {fmt(gap)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-zinc-400">
            ⓘ &quot;ຍັງບໍ່ໄດ້ບັນທຶກ&quot; = ຍອດ SML − ຍອດທີ່ບັນທຶກໄວ້ໃນລາຍງານຕຳນິ (ຍັງບໍ່ເບີກຈ່າຍ). ຄ່າຕິດລົບ = ບັນທຶກໄວ້ຫຼາຍກວ່າຍອດ SML ຄວນກວດຄືນ.{" "}
            <Link href="/defects/new" className="font-semibold text-rose-600 underline dark:text-rose-400">
              ບັນທຶກເຄື່ອງມີຕຳນິ
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "text-zinc-900 dark:text-zinc-50",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`mt-2 font-mono text-3xl font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-400">{sub}</div>}
    </div>
  );
}

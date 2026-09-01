"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SearchIcon } from "@/components/ui/Icons";
import type {
  DefectGrouping,
  DefectSummaryRow,
  DefectWarehouseOption,
} from "@/lib/defects-shared";

/**
 * Defective-goods balance report, shared by the two legacy screens:
 *   status 0 → ລາຍງານຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ຍັງບໍ່ເບີກຈ່າຍ)
 *   status 1 → ລາຍງານຄົງເຫຼືອເຄື່ອງມີຕຳນິ (ເບີກຈ່າຍແລ້ວ)
 *
 * Entries roll up per item (+warehouse); a row links to /defects/item/<code>,
 * where each entry can be edited, photographed and issued out.
 */

type Kpi = {
  groups: number;
  entries: number;
  total_qty: number;
  images: number;
  grade_c: number;
};

const inputCls =
  "rounded-lg bg-white px-3 py-2.5 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-rose-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";

function fmt(v: number | string | null | undefined) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0";
}

export default function DefectReportClient({
  status,
  warehouses,
  brands,
}: {
  status: 0 | 1;
  warehouses: DefectWarehouseOption[];
  brands: string[];
}) {
  /** Detail-page URL for a summary row, carrying the row's own scope. */
  const itemHref = (r: DefectSummaryRow) => {
    const p = new URLSearchParams({ status: String(status) });
    if (r.warehouse) p.set("wh", r.warehouse);
    return `/defects/item/${encodeURIComponent(r.ic_code)}?${p}`;
  };

  const [wh, setWh] = useState("");
  const [brand, setBrand] = useState("");
  const [group, setGroup] = useState<DefectGrouping>("warehouse");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [rows, setRows] = useState<DefectSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Search runs on the server: SN and ISN live on the individual entries, and
  // these rows are item×warehouse totals that never carry either — so a
  // client-side filter could only ever match the code and name.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ status: String(status), group });
    if (wh) p.set("wh", wh);
    if (brand) p.set("brand", brand);
    if (debouncedQ) p.set("q", debouncedQ);
    return p;
  }, [status, group, wh, brand, debouncedQ]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/defects?${params}`);
      const data = (await res.json()) as { kpi?: Kpi; rows?: DefectSummaryRow[]; error?: string };
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
  }, [params]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server already applied `q`; these are the rows to show as-is.
  const filtered = rows;

  const exportUrl = `/api/defects/export?${params}`;

  return (
    <div className="space-y-5">
      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ສາງ</label>
            <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທຸກສາງ —</option>
              {warehouses.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} · {w.name ?? ""}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຍີ່ຫໍ້</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)} className={`${inputCls} w-full`}>
              <option value="">— ທຸກຍີ່ຫໍ້ —</option>
              {brands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">ຈັດກຸ່ມ</label>
            <div className="inline-flex overflow-hidden rounded-lg ring-1 ring-zinc-200 dark:ring-zinc-800">
              {(
                [
                  ["warehouse", "ຕາມສາງ"],
                  ["item", "ລວມທຸກສາງ"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setGroup(value)}
                  className={`px-3 py-2.5 text-xs font-semibold transition ${
                    group === value
                      ? "bg-rose-500 text-white"
                      : "bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <a
            href={exportUrl}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-200 dark:ring-zinc-800"
          >
            ດາວໂຫຼດ Excel
          </a>
        </div>
        {err && <p className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
      </section>

      {kpi && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="ຈຳນວນລວມ" value={fmt(kpi.total_qty)} tone="text-rose-600 dark:text-rose-400" sub="ໜ່ວຍທີ່ມີຕຳນິ" />
          <Kpi label="ລາຍການບັນທຶກ" value={kpi.entries.toLocaleString("en-US")} sub={`${kpi.groups} ກຸ່ມສິນຄ້າ`} />
          <Kpi label="ເກຣດ C" value={kpi.grade_c.toLocaleString("en-US")} tone="text-amber-600 dark:text-amber-400" sub="ເສີຍຫາຍໜັກ" />
          <Kpi label="ຮູບພາບ" value={kpi.images.toLocaleString("en-US")} sub="ຮູບທີ່ເກັບໄວ້" />
        </section>
      )}

      <section className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {/* Three tracks so the search sits at the true centre of the card, not
            wherever the row label happens to end. */}
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            {loading ? "ກຳລັງໂຫຼດ..." : `${filtered.length.toLocaleString("en-US")} ກຸ່ມສິນຄ້າ`}
          </div>

          <div className="relative w-full sm:w-[26rem] sm:justify-self-center">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່ / SN / ISN..."
              className={`${inputCls} w-full py-2 pl-8 pr-16 text-xs`}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                aria-label="ລ້າງການຄົ້ນຫາ"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
              >
                ລ້າງ
              </button>
            )}
          </div>

          <div className="hidden sm:block" />
        </div>

        {debouncedQ && !loading && (
          <p className="mb-3 text-[11px] text-zinc-400">
            ຜົນການຄົ້ນຫາ &ldquo;{debouncedQ}&rdquo; — ຄົ້ນທັງ ລະຫັດ, ຊື່, SN ແລະ ISN
          </p>
        )}

        <div className="overflow-x-auto rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                <th className="px-4 py-2.5">ສິນຄ້າ</th>
                <th className="px-4 py-2.5">ຍີ່ຫໍ້</th>
                {group === "warehouse" && <th className="px-4 py-2.5">ສາງ</th>}
                <th className="px-4 py-2.5 text-right">ຈຳນວນ</th>
                <th className="px-4 py-2.5 text-center">ເກຣດ</th>
                <th className="px-4 py-2.5 text-right">ລາຍການ</th>
                <th className="px-4 py-2.5 text-right">ຮູບ</th>
                <th className="px-4 py-2.5">ບັນທຶກລ່າສຸດ</th>
                <th className="w-20 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    ບໍ່ມີລາຍການ
                  </td>
                </tr>
              )}
              {filtered.map((r) => (
                <tr
                  key={`${r.ic_code}-${r.warehouse ?? "all"}`}
                  className="transition hover:bg-rose-50/40 dark:hover:bg-rose-950/20"
                >
                  <td className="px-4 py-2.5">
                    {/* The whole row is a link target; anchoring it on the item
                        cell keeps middle-click / "open in new tab" working. */}
                    <Link href={itemHref(r)} className="block">
                      <div className="font-mono text-[11px] font-bold text-rose-700 underline-offset-2 hover:underline dark:text-rose-400">
                        {r.ic_code}
                      </div>
                      <div className="max-w-md truncate text-xs text-zinc-700 dark:text-zinc-300" title={r.ic_name ?? ""}>
                        {r.ic_name ?? "—"}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">{r.item_brand ?? "—"}</td>
                  {group === "warehouse" && (
                    <td className="px-4 py-2.5 text-xs text-zinc-500 dark:text-zinc-400">
                      <span className="font-mono">{r.warehouse ?? "—"}</span>
                      <div className="truncate text-[10px] text-zinc-400">{r.warehouse_name ?? ""}</div>
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {fmt(r.qty)}
                    <span className="ml-1 text-[10px] font-normal text-zinc-400">{r.unit_code}</span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <GradeSpread row={r} />
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                    {r.entries}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums text-zinc-500">
                    {r.images > 0 ? r.images : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-zinc-500">{r.last_register ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      href={itemHref(r)}
                      className="inline-block rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-600 ring-1 ring-zinc-200 transition hover:bg-rose-50 hover:text-rose-700 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-rose-950/30"
                    >
                      ເປີດ →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-zinc-400">
          ⓘ ກົດລະຫັດສິນຄ້າ ຫຼື &quot;ເປີດ&quot; ເພື່ອໄປໜ້າລາຍການຍ່ອຍ — ເບິ່ງ SN ທຸກໜ່ວຍ, ແກ້ໄຂ, ເພິ່ມຮູບ, ເບີກຈ່າຍຫຼາຍລາຍການພ້ອມກັນ ແລະ ພິມ
        </p>
      </section>
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

/** Compact A/B/C entry-count breakdown for a summary row. */
function GradeSpread({ row }: { row: DefectSummaryRow }) {
  const parts: { label: string; n: number; cls: string }[] = [
    { label: "A", n: row.grade_a, cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
    { label: "B", n: row.grade_b, cls: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" },
    { label: "C", n: row.grade_c, cls: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
    { label: "–", n: row.grade_none, cls: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  return (
    <div className="flex items-center justify-center gap-1">
      {parts.map((p) => (
        <span key={p.label} className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${p.cls}`}>
          {p.label}·{p.n}
        </span>
      ))}
    </div>
  );
}

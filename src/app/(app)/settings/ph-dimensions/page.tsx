import { redirect } from "next/navigation";
import { AlertIcon, CheckIcon, PackageIcon } from "@/components/ui/Icons";
import { Chip, Hero, KpiCard, Notice } from "@/components/ui/Card";
import { query } from "@/lib/db";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";
import { getSession } from "@/lib/session";

type SummaryRow = {
  stock_skus: number;
  matched_skus: number;
  unmatched_skus: number;
  stock_qty: string;
  matched_qty: string;
  estimated_pallets: string;
};

type MissingRow = {
  item_code: string;
  item_name: string | null;
  qty: string;
  item_category: string | null;
  item_size: string | null;
  item_design: string | null;
  item_air: string | null;
};

function fmt(value: string | number) {
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { maximumFractionDigits: 1 })
    : "0";
}

export default async function PhDimensionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const [summaryRows, missingRows, ruleRows] = await Promise.all([
    query<SummaryRow>(
      `WITH stock AS (
         SELECT item_code, SUM(qty * COALESCE(calc_flag, 1))::numeric AS qty
         FROM public.odg_wms_trans_detail
         WHERE status = 0 OR status IS NULL
         GROUP BY item_code
         HAVING SUM(qty * COALESCE(calc_flag, 1)) > 0
       ),
       classified AS (
         SELECT s.*, ph.pallet
         FROM stock s
         LEFT JOIN public.ic_inventory inv ON inv.code = s.item_code
         ${phDimensionLateralJoin("inv")}
       )
       SELECT
         count(*)::int AS stock_skus,
         count(*) FILTER (WHERE pallet > 0)::int AS matched_skus,
         count(*) FILTER (WHERE pallet IS NULL)::int AS unmatched_skus,
         COALESCE(SUM(qty), 0)::text AS stock_qty,
         COALESCE(SUM(qty) FILTER (WHERE pallet > 0), 0)::text AS matched_qty,
         COALESCE(SUM(ceil(qty / pallet)) FILTER (WHERE pallet > 0), 0)::text AS estimated_pallets
       FROM classified`,
    ),
    query<MissingRow>(
      `WITH stock AS (
         SELECT
           item_code,
           MAX(item_name) AS item_name,
           SUM(qty * COALESCE(calc_flag, 1))::numeric AS qty
         FROM public.odg_wms_trans_detail
         WHERE status = 0 OR status IS NULL
         GROUP BY item_code
         HAVING SUM(qty * COALESCE(calc_flag, 1)) > 0
       )
       SELECT
         s.item_code,
         COALESCE(NULLIF(s.item_name, ''), inv.name_1) AS item_name,
         s.qty::text,
         inv.item_category,
         inv.item_size,
         inv.item_design,
         inv.item_air
       FROM stock s
       LEFT JOIN public.ic_inventory inv ON inv.code = s.item_code
       ${phDimensionLateralJoin("inv")}
       WHERE ph.pallet IS NULL
       ORDER BY s.qty DESC, s.item_code
       LIMIT 200`,
    ),
    query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM public.odg_wms_ph_dimension
       WHERE pallet > 0`,
    ),
  ]);

  const summary = summaryRows[0] ?? {
    stock_skus: 0,
    matched_skus: 0,
    unmatched_skus: 0,
    stock_qty: "0",
    matched_qty: "0",
    estimated_pallets: "0",
  };
  const skuCoverage =
    summary.stock_skus > 0
      ? (summary.matched_skus / summary.stock_skus) * 100
      : 0;
  const stockQty = Number(summary.stock_qty) || 0;
  const qtyCoverage =
    stockQty > 0 ? ((Number(summary.matched_qty) || 0) / stockQty) * 100 : 0;

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ກວດສອບ PH Dimension"
        description="ກວດ coverage ຂອງ pallet/stack master ທີ່ໃຊ້ຄຳນວນຄວາມຈຸທົ່ວລະບົບ"
        icon={<PackageIcon className="h-6 w-6" />}
        tone="brand"
        chips={
          <>
            <Chip tone="brand">{ruleRows[0]?.total ?? 0} PH rules</Chip>
            <Chip tone={summary.unmatched_skus > 0 ? "amber" : "emerald"}>
              {summary.unmatched_skus > 0
                ? `${summary.unmatched_skus} SKU ຍັງບໍ່ກົງ PH`
                : "PH coverage ຄົບ"}
            </Chip>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<PackageIcon className="h-4 w-4" />}
          label="SKU ຄົງເຫຼືອ"
          value={summary.stock_skus}
        />
        <KpiCard
          icon={<CheckIcon className="h-4 w-4" />}
          label="SKU coverage"
          value={`${skuCoverage.toFixed(1)}%`}
          sub={`${summary.matched_skus}/${summary.stock_skus} SKU`}
          tone={skuCoverage >= 90 ? "emerald" : "amber"}
          highlight
        />
        <KpiCard
          icon={<CheckIcon className="h-4 w-4" />}
          label="Qty coverage"
          value={`${qtyCoverage.toFixed(1)}%`}
          sub={`${fmt(summary.matched_qty)}/${fmt(summary.stock_qty)} ໜ່ວຍ`}
          tone={qtyCoverage >= 90 ? "emerald" : "amber"}
          highlight
        />
        <KpiCard
          icon={<PackageIcon className="h-4 w-4" />}
          label="ພາເລດທີ່ຄຳນວນໄດ້"
          value={fmt(summary.estimated_pallets)}
          tone="brand"
          highlight
        />
      </section>

      {summary.unmatched_skus > 0 && (
        <Notice
          tone="amber"
          icon={<AlertIcon className="h-5 w-5" />}
          title="Capacity ທີ່ສະແດງເປັນຄ່າຢ່າງໜ້ອຍ"
          description="SKU ທີ່ບໍ່ກົງ PH ຈະບໍ່ຖືກນັບເຂົ້າຈຳນວນພາເລດ. ຄວນເພີ່ມ rule ໃນ odg_wms_ph_dimension ຕາມ category, size, design ແລະ air."
        />
      )}

      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">
            SKU ຄົງເຫຼືອທີ່ຈັບຄູ່ PH ບໍ່ໄດ້
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            ສະແດງ 200 ລາຍການທີ່ມີຈຳນວນຄົງເຫຼືອສູງສຸດ
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-[10px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/60">
              <tr>
                <th className="px-4 py-2">ສິນຄ້າ</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Design</th>
                <th className="px-4 py-2">Air</th>
                <th className="px-4 py-2 text-right">ຄົງເຫຼືອ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {missingRows.map((row) => (
                <tr key={row.item_code}>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs font-semibold">
                      {row.item_code}
                    </div>
                    <div className="max-w-md truncate text-xs text-zinc-500">
                      {row.item_name ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.item_category || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.item_size || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.item_design || "—"}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.item_air || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">
                    {fmt(row.qty)}
                  </td>
                </tr>
              ))}
              {missingRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-sm text-emerald-600">
                    ທຸກ SKU ຄົງເຫຼືອຈັບຄູ່ PH ໄດ້ແລ້ວ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

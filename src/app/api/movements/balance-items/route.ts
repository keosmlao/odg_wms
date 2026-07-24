import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";

export type BalanceItemRow = {
  ic_code: string | null;
  ic_name: string | null;
  ic_unit_code: string | null;
  balance_qty: string | null;
  is_isn: number | null;
  pallet_positions: string | null;
  units_per_pallet: string | null;
  stack: string | null;
  total_count: number;
};

function clampLimit(value: string | null) {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n)) return 50;
  return Math.min(Math.max(n, 1), 200);
}

function offsetValue(value: string | null) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Returns aggregated stock balance for items at an exact (warehouse, rack,
 * location, pallet) node, computed from `odg_wms_trans_detail`.
 *
 * Each filter is exact-match including the empty string. The empty string
 * means "items at this level only" — i.e., a row in trans_detail with that
 * field empty/null. So:
 *
 *   warehouse=1101 rack=        → items stored at warehouse level only
 *   warehouse=1101 rack=110101 location=        → items at rack level only
 *   warehouse=1101 rack=110101 location=110101-A01 pallet= → at location level
 *   warehouse=1101 rack=110101 location=110101-A01 pallet=PLT001 → at pallet
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ items: [], total: 0 });
  }

  const url = new URL(request.url);
  const warehouse = url.searchParams.get("warehouse")?.trim() ?? "";
  const rack = url.searchParams.get("rack")?.trim() ?? "";
  const location = url.searchParams.get("location")?.trim() ?? "";
  const pallet = url.searchParams.get("pallet")?.trim() ?? "";
  const limit = clampLimit(url.searchParams.get("limit"));
  const offset = offsetValue(url.searchParams.get("offset"));

  const q = url.searchParams.get("q")?.trim() ?? "";

  if (!warehouse) {
    return NextResponse.json(
      { error: "warehouse ຈຳເປັນຕ້ອງມີ" },
      { status: 400 },
    );
  }
  if (Array.isArray(accessible) && !accessible.includes(warehouse)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const queryArgs: unknown[] = [warehouse, rack, location, pallet];
  // No `status` filter — status=1 marks the outbound (-1) leg of an internal bin
  // relocation (trans_flag 77) plus a few status=1 sales legs, not voided rows.
  // Excluding it drops real stock reductions and inflates the per-bin balance,
  // so the drilldown here must match the tree/table totals on the balance page.
  const filters = [
    "t.wh_code = $1",
    "COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') = $2",
    "COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3",
    "COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $4",
  ];

  if (q) {
    queryArgs.push(`%${q}%`);
    filters.push(`(t.item_code ILIKE $5 OR t.item_name ILIKE $5)`);
  }

  queryArgs.push(limit, offset);
  const limitIdx = queryArgs.length - 1;
  const offsetIdx = queryArgs.length;

  const rows = await query<BalanceItemRow>(
    `WITH agg AS (
       SELECT
         t.item_code,
         MAX(t.item_name) AS item_name,
         MAX(t.unit_code) AS unit_code,
         SUM(t.qty * t.calc_flag)::numeric AS balance_qty
       FROM public.odg_wms_trans_detail t
       WHERE ${filters.join(" AND ")}
       GROUP BY t.item_code
       HAVING SUM(t.qty * t.calc_flag) <> 0
     )
     SELECT
       agg.item_code AS ic_code,
       agg.item_name AS ic_name,
       agg.unit_code AS ic_unit_code,
       agg.balance_qty::text AS balance_qty,
       inv.is_isn,
       CASE WHEN ph.pallet > 0 AND agg.balance_qty > 0
            THEN round((agg.balance_qty / ph.pallet)::numeric, 3)::text
            ELSE NULL END AS pallet_positions,
       ph.pallet::text AS units_per_pallet,
       ph.stack::text AS stack,
       COUNT(*) OVER()::int AS total_count
     FROM agg
     LEFT JOIN public.ic_inventory inv ON inv.code = agg.item_code
     ${phDimensionLateralJoin("inv")}
     ORDER BY agg.item_code
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    queryArgs,
  );

  return NextResponse.json({
    items: rows.map(({ total_count: _t, ...row }) => row),
    total: rows[0]?.total_count ?? 0,
  });
}

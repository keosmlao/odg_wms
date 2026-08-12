import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";

/**
 * Putaway helper: every defined bin (odg_wms_location1) with its current
 * occupancy (distinct items + net qty from odg_wms_trans_detail), so the
 * operator can find empty / lightly-used bins to put incoming goods into.
 *
 * ບໍ່ມີການເລືອກສາງ — ຄືນທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດ ພ້ອມ `wh_code` ຕໍ່ແຖວ ໃຫ້ໜ້າຈໍແຍກກຸ່ມ.
 * GET → { warehouses, kpi, rows }
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const warehouses = await scopedWarehouses(session, new URL(request.url).searchParams.get("wh"));
  if (warehouses.length === 0) {
    return NextResponse.json({ warehouses: [], kpi: { total: 0, empty: 0, occupied: 0, utilization: 0 }, rows: [] });
  }
  const whCodes = warehouses.map((w) => w.code);

  const rows = await query<{
    wh_code: string; location: string; name: string | null; rack: string | null;
    items: number; qty: string; empty: boolean;
  }>(
    `WITH occ AS (
       SELECT wh_code,
              COALESCE(NULLIF(TRIM(shelf_code1), ''), '') AS location,
              SUM(qty * calc_flag) AS qty,
              count(DISTINCT item_code) AS items
       FROM public.odg_wms_trans_detail
       WHERE wh_code = ANY($1)
       GROUP BY 1, 2
       HAVING SUM(qty * calc_flag) > 0.0001
     )
     SELECT l.wh_code, l.code AS location, l.name_1 AS name, l.location_id AS rack,
            COALESCE(o.items, 0)::int AS items,
            COALESCE(o.qty, 0)::numeric::text AS qty,
            (o.location IS NULL) AS empty
     FROM public.odg_wms_location1 l
     LEFT JOIN occ o ON o.location = l.code AND o.wh_code = l.wh_code
     WHERE l.wh_code = ANY($1)
     ORDER BY l.wh_code, l.location_id, l.code`,
    [whCodes],
  );

  const total = rows.length;
  const empty = rows.filter((r) => r.empty).length;
  return NextResponse.json({
    warehouses,
    kpi: {
      total,
      empty,
      occupied: total - empty,
      utilization: total > 0 ? Math.round(((total - empty) / total) * 1000) / 10 : 0,
    },
    rows,
  });
}

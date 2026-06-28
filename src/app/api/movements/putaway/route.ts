import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Putaway helper: every defined bin (odg_wms_location1) in a warehouse with its
 * current occupancy (distinct items + net qty from odg_wms_trans_detail), so the
 * operator can find empty / lightly-used bins to put incoming goods into.
 *
 * GET ?wh=<code>  → { kpi, rows } (rows = one per bin, grouped client-side by rack)
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const wh = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await query<{
    location: string; name: string | null; rack: string | null;
    items: number; qty: string; empty: boolean;
  }>(
    `WITH occ AS (
       SELECT COALESCE(NULLIF(TRIM(shelf_code1), ''), '') AS location,
              SUM(qty * calc_flag) AS qty,
              count(DISTINCT item_code) AS items
       FROM public.odg_wms_trans_detail
       WHERE wh_code = $1
       GROUP BY 1
       HAVING SUM(qty * calc_flag) > 0.0001
     )
     SELECT l.code AS location, l.name_1 AS name, l.location_id AS rack,
            COALESCE(o.items, 0)::int AS items,
            COALESCE(o.qty, 0)::numeric::text AS qty,
            (o.location IS NULL) AS empty
     FROM public.odg_wms_location1 l
     LEFT JOIN occ o ON o.location = l.code
     WHERE l.wh_code = $1
     ORDER BY l.location_id, l.code`,
    [wh],
  );

  const total = rows.length;
  const empty = rows.filter((r) => r.empty).length;
  return NextResponse.json({
    kpi: {
      total,
      empty,
      occupied: total - empty,
      utilization: total > 0 ? Math.round(((total - empty) / total) * 1000) / 10 : 0,
    },
    rows,
  });
}

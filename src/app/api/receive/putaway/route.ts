import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Putaway location suggestions for a warehouse:
 *   sameLocs  = locations already holding one of the given items (รวมกอง)
 *   emptyLocs = known locations whose net balance is ≤ 0 (ว่าง)
 * Query: ?wh=<code>&items=<code,code,...>
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ sameLocs: [], emptyLocs: [] });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const items = (url.searchParams.get("items") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [sameLocs, emptyLocs] = await Promise.all([
    items.length
      ? query<{ location: string; item_code: string; qty: string }>(
          `SELECT NULLIF(TRIM(shelf_code1), '') AS location, item_code, SUM(qty * calc_flag)::numeric::text AS qty
           FROM public.odg_wms_trans_detail
           WHERE wh_code = $1 AND item_code = ANY($2) AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL
             AND (status = 0 OR status IS NULL)
           GROUP BY 1, item_code HAVING SUM(qty * calc_flag) > 0.0001
           ORDER BY SUM(qty * calc_flag) DESC LIMIT 30`,
          [wh, items],
        )
      : Promise.resolve([]),
    query<{ location: string }>(
      `SELECT location FROM (
         SELECT NULLIF(TRIM(shelf_code1), '') AS location, SUM(qty * calc_flag) AS bal
         FROM public.odg_wms_trans_detail
         WHERE wh_code = $1 AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL AND (status = 0 OR status IS NULL)
         GROUP BY 1
       ) x WHERE bal <= 0.0001 ORDER BY location LIMIT 30`,
      [wh],
    ),
  ]);

  return NextResponse.json({ sameLocs, emptyLocs: emptyLocs.map((r) => r.location) });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Flat list of stock-balance nodes for one warehouse, computed from
 * `odg_wms_trans_detail` (qty × calc_flag, status = 0). The client builds the
 * rack → location → pallet tree from these rows.
 *
 * Query: ?wh=CODE
 * Returns: { wh:{code,name}, nodes:[{ rack_code, rack_name, location_code,
 *            location_name, pallet_code, item_count, qty }] }
 *
 * Codes are exact strings ("" = stored at the level above only).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  }

  const wh = (new URL(request.url).searchParams.get("wh") ?? "").trim();
  if (!wh) {
    return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [whRows, nodes, rackMaster, locationMaster] = await Promise.all([
    query<{ code: string; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = $1`,
      [wh],
    ),
    query<{
      rack_code: string;
      location_code: string;
      pallet_code: string;
      item_count: number;
      qty: string;
    }>(
      `SELECT
         COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack_code,
         COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
         COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet_code,
         count(DISTINCT t.item_code)::int              AS item_count,
         SUM(t.qty * t.calc_flag)::text                AS qty
       FROM public.odg_wms_trans_detail t
       WHERE (t.status = 0 OR t.status IS NULL)
         AND t.wh_code = $1
       GROUP BY rack_code, location_code, pallet_code
       HAVING SUM(t.qty * t.calc_flag) <> 0
       ORDER BY rack_code, location_code, pallet_code`,
      [wh],
    ),
    query<{ code: string | null; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.odg_wms_location WHERE wh_code = $1`,
      [wh],
    ),
    query<{ code: string | null; name: string | null; rack_code: string | null }>(
      `SELECT code, name_1 AS name, location_id AS rack_code
       FROM public.odg_wms_location1 WHERE wh_code = $1`,
      [wh],
    ),
  ]);

  const rackName = new Map<string, string>();
  for (const r of rackMaster) if (r.code && r.name) rackName.set(r.code, r.name);
  const locName = new Map<string, string>();
  for (const l of locationMaster) {
    if (l.rack_code && l.code && l.name) locName.set(`${l.rack_code}|${l.code}`, l.name);
  }

  const enriched = nodes.map((n) => ({
    rack_code: n.rack_code,
    rack_name: n.rack_code ? rackName.get(n.rack_code) ?? null : null,
    location_code: n.location_code,
    location_name:
      n.rack_code && n.location_code
        ? locName.get(`${n.rack_code}|${n.location_code}`) ?? null
        : null,
    pallet_code: n.pallet_code,
    item_count: n.item_count,
    qty: n.qty,
  }));

  return NextResponse.json({
    wh: { code: wh, name: whRows[0]?.name ?? null },
    nodes: enriched,
  });
}

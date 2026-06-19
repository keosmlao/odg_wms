import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * "Where is this item" — every (warehouse, rack, location, pallet) node that
 * holds a non-zero balance of items matching `q` (code or name), within the
 * session's accessible warehouses.
 *
 * Query: ?q=...&limit=200
 * Returns: { items:[{ wh_code, rack, location, pallet, item_code, item_name,
 *            unit_code, qty }] }
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ items: [] });
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1), 500);

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const args: unknown[] = [`%${escapeLike(q)}%`];
  const filters = [
    "(t.status = 0 OR t.status IS NULL)",
    "t.wh_code IS NOT NULL AND t.wh_code <> ''",
    "(t.item_code ILIKE $1 ESCAPE '\\' OR t.item_name ILIKE $1 ESCAPE '\\')",
  ];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    filters.push(`t.wh_code = ANY($${args.length})`);
  }
  args.push(limit);
  const limitIdx = args.length;

  const items = await query<{
    wh_code: string;
    rack: string;
    location: string;
    pallet: string;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    qty: string;
  }>(
    `SELECT
       t.wh_code,
       COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
       COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
       COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
       t.item_code,
       MAX(t.item_name) AS item_name,
       MAX(t.unit_code) AS unit_code,
       SUM(t.qty * t.calc_flag)::text AS qty
     FROM public.odg_wms_trans_detail t
     WHERE ${filters.join(" AND ")}
     GROUP BY t.wh_code, rack, location, pallet, t.item_code
     HAVING SUM(t.qty * t.calc_flag) <> 0
     ORDER BY t.item_code, t.wh_code, rack, location, pallet
     LIMIT $${limitIdx}`,
    args,
  );

  return NextResponse.json({ items });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Does a scanned serial (SN or ISN) already exist in the system for an item?
 * Used by the stock-adjust serial picker: a found unit must map to a known
 * serial; only when NOT found may the operator create a brand-new ISN.
 *
 * Query: ?item=<code>&code=<scanned sn/isn>&wh=<code>
 * Returns: { found, isn, sn, status, wh_code, rack, location, pallet, in_stock,
 *            here } — `here` = already in stock at the given warehouse.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const item = url.searchParams.get("item")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!item || !code) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  // Prefer an in-stock row, then any row; match by ISN or SN.
  const rows = await query<{
    sn: string | null;
    isn: string | null;
    status: number | null;
    wh_code: string | null;
    rack: string | null;
    location: string | null;
    pallet: string | null;
  }>(
    `SELECT sn, isn, status, wh_code, rack, location, pallet
     FROM public.sn_inventory
     WHERE item_code = $1 AND (isn = $2 OR sn = $2)
     ORDER BY (COALESCE(status, 0) = 0) DESC, (wh_code = $3) DESC
     LIMIT 1`,
    [item, code, wh],
  );

  if (rows.length === 0) {
    return NextResponse.json({ found: false });
  }
  const r = rows[0];
  const inStock = (r.status ?? 0) === 0;
  return NextResponse.json({
    found: true,
    isn: r.isn,
    sn: r.sn,
    status: r.status,
    wh_code: r.wh_code,
    rack: r.rack,
    location: r.location,
    pallet: r.pallet,
    in_stock: inStock,
    here: inStock && r.wh_code === wh,
  });
}

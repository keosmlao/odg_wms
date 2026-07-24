import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

export type StockLocationRow = {
  wh_code: string;
  wh_name: string | null;
  location: string | null;
  location_name: string | null;
  balance_qty: string;
  unit_code: string | null;
};

/**
 * Per-location ERP (SML) stock breakdown for one item, across ALL warehouses —
 * used by the transfer-request page so a requester can see where else the item
 * sits before picking a source warehouse. Query: ?item_code=<code>
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const itemCode = url.searchParams.get("item_code")?.trim() ?? "";
  if (!itemCode) {
    return NextResponse.json({ error: "item_code ຈຳເປັນ" }, { status: 400 });
  }

  const rows = await query<StockLocationRow>(
    `SELECT a.warehouse AS wh_code, w.name_1 AS wh_name,
            a.location, s.name_1 AS location_name,
            round(a.balance_qty, 2)::text AS balance_qty,
            a.ic_unit_code AS unit_code
     FROM public.sml_ic_function_stock_balance_warehouse_location('2099-12-31'::date, $1, '', '') a
     LEFT JOIN public.ic_warehouse w ON w.code = a.warehouse
     LEFT JOIN public.ic_shelf s ON s.code = a.location
     WHERE a.balance_qty != 0
     ORDER BY a.warehouse, a.location`,
    [itemCode],
  ).catch(() => [] as StockLocationRow[]);

  return NextResponse.json({ rows });
}

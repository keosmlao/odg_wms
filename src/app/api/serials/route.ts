import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Search / list serial numbers from the ERP balance view `odg_sn_balance`
 * (read-only). Requires a filter (q OR wh) to bound the scan over the view.
 *
 * Query: ?q=&wh=&status=&limit=&offset=
 *   status: 'instock' (default) | 'issued' | 'all'
 * Returns: { items:[{sn,qty,item_code,item_name,unit_code,wh_code,wh_name,item_brand,status_name}], hasMore }
 */
const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";
const STATUS_ISSUED = "ຈ່າຍອອກແລ້ວ";

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ items: [], hasMore: false });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const item = (url.searchParams.get("item") ?? "").trim(); // exact item_code
  const status = (url.searchParams.get("status") ?? "instock").trim();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  // Bound the scan over the view: need a search term, an exact item, or a warehouse.
  if (!q && !wh && !item) {
    return NextResponse.json({ items: [], hasMore: false, needFilter: true });
  }

  if (Array.isArray(accessible) && wh && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const where: string[] = [];
  const args: unknown[] = [];

  if (status === "instock") where.push(`b.status_name = '${STATUS_INSTOCK}'`);
  else if (status === "issued") where.push(`b.status_name = '${STATUS_ISSUED}'`);

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`b.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`b.wh_code = $${args.length}`);
  }
  if (item) {
    args.push(item);
    where.push(`b.item_code = $${args.length}`);
  }
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    const i = args.length;
    where.push(`(b.sn ILIKE $${i} ESCAPE '\\' OR b.item_code ILIKE $${i} ESCAPE '\\' OR b.item_name ILIKE $${i} ESCAPE '\\')`);
  }

  args.push(limit + 1, offset);
  const rows = await query<{
    sn: string;
    qty: string;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    wh_code: string;
    wh_name: string | null;
    item_brand: string | null;
    status_name: string | null;
  }>(
    `SELECT b.sn, b.qty::text AS qty, b.item_code, b.item_name, b.unit_code,
            b.wh_code, b.wh_name, b.item_brand, b.status_name
     FROM public.odg_sn_balance b
     WHERE ${where.join(" AND ")}
     ORDER BY b.item_code, b.sn
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );

  const hasMore = rows.length > limit;
  return NextResponse.json({ items: hasMore ? rows.slice(0, limit) : rows, hasMore });
}

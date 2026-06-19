import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Serial counts grouped by item (item-centric SN management).
 * Query: ?wh=&q=&status=&limit=&offset=
 * Returns: { items:[{item_code,item_name,item_brand,count}], hasMore }
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
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "instock").trim();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const where: string[] = [];
  const args: unknown[] = [];
  if (status === "instock") where.push(`b.status_name = '${STATUS_INSTOCK}'`);
  else if (status === "issued") where.push(`b.status_name = '${STATUS_ISSUED}'`);
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`b.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    if (Array.isArray(accessible) && !accessible.includes(wh)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    args.push(wh);
    where.push(`b.wh_code = $${args.length}`);
  }
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    const i = args.length;
    where.push(`(b.item_code ILIKE $${i} ESCAPE '\\' OR b.item_name ILIKE $${i} ESCAPE '\\')`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  args.push(limit + 1, offset);
  const rows = await query<{
    item_code: string;
    item_name: string | null;
    item_brand: string | null;
    count: number;
  }>(
    `SELECT b.item_code, MAX(b.item_name) AS item_name, MAX(b.item_brand) AS item_brand,
            count(*)::int AS count
     FROM public.odg_sn_balance b ${whereSql}
     GROUP BY b.item_code
     ORDER BY b.item_code
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  const hasMore = rows.length > limit;
  return NextResponse.json({ items: hasMore ? rows.slice(0, limit) : rows, hasMore });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Serial counts grouped by warehouse (warehouse-centric SN view).
 * Query: ?status=
 * Returns: { warehouses:[{wh_code,wh_name,count,item_count}] }
 */
const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";
const STATUS_ISSUED = "ຈ່າຍອອກແລ້ວ";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ warehouses: [] });
  }

  const status = (new URL(request.url).searchParams.get("status") ?? "instock").trim();
  const where: string[] = [];
  const args: unknown[] = [];
  if (status === "instock") where.push(`b.status_name = '${STATUS_INSTOCK}'`);
  else if (status === "issued") where.push(`b.status_name = '${STATUS_ISSUED}'`);
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`b.wh_code = ANY($${args.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const warehouses = await query<{
    wh_code: string;
    wh_name: string | null;
    count: number;
    item_count: number;
  }>(
    `SELECT b.wh_code, MAX(b.wh_name) AS wh_name,
            count(*)::int AS count,
            count(DISTINCT b.item_code)::int AS item_count
     FROM public.odg_sn_balance b ${whereSql}
     GROUP BY b.wh_code
     ORDER BY b.wh_code`,
    args,
  );
  return NextResponse.json({ warehouses });
}

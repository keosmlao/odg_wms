import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/** KPI counts for SN management (from odg_sn_balance). Query: ?wh= */
const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";
const STATUS_ISSUED = "ຈ່າຍອອກແລ້ວ";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ instock: 0, issued: 0, items: 0 });
  }

  const wh = (new URL(request.url).searchParams.get("wh") ?? "").trim();
  const where: string[] = [];
  const args: unknown[] = [];
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
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const rows = await query<{ instock: number; issued: number; items: number }>(
    `SELECT
       count(*) FILTER (WHERE b.status_name = '${STATUS_INSTOCK}')::int AS instock,
       count(*) FILTER (WHERE b.status_name = '${STATUS_ISSUED}')::int AS issued,
       count(DISTINCT b.item_code) FILTER (WHERE b.status_name = '${STATUS_INSTOCK}')::int AS items
     FROM public.odg_sn_balance b ${whereSql}`,
    args,
  );
  return NextResponse.json(rows[0] ?? { instock: 0, issued: 0, items: 0 });
}

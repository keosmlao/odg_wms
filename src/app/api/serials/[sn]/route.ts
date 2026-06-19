import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * One serial number — its current balance row(s) from `odg_sn_balance` plus the
 * full movement history from `odg_sn_trans_detail` (both ERP views, read-only).
 * Scoped to the session's accessible warehouses.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ sn: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { sn: rawSn } = await ctx.params;
  const sn = decodeURIComponent(rawSn).trim();
  if (!sn) return NextResponse.json({ error: "serial ບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ sn, balance: [], history: [] });
  }

  const balArgs: unknown[] = [sn];
  let balScope = "";
  if (Array.isArray(accessible)) {
    balArgs.push(accessible);
    balScope = `AND b.wh_code = ANY($${balArgs.length})`;
  }

  const hisArgs: unknown[] = [sn];
  let hisScope = "";
  if (Array.isArray(accessible)) {
    hisArgs.push(accessible);
    hisScope = `AND t.warehouse = ANY($${hisArgs.length})`;
  }

  const [balance, history] = await Promise.all([
    query(
      `SELECT b.sn, b.qty::text AS qty, b.item_code, b.item_name, b.unit_code,
              b.wh_code, b.wh_name, b.item_brand, b.status_name
       FROM public.odg_sn_balance b
       WHERE b.sn = $1 ${balScope}
       ORDER BY b.wh_code`,
      balArgs,
    ),
    query(
      `SELECT t.warehouse AS wh_code, t.type, t.doc_no,
              to_char(t.doc_date, 'YYYY-MM-DD') AS doc_date,
              t.item_code, t.item_name, t.qty::text AS qty,
              t.calc_in_type, t.calc_out_type, t.doc_ref
       FROM public.odg_sn_trans_detail t
       WHERE t.sn = $1 ${hisScope}
       ORDER BY t.doc_date DESC NULLS LAST, t.doc_no DESC`,
      hisArgs,
    ),
  ]);

  return NextResponse.json({ sn, balance, history });
}

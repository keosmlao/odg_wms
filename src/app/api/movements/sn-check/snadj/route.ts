import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Maintenance for the legacy SNADJ stock-adjustments (trans_flag 99,
 * doc_ref 'sn-sync') written by the old "adjust stock to SN count" reconcile —
 * which wrongly reduced WMS stock. Scoped to the session's accessible warehouses.
 *
 * GET  → summary + per-doc list.
 * POST { action: "delete" | "reverse" }
 *   delete  — remove the rows (stock balance returns to what it was).
 *   reverse — insert offsetting +1 movements (REV<doc>) so the net becomes 0,
 *             keeping the originals for audit (skips docs already reversed).
 */
const MATCH = `doc_no LIKE 'SNADJ%' AND trans_flag = 99 AND doc_ref = 'sn-sync'`;

function whScope(accessible: string[] | null, args: unknown[]): string {
  if (!Array.isArray(accessible)) return "";
  args.push(accessible);
  return ` AND wh_code = ANY($${args.length})`;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ summary: { docs: 0, net: "0" }, rows: [] });
  }

  const args: unknown[] = [];
  const scope = whScope(accessible, args);

  const summary = (
    await query<{ docs: string; net: string }>(
      `SELECT count(*)::text AS docs, COALESCE(SUM(qty * calc_flag), 0)::numeric::text AS net
       FROM public.odg_wms_trans_detail WHERE ${MATCH}${scope}`,
      args,
    )
  )[0] ?? { docs: "0", net: "0" };

  const rows = await query<{
    doc_no: string;
    wh_code: string | null;
    item_code: string | null;
    item_name: string | null;
    qty: string;
    calc_flag: number | null;
    doc_date: string | null;
    user_created: string | null;
  }>(
    `SELECT doc_no, wh_code, item_code, item_name, qty::text AS qty, calc_flag,
            to_char(doc_date,'YYYY-MM-DD') AS doc_date, user_created
     FROM public.odg_wms_trans_detail WHERE ${MATCH}${scope}
     ORDER BY wh_code, doc_no
     LIMIT 1000`,
    args,
  );

  return NextResponse.json({ summary, rows });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: { action?: unknown };
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "delete" && action !== "reverse") {
    return NextResponse.json({ error: "action ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີສາງ" }, { status: 403 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (action === "delete") {
      const args: unknown[] = [];
      const scope = whScope(accessible, args);
      const res = await client.query(`DELETE FROM public.odg_wms_trans_detail WHERE ${MATCH}${scope}`, args);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true, action, affected: res.rowCount ?? 0 });
    }

    // reverse — offsetting +1 rows, skipping docs already reversed.
    const args: unknown[] = [session.employee_code];
    const scope = whScope(accessible, args);
    const res = await client.query(
      `INSERT INTO public.odg_wms_trans_detail
         (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
          shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
       SELECT t.trans_flag, CURRENT_DATE, 'REV' || t.doc_no, 'sn-sync-reverse', t.item_code, t.item_name,
              t.qty, t.unit_code, t.shelf_code, t.shelf_code1, t.wh_code, $1, 0, -t.calc_flag,
              to_char(now(), 'HH24:MI'), t.pallet
       FROM public.odg_wms_trans_detail t
       WHERE ${MATCH}${scope}
         AND NOT EXISTS (
           SELECT 1 FROM public.odg_wms_trans_detail r
           WHERE r.doc_no = 'REV' || t.doc_no AND r.item_code = t.item_code
         )`,
      args,
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, action, affected: res.rowCount ?? 0 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

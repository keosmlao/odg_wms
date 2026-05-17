import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * GET available pending shipment bills for a warehouse, plus which ones are
 * already attached to an *active* deposit (so the picker can mark them as
 * "in deposit" and exclude them by default).
 *
 * Query: ?wh_code=X &q=... &from=... &to=... &hide_shipped=1 &limit=300
 *
 * Reads from the precomputed wms_pending_bill_cache (refreshed via the same
 * POST /api/stocktake/pending-bills-cache endpoint).
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
  const whCode = (url.searchParams.get("wh_code") ?? "").trim();
  if (!whCode) {
    return NextResponse.json({ error: "ກະລຸນາລະບຸ wh_code" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(whCode)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const q = (url.searchParams.get("q") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const hideShipped = url.searchParams.get("hide_shipped") === "1";
  const hideInDeposit = url.searchParams.get("hide_in_deposit") !== "0"; // default: hide
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "300", 10) || 300, 1),
    1000,
  );

  const args: unknown[] = [whCode];
  const filters: string[] = ["c.wh_code = $1"];
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    filters.push(
      `(c.doc_no ILIKE $${i} OR c.cust_code ILIKE $${i} OR c.transport_name ILIKE $${i})`,
    );
  }
  if (from) {
    args.push(from);
    filters.push(`c.doc_date >= $${args.length}::date`);
  }
  if (to) {
    args.push(to);
    filters.push(`c.doc_date <= $${args.length}::date`);
  }
  if (hideShipped) {
    filters.push("c.tms_shipped = 0");
  }
  if (hideInDeposit) {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM public.wms_deposit_bill db
      JOIN public.wms_deposit d ON d.deposit_id = db.deposit_id
      WHERE db.doc_no = c.doc_no AND db.trans_flag = c.trans_flag
        AND d.status = 'active'
    )`);
  }
  args.push(limit);
  const limitIdx = args.length;

  const sql = `
    SELECT
      c.doc_no,
      c.trans_flag,
      c.doc_date::text      AS doc_date,
      c.cust_code,
      c.cust_name,
      c.transport_name,
      c.sale_code,
      c.sale_name,
      c.currency_code,
      c.lines,
      c.items,
      c.qty_sum::text       AS qty_sum,
      c.value_sum::text     AS value_sum,
      c.tms_total,
      c.tms_shipped,
      c.tms_last_sent::text AS tms_last_sent,
      EXISTS (
        SELECT 1 FROM public.wms_deposit_bill db
        JOIN public.wms_deposit d ON d.deposit_id = db.deposit_id
        WHERE db.doc_no = c.doc_no AND db.trans_flag = c.trans_flag
          AND d.status = 'active'
      ) AS in_active_deposit
    FROM public.wms_pending_bill_cache c
    WHERE ${filters.join(" AND ")}
    ORDER BY (c.tms_shipped > 0) ASC, c.doc_date DESC, c.doc_no DESC
    LIMIT $${limitIdx}
  `;

  const [bills, meta] = await Promise.all([
    pool.query(sql, args).then((r) => r.rows),
    pool
      .query<{ refreshed_at: string | null; row_count: number | null }>(
        `SELECT refreshed_at::text AS refreshed_at, row_count
         FROM public.wms_pending_bill_cache_meta WHERE wh_code = $1`,
        [whCode],
      )
      .then((r) => r.rows[0] ?? null),
  ]);

  return NextResponse.json({
    ok: true,
    wh_code: whCode,
    bills,
    cache: meta
      ? { refreshed_at: meta.refreshed_at, row_count: meta.row_count ?? 0 }
      : null,
  });
}

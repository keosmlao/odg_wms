import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { PENDING_INSERT_SQL, requireSessionAccess } from "@/lib/stocktake";

/**
 * GET — list shipment bills available to add to the session's pending
 * baseline, plus which ones the session has currently selected.
 *
 * Query: ?q=<doc_no|cust>  &from=YYYY-MM-DD  &to=YYYY-MM-DD  &limit=200
 *
 * Availability rule: bills with an entry in ic_trans_shipment whose source
 * trans (ic_trans) is still open (status=0), and at least one detail line
 * for the session's warehouse.
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireSessionAccess(sessionId);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const hideShipped = url.searchParams.get("hide_shipped") === "1";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1),
    1000,
  );

  // Args: $1 = sessionId, $2 = wh_code, [$3..] = optional filters, $N = limit
  const args: unknown[] = [sessionId, guard.row.wh_code];
  const filters: string[] = ["c.wh_code = $2"];
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
  args.push(limit);
  const limitIdx = args.length;

  // Reads from the precomputed cache table — no source-table JOINs here.
  // The cache is refreshed via POST /api/stocktake/pending-bills-cache.
  const sql = `
    SELECT
      c.doc_no,
      c.trans_flag,
      c.doc_date::text         AS doc_date,
      c.cust_code,
      c.transport_name,
      c.lines,
      c.items,
      c.qty_sum::text          AS qty_sum,
      c.tms_total,
      c.tms_shipped,
      c.tms_last_sent::text    AS tms_last_sent,
      (pb.doc_no IS NOT NULL)  AS selected
    FROM public.wms_pending_bill_cache c
    LEFT JOIN public.wms_stocktake_pending_bill pb
      ON pb.session_id = $1
     AND pb.doc_no = c.doc_no
     AND pb.trans_flag = c.trans_flag
    WHERE ${filters.join(" AND ")}
    ORDER BY
      (pb.doc_no IS NOT NULL) DESC,
      (c.tms_shipped > 0) ASC,
      c.doc_date DESC,
      c.doc_no DESC
    LIMIT $${limitIdx}
  `;

  const [bills, selectedCount, meta] = await Promise.all([
    pool.query(sql, args).then((r) => r.rows),
    pool
      .query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.wms_stocktake_pending_bill WHERE session_id = $1`,
        [sessionId],
      )
      .then((r) => r.rows[0]?.n ?? 0),
    pool
      .query<{ refreshed_at: string | null; row_count: number | null }>(
        `SELECT refreshed_at::text AS refreshed_at, row_count
         FROM public.wms_pending_bill_cache_meta WHERE wh_code = $1`,
        [guard.row.wh_code],
      )
      .then((r) => r.rows[0] ?? null),
  ]);

  return NextResponse.json({
    ok: true,
    bills,
    selected_count: selectedCount,
    total_returned: bills.length,
    wh_code: guard.row.wh_code,
    cache: meta
      ? { refreshed_at: meta.refreshed_at, row_count: meta.row_count ?? 0 }
      : null,
  });
}

/**
 * POST — replace the session's selected bills with the given list, then
 * rebuild the pending snapshot from those bills.
 *
 * Body: { selected: Array<{ doc_no: string; trans_flag: number }> }
 *
 * Only allowed while the session is open. If the session already has
 * counted lines, the request requires `force: true`.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireSessionAccess(sessionId, { mustBeOpen: true });
  if (!guard.ok) return guard.response;

  let body: {
    selected?: Array<{ doc_no?: unknown; trans_flag?: unknown }>;
    force?: boolean;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const selected = Array.isArray(body.selected) ? body.selected : [];
  const cleaned: Array<{ doc_no: string; trans_flag: number }> = [];
  for (const s of selected) {
    const docNo = typeof s.doc_no === "string" ? s.doc_no.trim() : "";
    const flag =
      typeof s.trans_flag === "number"
        ? s.trans_flag
        : Number.parseInt(String(s.trans_flag ?? ""), 10);
    if (!docNo || !Number.isFinite(flag)) continue;
    cleaned.push({ doc_no: docNo, trans_flag: flag });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lineCheck = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.wms_stocktake_line WHERE session_id = $1`,
      [sessionId],
    );
    const countedLines = lineCheck.rows[0]?.n ?? 0;
    if (countedLines > 0 && !body.force) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `ມີການນັບແລ້ວ ${countedLines} ລາຍການ — ການປ່ຽນບິນຄ້າງຈ່າຍຈະປ່ຽນຍອດອ້າງອີງ`,
          requires_confirmation: true,
          counted_lines: countedLines,
        },
        { status: 409 },
      );
    }

    await client.query(
      `DELETE FROM public.wms_stocktake_pending_bill WHERE session_id = $1`,
      [sessionId],
    );

    if (cleaned.length > 0) {
      // Bulk insert via UNNEST to keep it a single round-trip.
      const docNos = cleaned.map((c) => c.doc_no);
      const flags = cleaned.map((c) => c.trans_flag);
      await client.query(
        `INSERT INTO public.wms_stocktake_pending_bill (session_id, doc_no, trans_flag)
         SELECT $1, x.doc_no, x.trans_flag
         FROM UNNEST($2::varchar[], $3::smallint[]) AS x(doc_no, trans_flag)
         ON CONFLICT DO NOTHING`,
        [sessionId, docNos, flags],
      );
    }

    // Rebuild pending snapshot from the new selection.
    await client.query(
      `DELETE FROM public.wms_stocktake_pending WHERE session_id = $1`,
      [sessionId],
    );
    const pend = await client.query(PENDING_INSERT_SQL, [
      sessionId,
      guard.row.wh_code,
    ]);

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      selected_bills: cleaned.length,
      pending_items: pend.rowCount ?? 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("save pending-bills failed:", err);
    return NextResponse.json(
      { error: "ບັນທຶກບິນຄ້າງຈ່າຍບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

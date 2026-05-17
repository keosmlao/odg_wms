import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  PENDING_INSERT_SQL,
  SNAPSHOT_INSERT_SQL,
  requireSessionAccess,
} from "@/lib/stocktake";

/**
 * Re-take the SML snapshot AND the pending-shipment snapshot for a session.
 *
 * The variance baseline is: SML snapshot + pending shipments. This endpoint
 * refreshes both so the comparison stays aligned with the actual moment of
 * physical count.
 *
 * If counted lines already exist, the request requires `body.force = true`
 * — re-snapshotting after counting started rewrites the variance baseline.
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

  let body: { force?: boolean } = {};
  try {
    body = (await request.json()) as { force?: boolean };
  } catch {
    // empty body is fine
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lineCheck = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM public.wms_stocktake_line
       WHERE session_id = $1`,
      [sessionId],
    );
    const countedLines = lineCheck.rows[0]?.n ?? 0;
    if (countedLines > 0 && !body.force) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error: `ມີການນັບແລ້ວ ${countedLines} ລາຍການ — ການດຶງ SML ຄືນຈະປ່ຽນຍອດອ້າງອີງ`,
          requires_confirmation: true,
          counted_lines: countedLines,
        },
        { status: 409 },
      );
    }

    await client.query(
      `DELETE FROM public.wms_stocktake_snapshot WHERE session_id = $1`,
      [sessionId],
    );
    await client.query(
      `DELETE FROM public.wms_stocktake_pending WHERE session_id = $1`,
      [sessionId],
    );
    const snap = await client.query(SNAPSHOT_INSERT_SQL, [
      sessionId,
      guard.row.wh_code,
    ]);
    const pend = await client.query(PENDING_INSERT_SQL, [
      sessionId,
      guard.row.wh_code,
    ]);

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      snapshot_items: snap.rowCount ?? 0,
      pending_items: pend.rowCount ?? 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("refresh snapshot failed:", err);
    return NextResponse.json(
      { error: "ດຶງ SML ບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

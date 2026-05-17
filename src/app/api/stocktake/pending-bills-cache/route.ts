import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { PENDING_BILL_CACHE_REBUILD_SQL, trimOrNull } from "@/lib/stocktake";

/**
 * Rebuild the cache of pending shipment bills for a warehouse.
 *
 * Body: { wh_code: string }
 *
 * This is the expensive query (multi-table JOIN over ~30k bills × ~5 lines
 * each + TMS join). Designed to be run on demand (via "Refresh" button) so
 * the bill picker UI can read from a flat indexed cache table.
 */
export async function POST(request: Request) {
  const userSession = await getSession();
  if (!userSession) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!userSession.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  let body: { wh_code?: unknown } = {};
  try {
    body = (await request.json()) as { wh_code?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const whCode = trimOrNull(body.wh_code);
  if (!whCode) {
    return NextResponse.json({ error: "ກະລຸນາລະບຸ wh_code" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(whCode)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM public.wms_pending_bill_cache WHERE wh_code = $1`,
      [whCode],
    );
    const ins = await client.query(PENDING_BILL_CACHE_REBUILD_SQL, [whCode]);
    const rowCount = ins.rowCount ?? 0;

    await client.query(
      `INSERT INTO public.wms_pending_bill_cache_meta
         (wh_code, refreshed_at, refreshed_by, row_count)
       VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
       ON CONFLICT (wh_code)
       DO UPDATE SET
         refreshed_at = EXCLUDED.refreshed_at,
         refreshed_by = EXCLUDED.refreshed_by,
         row_count    = EXCLUDED.row_count`,
      [whCode, userSession.employee_id, rowCount],
    );
    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      wh_code: whCode,
      row_count: rowCount,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("refresh pending-bill cache failed:", err);
    return NextResponse.json(
      { error: "Refresh ບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

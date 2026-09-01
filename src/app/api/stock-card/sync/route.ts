import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { hasPerm } from "@/lib/permissions";

/**
 * Opening-balance sync for the stock card, one warehouse at a time.
 *
 * Source: the WMS movement ledger, netted per BIN (migration 040) —
 *   SUM(qty * calc_flag) GROUP BY wh_code, item_code, shelf_code, shelf_code1
 * so the baseline arrives already placed at rack → location. The old SML path
 * (sml_ic_function_stock_balance_warehouse) only knew warehouses and is retired.
 *
 * REPLACE, not merge: a warehouse holds exactly one opening set, so a re-sync
 * deletes the whole previous set before inserting. That is destructive — the old
 * baseline is gone and every card figure for the warehouse shifts — so it is
 * gated on the `stock_card_sync` permission and recorded in
 * odg_wms_stock_card_sync_log with the before/after row counts.
 *
 * Movements (odg_wms_stock_card_entry) are NEVER touched by a sync; only the
 * baseline moves, and the card recomputes on top of it.
 */

/** GET — per-warehouse sync state for the sync screen. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  const warehouses = accessible === null
    ? await query<{ code: string; name: string | null }>(
        `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status, 1) = 1 ORDER BY code`)
    : accessible.length === 0
      ? []
      : await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`, [accessible]);

  // `items` counts DISTINCT products, `nodes` counts the (item, rack, location)
  // rows — since 040 one item spans as many rows as it has bins.
  const state = warehouses.length === 0 ? [] : await query<{ wh_code: string; items: number; nodes: number; total_qty: string; synced_at: string | null; user_created: string | null }>(
    `SELECT wh_code,
            count(DISTINCT item_code)::int AS items,
            count(*)::int AS nodes,
            COALESCE(SUM(qty), 0)::text AS total_qty,
            to_char(MAX(synced_at), 'DD-MM-YYYY HH24:MI') AS synced_at,
            MAX(user_created) AS user_created
     FROM public.odg_wms_stock_card_opening
     WHERE wh_code = ANY($1)
     GROUP BY wh_code`,
    [warehouses.map((w) => w.code)],
  );
  const byWh = new Map(state.map((s) => [s.wh_code, s]));

  return NextResponse.json({
    can_sync: await hasPerm(session, "stock_card_sync"),
    warehouses: warehouses.map((w) => ({
      code: w.code,
      name: w.name,
      items: byWh.get(w.code)?.items ?? 0,
      nodes: byWh.get(w.code)?.nodes ?? 0,
      total_qty: byWh.get(w.code)?.total_qty ?? "0",
      synced_at: byWh.get(w.code)?.synced_at ?? null,
      user_created: byWh.get(w.code)?.user_created ?? null,
    })),
  });
}

/** POST { wh } — re-baseline one warehouse. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: { wh?: unknown };
  try { body = (await request.json()) as { wh?: unknown }; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const wh = typeof body.wh === "string" ? body.wh.trim() : "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const client = await pool.connect();
  try {
    if (!(await hasPerm(session, "stock_card_sync", client))) {
      return NextResponse.json(
        { error: "ບໍ່ມີສິດ sync ຍອດຕັ້ງຕົ້ນ — ຕ້ອງໃຫ້ຜູ້ຈັດການເປີດສິດໃນ ຕັ້ງຄ່າ › ຈັດການສິດເຂົ້າເຖິງ" },
        { status: 403 },
      );
    }
    await client.query("BEGIN");

    // Serialize per warehouse: two concurrent syncs of the same warehouse would
    // interleave their delete/insert and leave a half-replaced baseline.
    await client.query(`SELECT pg_advisory_xact_lock(424244, hashtext($1))`, [wh]);

    const before = (await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.odg_wms_stock_card_opening WHERE wh_code = $1`, [wh],
    )).rows[0]?.n ?? "0";

    await client.query(`DELETE FROM public.odg_wms_stock_card_opening WHERE wh_code = $1`, [wh]);

    // One row per (item, rack, location). Blank shelf codes become NULL so the
    // card's "no bin" bucket and the unique index both see a single canonical
    // value; zero-net nodes are dropped — an emptied bin is not a balance.
    const ins = await client.query(
      `INSERT INTO public.odg_wms_stock_card_opening
              (wh_code, item_code, item_name, unit_code, rack_code, location_code, qty, synced_at, user_created)
       SELECT d.wh_code,
              d.item_code,
              MAX(d.item_name),
              MAX(d.unit_code),
              NULLIF(TRIM(d.shelf_code), ''),
              NULLIF(TRIM(d.shelf_code1), ''),
              SUM(d.qty * d.calc_flag),
              now(),
              $2
       FROM public.odg_wms_trans_detail d
       WHERE d.wh_code = $1
         AND d.item_code IS NOT NULL
       GROUP BY d.wh_code, d.item_code, NULLIF(TRIM(d.shelf_code), ''), NULLIF(TRIM(d.shelf_code1), '')
       HAVING SUM(d.qty * d.calc_flag) <> 0`,
      [wh, session.employee_code],
    );
    const after = ins.rowCount ?? 0;

    await client.query(
      `INSERT INTO public.odg_wms_stock_card_sync_log (wh_code, rows_before, rows_after, as_of_date, user_created)
       VALUES ($1, $2, $3, NULL, $4)`,
      [wh, Number.parseInt(before, 10) || 0, after, session.employee_code],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, wh, rows_before: Number.parseInt(before, 10) || 0, rows_after: after });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

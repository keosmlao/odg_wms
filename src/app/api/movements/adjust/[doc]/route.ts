import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { hasPerm } from "@/lib/permissions";

/** trans_flag for WMS-internal stock adjustments — matches api/movements/adjust/route.ts. */
const ADJUST_TRANS_FLAG = 99;
/** doc_ref of the two legs of a serial location move — matches the POST route. */
const SN_MOVE_REF = "sn-move";

/**
 * Void (delete) a posted stock-adjustment doc (ADJ...) and give back its effect:
 *
 *   qty lines     — delete the balancing `odg_wms_trans_detail` row(s) (calc_flag
 *                   ±1, trans_flag 99). Balance is SUM(qty*calc_flag) over active
 *                   rows, so removing the row exactly cancels the adjustment.
 *   serial lines  — reverse each `sn_trans_detail` row (same doc_no):
 *                     calc_flag -1 (marked missing/damaged → issued) → status 1→0
 *                     calc_flag +1 (added/generated → in stock)      → status 0→1
 *   move lines    — the ±1 pair stamped doc_ref 'sn-move' is a relocation, not a
 *                   status change: put each serial back at the node (and
 *                   warehouse) named by its -1 leg and leave it in stock.
 *
 * Voiding is gated per user (see lib/permissions): a manager may always delete,
 * anyone else needs the `delete_adjust` grant — reversing an adjustment can move
 * real stock, so warehouse access alone is not enough.
 *
 * Guard: a qty line cannot be voided if a LATER movement already consumed the
 * adjustment's effect (would push the node balance negative).
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();
  if (!docNo || !docNo.toUpperCase().startsWith("ADJ")) {
    return NextResponse.json({ error: "ບໍ່ແມ່ນໃບປັບປຸງ stock (ADJ)" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query<{ remark: string | null }>(
      `SELECT remark FROM public.wms_product_adj_stock WHERE doc_no = $1 LIMIT 1`,
      [docNo],
    );
    if (hdr.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບໃບປັບປຸງນີ້" }, { status: 404 });
    }

    // Warehouse is embedded as a "[wh] note" prefix in the header remark — same
    // parsing as adjust-history/route.ts.
    const remark = hdr.rows[0].remark ?? "";
    const m = /^\[([^\]]*)\]/.exec(remark);
    const wh = m ? m[1] : "";
    if (Array.isArray(accessible) && (!wh || !accessible.includes(wh))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }

    if (!(await hasPerm(session, "delete_adjust", client))) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ບໍ່ມີສິດລົບໃບປັບປຸງ stock — ຕ້ອງໃຫ້ຜູ້ຈັດການເປີດສິດໃນ ຕັ້ງຄ່າ › ຈັດການສິດເຂົ້າເຖິງ" },
        { status: 403 },
      );
    }

    // Qty lines: guard against a later movement already having consumed this
    // adjustment's effect (voiding would push the node balance negative).
    const qtyRows = await client.query<{
      wh_code: string; item_code: string; shelf_code: string | null; shelf_code1: string | null; pallet: string | null; qty: string; calc_flag: number;
    }>(
      `SELECT wh_code, item_code, shelf_code, shelf_code1, pallet, qty::text AS qty, calc_flag
       FROM public.odg_wms_trans_detail WHERE doc_no = $1 AND trans_flag = $2`,
      [docNo, ADJUST_TRANS_FLAG],
    );
    for (const r of qtyRows.rows) {
      const delta = Number.parseFloat(r.qty) * r.calc_flag;
      const balRes = await client.query<{ bal: string }>(
        `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS bal
         FROM public.odg_wms_trans_detail t
         WHERE (t.status = 0 OR t.status IS NULL)
           AND t.wh_code = $1
           AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') = $2
           AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
           AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $4
           AND t.item_code = $5`,
        [r.wh_code, r.shelf_code ?? "", r.shelf_code1 ?? "", r.pallet ?? "", r.item_code],
      );
      const bal = Number.parseFloat(balRes.rows[0].bal) || 0;
      if (bal - delta < -1e-6) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `ລົບບໍ່ໄດ້ — ມີການເຄື່ອນໄຫວ ${r.item_code} ຫຼັງໃບນີ້ແລ້ວ, ຈະເຮັດໃຫ້ຍອດຕິດລົບ` },
          { status: 409 },
        );
      }
    }

    // Serial lines: reverse each sn_trans_detail row of this doc.
    //   calc_flag -1 (marked missing/damaged → sn_inventory flipped to issued)
    //     → flip back to in-stock (status 1 → 0).
    //   calc_flag +1 (added/generated → in stock)
    //     → flip back out (status 0 → 1), undoing the add.
    const restoredRemoved = await client.query(
      `UPDATE public.sn_inventory s
         SET status = 0, user_mapping = $2
       FROM public.sn_trans_detail d
       WHERE d.doc_no = $1 AND d.trans_flag = $3 AND d.calc_flag = -1
         AND COALESCE(d.doc_ref, '') <> $4
         AND s.item_code = d.item_code
         AND s.wh_code = d.warehouse
         AND COALESCE(NULLIF(s.isn, ''), s.sn) = COALESCE(NULLIF(d.isn, ''), d.sn)
         AND COALESCE(s.status, 0) = 1`,
      [docNo, session.employee_code, ADJUST_TRANS_FLAG, SN_MOVE_REF],
    );
    const undoneAdded = await client.query(
      `UPDATE public.sn_inventory s
         SET status = 1, user_mapping = $2
       FROM public.sn_trans_detail d
       WHERE d.doc_no = $1 AND d.trans_flag = $3 AND d.calc_flag = 1
         AND COALESCE(d.doc_ref, '') <> $4
         AND s.item_code = d.item_code
         AND s.wh_code = d.warehouse
         AND COALESCE(NULLIF(s.isn, ''), s.sn) = COALESCE(NULLIF(d.isn, ''), d.sn)
         AND COALESCE(s.status, 0) = 0`,
      [docNo, session.employee_code, ADJUST_TRANS_FLAG, SN_MOVE_REF],
    );
    // Move legs: send each serial back to where its -1 leg says it came from.
    // Status is untouched — a relocation never took it out of stock.
    const movedBack = await client.query(
      `UPDATE public.sn_inventory s
         SET rack = NULLIF(TRIM(COALESCE(d.rack, '')), ''),
             location = NULLIF(TRIM(COALESCE(d.location, '')), ''),
             pallet = NULLIF(TRIM(COALESCE(d.pallet, '')), ''),
             wh_code = d.warehouse,
             user_mapping = $2
       FROM public.sn_trans_detail d
       WHERE d.doc_no = $1 AND d.trans_flag = $3 AND d.calc_flag = -1
         AND COALESCE(d.doc_ref, '') = $4
         AND s.item_code = d.item_code
         AND COALESCE(NULLIF(s.isn, ''), s.sn) = COALESCE(NULLIF(d.isn, ''), d.sn)
         AND COALESCE(s.status, 0) = 0`,
      [docNo, session.employee_code, ADJUST_TRANS_FLAG, SN_MOVE_REF],
    );

    await client.query(`DELETE FROM public.sn_trans_detail WHERE doc_no = $1 AND trans_flag = $2`, [docNo, ADJUST_TRANS_FLAG]);
    await client.query(`DELETE FROM public.sn_trans WHERE doc_no = $1 AND trans_flag = $2`, [docNo, ADJUST_TRANS_FLAG]);
    await client.query(`DELETE FROM public.odg_wms_trans_detail WHERE doc_no = $1 AND trans_flag = $2`, [docNo, ADJUST_TRANS_FLAG]);
    await client.query(`DELETE FROM public.odg_wms_trans WHERE doc_no = $1 AND trans_flag = $2`, [docNo, ADJUST_TRANS_FLAG]);
    await client.query(`DELETE FROM public.wms_product_adj_stock_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_adj_stock WHERE doc_no = $1`, [docNo]);

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      doc_no: docNo,
      serials_restored: restoredRemoved.rowCount ?? 0,
      serials_undone: undoneAdded.rowCount ?? 0,
      serials_moved_back: movedBack.rowCount ?? 0,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

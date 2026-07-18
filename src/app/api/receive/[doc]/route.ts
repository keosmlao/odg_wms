import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { reverseErpByWmsDoc } from "@/lib/erpPost";

/**
 * Void (delete) a WMS goods-receipt so it can be re-received. Reverts every
 * table the receive wrote to:
 *   odg_wms_trans(+_detail), sn_trans(+_detail), sn_inventory,
 *   wms_product_receive(+_detail, +_ref),
 *   and the ERP ໃບຊື້ຕິດໜີ້ (flag 12) the receive posted, if any.
 *
 * Blocked if any generated serial has already moved (sold/issued/transferred) —
 * i.e. it appears in sn_trans_detail under a different document — to avoid
 * corrupting downstream stock.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();
  if (!docNo) return NextResponse.json({ error: "ບໍ່ມີເລກໃບຮັບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Locate the receive. The canonical index is wms_product_receive (what the
    // history list reads); odg_wms_trans is only the stock-movement header and may
    // be absent for legacy receipts, so fall back to it just for the warehouse.
    const hdr = await client.query<{ wh_code: string | null }>(
      `SELECT warehouse_code AS wh_code FROM public.wms_product_receive WHERE doc_no = $1 LIMIT 1`,
      [docNo],
    );
    if (hdr.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບໃບຮັບ ຫຼື ບໍ່ແມ່ນໃບຮັບ WMS" }, { status: 404 });
    }
    let whCode = hdr.rows[0].wh_code ?? null;
    if (whCode === null) {
      const alt = await client.query<{ wh_code: string | null }>(
        `SELECT wh_code FROM public.odg_wms_trans WHERE doc_no = $1 LIMIT 1`,
        [docNo],
      );
      whCode = alt.rows[0]?.wh_code ?? null;
    }
    if (Array.isArray(accessible) && (whCode === null || !accessible.includes(whCode))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }

    // Serials committed by this receive.
    const snRes = await client.query<{ sn: string }>(
      `SELECT sn FROM public.sn_trans_detail WHERE doc_no = $1`,
      [docNo],
    );
    const serials = snRes.rows.map((r) => r.sn);

    // Integrity guard: block if any serial already moved under another document.
    if (serials.length > 0) {
      const moved = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM public.sn_trans_detail WHERE sn = ANY($1) AND doc_no <> $2`,
        [serials, docNo],
      );
      if ((moved.rows[0]?.n ?? 0) > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "ບໍ່ສາມາດລົບ — serial ບາງລາຍການຖືກໃຊ້/ເຄື່ອນໄຫວແລ້ວ" },
          { status: 409 },
        );
      }
    }

    // Revert serial stock + ledger.
    if (serials.length > 0) {
      // sn_inventory stores ISN-only serials with sn NULL (identity in `isn`),
      // while the ledger's `sn` carries the identifier — match on either so
      // deleting a receipt of ISN-only items doesn't orphan its serial rows.
      await client.query(
        `DELETE FROM public.sn_inventory WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($1) AND COALESCE(status,0) = 0`,
        [serials],
      );
    }
    await client.query(`DELETE FROM public.sn_trans_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.sn_trans WHERE doc_no = $1`, [docNo]);

    // Revert WMS location stock.
    await client.query(`DELETE FROM public.odg_wms_trans_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.odg_wms_trans WHERE doc_no = $1`, [docNo]);

    // The count sheet(s) this receipt was posted from.
    const refs = await client.query<{ ref_doc_no: string | null }>(
      `SELECT ref_doc_no FROM public.wms_product_receive_ref WHERE doc_no = $1`,
      [docNo],
    );
    const countRefs = refs.rows.map((r) => r.ref_doc_no).filter((x): x is string => !!x);
    // This receipt's own lines — needed to give qty back to a partial-kept draft.
    const recvLines = (await client.query<{ item_code: string; item_name: string | null; unit_code: string | null; qty: string }>(
      `SELECT item_code, item_name, unit_code, qty::text AS qty FROM public.wms_product_receive_detail WHERE doc_no = $1`,
      [docNo],
    )).rows;
    for (const countNo of countRefs) {
      const cs = (await client.query<{ status: number | null }>(
        `SELECT status FROM public.wms_product_receive WHERE doc_no = $1 AND doc_type = 2 LIMIT 1`,
        [countNo],
      )).rows[0];
      if (!cs) continue; // not a count sheet (e.g. the PO ref)
      if (cs.status === 5) {
        // Full receipt consumed the sheet → just reopen it (its lines + reserved
        // serials are intact).
        await client.query(`UPDATE public.wms_product_receive SET status = 9 WHERE doc_no = $1`, [countNo]);
      } else if (cs.status === 9) {
        // Partial receipt kept the sheet as a draft (lines shrunk, received serials
        // moved onto this receipt). Undo that: give the serials + qty back.
        await client.query(
          `UPDATE public.wms_product_receive_serial_detail
             SET ref_rec_doc = $1, ignore_sync = 0, is_lock_record = 1, last_update_date_time_now = now()
           WHERE ref_rec_doc = $2`,
          [countNo, docNo],
        );
        for (const l of recvLines) {
          const upd = await client.query(
            `UPDATE public.wms_product_receive_detail SET qty = qty + $3::numeric WHERE doc_no = $1 AND item_code = $2`,
            [countNo, l.item_code, l.qty],
          );
          if ((upd.rowCount ?? 0) === 0) {
            await client.query(
              `INSERT INTO public.wms_product_receive_detail (doc_no, doc_date, doc_time, item_code, item_name, unit_code, qty, create_date_time_now)
               VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, now())`,
              [countNo, l.item_code, l.item_name, l.unit_code, l.qty],
            );
          }
        }
      }
    }

    // Revert the WMS receive document index.
    await client.query(`DELETE FROM public.wms_product_receive_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive_ref WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive WHERE doc_no = $1`, [docNo]);

    // Revert the ERP ໃບຊື້ຕິດໜີ້ (12) this receive posted: deletes the ic_trans /
    // ic_trans_detail rows (found via doc_ref_trans = this receipt) and takes the
    // received qty back off ic_inventory.balance_qty. No-op for a receive that
    // never posted one (no PO, or ERP posting disabled).
    const erp = await reverseErpByWmsDoc(client, docNo);

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true, deleted: docNo, serials: serials.length,
      erp_reversed: erp.docs.length > 0 ? erp.docs : null,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ລົບບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

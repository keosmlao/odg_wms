import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { reverseErpByWmsDoc } from "@/lib/erpPost";

/**
 * Void (delete) a WMS goods movement (DP doc) so the stock is given back. There
 * are two shapes of DP doc and the reversal differs:
 *
 *   CONSUMPTION (req/sale issue) — only −1 rows. Serials were marked issued
 *     (sn_inventory.status 1). Reverse: flip status 1 → 0 (stay where they are).
 *
 *   RELOCATION (transfer issue source→9903, receive 9903→dest, return 9903→source)
 *     — paired −1/+1 rows, serials kept in-stock (status 0) but moved. Reverse:
 *     move each serial from the +1 warehouse back to the −1 warehouse. When the
 *     origin is the in-transit warehouse (9903) the parked location is the 124 ref.
 *
 * A relocation cannot be voided once a LATER stage consumed it (would push the
 * in-transit balance negative) — that is blocked. ERP docs (56 / 70+72) posted by
 * the doc are reversed via doc_ref_trans. Serials match on COALESCE(NULLIF(sn,''),isn).
 */
const IN_TRANSIT = "9903";
export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();
  if (!docNo || !docNo.toUpperCase().startsWith("DP")) {
    return NextResponse.json({ error: "ບໍ່ແມ່ນໃບຈ່າຍ WMS (DP)" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query<{ wh_code: string | null }>(
      `SELECT wh_code FROM public.odg_wms_trans WHERE doc_no = $1 LIMIT 1`,
      [docNo],
    );
    if (hdr.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບໃບຈ່າຍນີ້" }, { status: 404 });
    }
    const wh = hdr.rows[0].wh_code ?? "";
    if (Array.isArray(accessible) && (!wh || !accessible.includes(wh))) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }

    // Classify the doc: a RELOCATION has +1 rows (a destination warehouse); a
    // CONSUMPTION issue has only −1 rows.
    const legs = await client.query<{ from_wh: string | null; to_wh: string | null; doc_ref: string | null }>(
      `SELECT MAX(wh_code) FILTER (WHERE calc_flag = -1) AS from_wh,
              MAX(wh_code) FILTER (WHERE calc_flag = 1)  AS to_wh,
              MAX(doc_ref) AS doc_ref
       FROM public.odg_wms_trans_detail WHERE doc_no = $1`,
      [docNo],
    );
    const fromWh = legs.rows[0]?.from_wh ?? null;
    const toWh = legs.rows[0]?.to_wh ?? null;
    const docRef = legs.rows[0]?.doc_ref ?? null;
    const isRelocation = !!toWh;

    let restored = { rowCount: 0 } as { rowCount: number | null };
    if (isRelocation) {
      // Move serials from the +1 warehouse back to the −1 warehouse. Origin =
      // 9903 → park back under the 124 ref; otherwise restore the recorded shelf.
      restored = await client.query(
        `UPDATE public.sn_inventory s
           SET wh_code = $3::varchar,
               location = CASE WHEN $3::text = $4::text THEN $5::varchar ELSE d.location END,
               rack = CASE WHEN $3::text = $4::text THEN NULL ELSE d.rack END,
               pallet = CASE WHEN $3::text = $4::text THEN NULL ELSE d.pallet END,
               status = 0, user_mapping = $2, updated_at = now()
         FROM public.sn_trans_detail d
         WHERE d.doc_no = $1
           AND COALESCE(NULLIF(s.sn, ''), s.isn) = COALESCE(NULLIF(d.sn, ''), d.isn)
           AND s.item_code = d.item_code
           AND s.wh_code = $6::varchar AND COALESCE(s.status, 0) = 0`,
        [docNo, session.employee_code, fromWh, IN_TRANSIT, docRef, toWh],
      );
    } else {
      // Consumption: flip issued serials back to in-stock where they sit.
      restored = await client.query(
        `UPDATE public.sn_inventory s
           SET status = 0, user_mapping = $2
         FROM public.sn_trans_detail d
         WHERE d.doc_no = $1
           AND COALESCE(NULLIF(s.sn, ''), s.isn) = COALESCE(NULLIF(d.sn, ''), d.isn)
           AND s.item_code = d.item_code
           AND COALESCE(s.status, 0) = 1`,
        [docNo, session.employee_code],
      );
    }

    await client.query(`DELETE FROM public.sn_trans_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.sn_trans WHERE doc_no = $1`, [docNo]);
    // Removing the movement rows gives the location balance back.
    await client.query(`DELETE FROM public.odg_wms_trans_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.odg_wms_trans WHERE doc_no = $1`, [docNo]);

    // Guard: voiding this doc must not leave the in-transit balance negative —
    // i.e. a later receive/return already drew from what this doc put into 9903.
    if (docRef) {
      const neg = await client.query<{ item_code: string }>(
        `SELECT item_code FROM public.odg_wms_trans_detail
         WHERE wh_code = $1 AND doc_ref = $2 AND (status = 0 OR status IS NULL)
         GROUP BY item_code HAVING SUM(qty * calc_flag) < -1e-6 LIMIT 1`,
        [IN_TRANSIT, docRef],
      );
      if (neg.rows.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ລົບບໍ່ໄດ້ — ມีรายการฮับ/ฮับคืนต่อจากใบนี้แล้ว (${neg.rows[0].item_code}). ต้องลบใบฮับก่อน` }, { status: 409 });
      }
    }

    // Reverse the ERP doc(s) this issue posted (ໃບເບີກ 56 / ໃບໂອນ 70+72):
    // restore ic_inventory.balance_qty and delete the ic_trans rows.
    const erp = await reverseErpByWmsDoc(client, docNo);

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo, serials_restored: restored.rowCount ?? 0, erp_reversed: erp.docs });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

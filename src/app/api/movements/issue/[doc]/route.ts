import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { reverseErpByWmsDoc } from "@/lib/erpPost";
import { hasPerm } from "@/lib/permissions";

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

/**
 * GET — everything one posted WMS movement actually did, for the in-app detail
 * view (not the printable slip): which warehouse/bin each item left and landed
 * at, every SN + ISN that moved and the node it moved at, the ERP doc(s) posted,
 * and any short-movement reason. This is what a receiver opens to answer "what
 * exactly did we take in, and where did it go".
 */
export async function GET(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();
  if (!docNo) return NextResponse.json({ error: "ບໍ່ມີເລກເອກະສານ" }, { status: 400 });

  const head = await query<{
    doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null;
    wh_code: string | null; wh_name: string | null; user_created: string | null; user_name: string | null;
  }>(
    `SELECT t.doc_no, to_char(t.doc_date,'DD/MM/YYYY') AS doc_date, t.doc_time, t.doc_ref,
            t.wh_code, w.name_1 AS wh_name, t.user_created, e.fullname_lo AS user_name
     FROM public.odg_wms_trans t
     LEFT JOIN public.ic_warehouse w ON w.code = t.wh_code
     LEFT JOIN public.odg_employee e ON e.employee_code = t.user_created
     WHERE t.doc_no = $1 LIMIT 1`,
    [docNo],
  );
  const h = head[0];
  if (!h) return NextResponse.json({ error: "ບໍ່ພົບເອກະສານນີ້" }, { status: 404 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (!h.wh_code || !accessible.includes(h.wh_code))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // Per-item: the −1 leg is where it left, the +1 leg where it landed.
  const lines = await query<{
    item_code: string; item_name: string | null; unit_code: string | null; qty: string;
    from_wh: string | null; from_wh_name: string | null; from_loc: string | null;
    to_wh: string | null; to_wh_name: string | null; to_loc: string | null;
  }>(
    `SELECT d.item_code,
            MAX(d.item_name) AS item_name,
            MAX(d.unit_code) AS unit_code,
            COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = 1), SUM(d.qty) FILTER (WHERE d.calc_flag = -1))::numeric::text AS qty,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = -1) AS from_wh,
            MAX(wf.name_1) FILTER (WHERE d.calc_flag = -1) AS from_wh_name,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = -1) AS from_loc,
            MAX(d.wh_code) FILTER (WHERE d.calc_flag = 1) AS to_wh,
            MAX(wt.name_1) FILTER (WHERE d.calc_flag = 1) AS to_wh_name,
            MAX(NULLIF(TRIM(COALESCE(d.shelf_code1, d.shelf_code)), '')) FILTER (WHERE d.calc_flag = 1) AS to_loc
     FROM public.odg_wms_trans_detail d
     LEFT JOIN public.ic_warehouse wf ON wf.code = d.wh_code AND d.calc_flag = -1
     LEFT JOIN public.ic_warehouse wt ON wt.code = d.wh_code AND d.calc_flag = 1
     WHERE d.doc_no = $1
     GROUP BY d.item_code ORDER BY d.item_code`,
    [docNo],
  );

  // One row per physical unit, with the node it moved at (source bin on an issue,
  // landing bin on a receive) — ordered by ISN so it reads in receiving order.
  const units = await query<{ item_code: string; sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null; warehouse: string | null }>(
    `SELECT item_code, NULLIF(TRIM(sn), '') AS sn, NULLIF(TRIM(isn), '') AS isn,
            NULLIF(TRIM(rack), '') AS rack, NULLIF(TRIM(location), '') AS location,
            NULLIF(TRIM(pallet), '') AS pallet, warehouse
     FROM public.sn_trans_detail WHERE doc_no = $1
     ORDER BY item_code, COALESCE(NULLIF(TRIM(isn), ''), sn)`,
    [docNo],
  );

  // ERP doc(s) this movement posted (ໃບໂອນ FT / ໃບເບີກ), linked by doc_ref_trans.
  const erp = await query<{ doc_no: string; doc_format_code: string | null; trans_flag: number; wh_from: string | null; wh_to: string | null }>(
    `SELECT DISTINCT doc_no, doc_format_code, trans_flag, wh_from, wh_to
     FROM public.ic_trans WHERE doc_ref_trans = $1 ORDER BY doc_no`,
    [docNo],
  );

  // ເຫດຜົນການເຄື່ອນຍ້າຍບໍ່ຄົບ — ອ່ານບໍ່ໄດ້ ບໍ່ຄວນລົ້ມທັງໜ້າ ແຕ່ຕ້ອງເຫັນໃນ log.
  let notes: { item_code: string; reason_code: string | null; short_qty: string | null }[] = [];
  try {
    notes = await query<{ item_code: string; reason_code: string | null; short_qty: string | null }>(
      `SELECT item_code, reason_code, short_qty::numeric::text AS short_qty
       FROM public.odg_wms_move_note WHERE doc_no = $1 ORDER BY item_code`,
      [docNo],
    );
  } catch (err) {
    console.warn("[issue] ອ່ານ odg_wms_move_note ບໍ່ໄດ້ (migration 038?)", err);
    notes = [];
  }

  const fromWh = lines.find((l) => l.from_wh)?.from_wh ?? null;
  const toWh = lines.find((l) => l.to_wh)?.to_wh ?? null;
  const kind = toWh === IN_TRANSIT ? "transfer_out" : fromWh === IN_TRANSIT ? "transfer_in" : "issue";

  return NextResponse.json({ header: h, kind, lines, units, erp, notes });
}

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

    // Voiding a transfer is gated per user (see lib/permissions): it reverses
    // stock, serials AND the ERP ໃບໂອນ on both sides of the move, so warehouse
    // access alone is not enough. Which grant applies depends on the leg:
    //   goods INTO the in-transit wh  → this is the source's transfer-OUT
    //   goods OUT of the in-transit wh → a destination receive, or a source return
    // A plain consumption issue keeps its existing role+warehouse rule.
    const neededPerm =
      toWh === IN_TRANSIT ? "delete_transfer_out"
      : fromWh === IN_TRANSIT ? "delete_transfer_in"
      : null;
    if (neededPerm && !(await hasPerm(session, neededPerm, client))) {
      await client.query("ROLLBACK");
      const what = neededPerm === "delete_transfer_out" ? "ໃບໂອນອອກ" : "ໃບໂອນເຂົ້າ / ຮັບຄືນ";
      return NextResponse.json(
        { error: `ບໍ່ມີສິດລົບ${what} — ຕ້ອງໃຫ້ຜູ້ຈັດການເປີດສິດໃນ ຕັ້ງຄ່າ › ຈັດການສິດເຂົ້າເຖິງ` },
        { status: 403 },
      );
    }

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
        return NextResponse.json({ error: `ລົບບໍ່ໄດ້ — ມີລາຍການຮັບ/ຮັບຄືນຕໍ່ຈາກໃບນີ້ແລ້ວ (${neg.rows[0].item_code}). ຕ້ອງລົບໃບຮັບກ່ອນ` }, { status: 409 });
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

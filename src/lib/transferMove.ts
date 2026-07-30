import type { PoolClient } from "pg";
import {
  type ErpItem,
  IN_TRANSIT_LOC,
  IN_TRANSIT_WH,
  TRANSFER_FORMAT,
  nextErpDocNo,
  postErpTransfer,
} from "@/lib/erpPost";
import { type MoveNote, saveMoveNotes } from "@/lib/moveReasons";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";

const WMS_FLAG = 72; // odg_wms_trans(_detail): ໃບໂອນສິນຄ້າ
const SN_FLAG = 56; // sn_trans(_detail)

export type TransitLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: number;
  serials: string[]; // serials being received/returned (sub-set of what is parked in 9903)
  location?: string | null; // per-line landing shelf; falls back to the doc-level locTo
};

export type MoveFromTransitParams = {
  refDoc: string; // the 124 doc — the in-transit goods are tagged with it
  whTo: string; // receive → destination warehouse; return → source warehouse
  locTo: string | null; // landing shelf at whTo (optional)
  user: string | null;
  stage: "receive" | "return";
  lines: TransitLine[];
  notes?: MoveNote[]; // short-movement reasons (optional)
};

/**
 * Move goods OUT of the in-transit warehouse (9903) into a real warehouse — the
 * second leg of a 124 transfer. `receive` lands them at the destination; `return`
 * sends the un-received remainder back to the source. Runs inside the caller's
 * transaction: validates against the live in-transit balance, writes the WMS
 * relocation (−1 at 9903, +1 at whTo) + serial ledger (relocate sn_inventory),
 * and posts the paired ERP ໃບໂອນ (70+72, 9903 → whTo).
 */
export async function moveFromTransit(
  client: PoolClient,
  p: MoveFromTransitParams,
): Promise<{ wmsDoc: string; erpDoc: string; serials: number }> {
  const { refDoc, whTo, locTo, user, stage, lines, notes } = p;
  // Per-warehouse policy: when the landing warehouse does not track serial
  // locations, relocate the stock only — drop serials so the ledger, validation
  // and sn_inventory relocation below are all skipped for this move.
  const moveSerials = await warehouseSnEnabled(whTo, "transfer", client);
  const active = lines
    .filter((l) => l.qty > 0)
    .map((l) => (moveSerials ? l : { ...l, serials: [] }));
  if (active.length === 0) throw new Error("ບໍ່ມີລາຍການໃຫ້ດຳເນີນ");

  // 1) Validate: qty ≤ in-transit balance for this ref; serials parked in 9903.
  for (const line of active) {
    const balRes = await client.query<{ bal: string }>(
      `SELECT COALESCE(SUM(qty * calc_flag), 0)::numeric::text AS bal
       FROM public.odg_wms_trans_detail
       WHERE (status = 0 OR status IS NULL) AND wh_code = $1 AND doc_ref = $2 AND item_code = $3`,
      [IN_TRANSIT_WH, refDoc, line.item_code],
    );
    const bal = Number.parseFloat(balRes.rows[0]?.bal ?? "0") || 0;
    if (line.qty > bal + 1e-6) {
      throw new Error(`ສິນຄ້າ ${line.item_code}: ${stage === "receive" ? "ຮັບ" : "ຮັບคืน"} ${line.qty} ເກີນທີ່ຄ້າງໃນສາງລະຫວ່າງທາງ ${bal}`);
    }
    if (line.serials.length > 0) {
      const okRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.sn_inventory
         WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($1) AND item_code = $2
           AND wh_code = $3 AND location = $4 AND COALESCE(status, 0) = 0`,
        [line.serials, line.item_code, IN_TRANSIT_WH, refDoc],
      );
      if ((Number.parseInt(okRes.rows[0]?.n ?? "0", 10) || 0) !== line.serials.length) {
        throw new Error(`ສິນຄ້າ ${line.item_code}: ບາງ serial ບໍ່ຢູ່ໃນສາງລະຫວ່າງທາງ ຫຼື ຖືກຮັບໄປແລ້ວ`);
      }
    }
  }

  // 2) WMS doc DP<YYMMDD>-<seq5>.
  const wmsDoc = (
    await client.query<{ doc_no: string }>(
      `SELECT 'DP' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('public.odg_wms_trans_roworder_seq')::text, 5, '0') AS doc_no`,
    )
  ).rows[0].doc_no;

  await client.query(
    `INSERT INTO public.odg_wms_trans (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
     VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
    [WMS_FLAG, wmsDoc, refDoc, whTo, user],
  );

  const totalSerials = active.reduce((s, l) => s + l.serials.length, 0);
  if (totalSerials > 0) {
    await client.query(
      `INSERT INTO public.sn_trans (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_def, doc_format_code, wh_code)
       VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, $5, 'DP', $6)`,
      [SN_FLAG, wmsDoc, user, totalSerials, refDoc, whTo],
    );
  }

  for (const line of active) {
    // Per-line landing shelf; falls back to the doc-level locTo.
    const lineLoc = (line.location && line.location.trim()) ? line.location.trim() : locTo;
    // −1 out of 9903 (still tagged with the ref so the balance nets down)
    await client.query(
      `INSERT INTO public.odg_wms_trans_detail
         (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
          shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, 0, -1, to_char(now(), 'HH24:MI'), NULL)`,
      [WMS_FLAG, wmsDoc, refDoc, line.item_code, line.item_name, line.qty, line.unit_code || null, refDoc, IN_TRANSIT_WH, user],
    );
    // +1 into the destination/source warehouse
    await client.query(
      `INSERT INTO public.odg_wms_trans_detail
         (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
          shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, 0, 1, to_char(now(), 'HH24:MI'), NULL)`,
      [WMS_FLAG, wmsDoc, refDoc, line.item_code, line.item_name, line.qty, line.unit_code || null, lineLoc || null, whTo, user],
    );

    if (line.serials.length > 0) {
      await client.query(
        `INSERT INTO public.sn_trans_detail
           (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
         SELECT $1, $2, CURRENT_DATE, $3, $4::varchar, inv.sn, 1, $5::varchar, $6, $7::varchar, 1, NULL, $8, NULL, inv.isn
         FROM public.sn_inventory inv
         WHERE COALESCE(NULLIF(inv.sn, ''), inv.isn) = ANY($9) AND inv.item_code = $4::varchar
           AND inv.wh_code = $10 AND inv.location = $7::varchar AND COALESCE(inv.status, 0) = 0`,
        [SN_FLAG, wmsDoc, user, line.item_code, whTo, line.item_name, refDoc, lineLoc || null, line.serials, IN_TRANSIT_WH],
      );
      // relocate the serial out of 9903 into whTo (still in-stock, status 0)
      await client.query(
        `UPDATE public.sn_inventory
           SET wh_code = $1, location = $2, rack = NULL, pallet = NULL, user_mapping = $3, updated_at = now()
         WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($4) AND item_code = $5
           AND wh_code = $6 AND location = $7::varchar AND COALESCE(status, 0) = 0`,
        [whTo, lineLoc || null, user, line.serials, line.item_code, IN_TRANSIT_WH, refDoc],
      );
    }
  }

  // 3) ERP ໃບໂອນ (70+72): 9903 → whTo.
  //
  // The ERP storage conditions (ທີ່ເກັບ) for this leg come from the 124 request,
  // which is the only place that records both ends: `shelf_code` = the source
  // condition, `shelf_code_2` = the destination condition. A receive lands at the
  // destination, a return goes back to the source — so each stage reads the end
  // it is actually moving TO. Falls back to the request header when the lines
  // carry no condition.
  const cond = await client.query<{ item_code: string; shelf_code: string | null; shelf_code_2: string | null }>(
    `SELECT item_code, NULLIF(TRIM(shelf_code), '') AS shelf_code, NULLIF(TRIM(shelf_code_2), '') AS shelf_code_2
     FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = 124 ORDER BY line_number`,
    [refDoc],
  );
  const destCondByItem = new Map<string, string | null>();
  for (const r of cond.rows) {
    if (!destCondByItem.has(r.item_code)) {
      destCondByItem.set(r.item_code, stage === "receive" ? r.shelf_code_2 : r.shelf_code);
    }
  }
  const reqHdr = await client.query<{ location_to: string | null; location_from: string | null }>(
    `SELECT NULLIF(TRIM(location_to), '') AS location_to, NULLIF(TRIM(location_from), '') AS location_from
     FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = 124 LIMIT 1`,
    [refDoc],
  );
  const hdrDestCond = stage === "receive" ? reqHdr.rows[0]?.location_to ?? null : reqHdr.rows[0]?.location_from ?? null;
  // Doc-level destination condition: an explicit one from the screen wins, then
  // the request's per-line condition, then its header.
  const destCond = locTo || [...destCondByItem.values()].find(Boolean) || hdrDestCond || null;

  // The outbound ໃບໂອນ this receive is the second half of — the FT the SOURCE
  // warehouse posted against the same 124 (its `wh_to` is the in-transit wh, which
  // is what separates it from the inbound FT being written right here). Named in
  // the remark so a receive can be traced back to the shipment it closes.
  const outFt = await client.query<{ doc_no: string }>(
    `SELECT DISTINCT doc_no FROM public.ic_trans
     WHERE doc_ref = $1 AND doc_format_code = $2 AND wh_to = $3 ORDER BY doc_no`,
    [refDoc, TRANSFER_FORMAT, IN_TRANSIT_WH],
  );
  const srcFt = outFt.rows.map((r) => r.doc_no).join(", ");

  const items: ErpItem[] = active.map((l) => ({
    item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: l.qty,
    // Goods leave the in-transit staging area, so the source condition is always
    // 990399 — never the ref doc, which is only a WMS tag on the 9903 balance.
    shelfCode: IN_TRANSIT_LOC,
    shelfCode2: destCondByItem.get(l.item_code) ?? destCond,
  }));
  const erpDoc = await nextErpDocNo(client, TRANSFER_FORMAT);
  const label = stage === "receive" ? "ຮັບຈາກຂໍໂອນ" : "ຮັບຄືນຈາກຂໍໂອນ";
  await postErpTransfer(client, {
    docNo: erpDoc,
    format: TRANSFER_FORMAT,
    items,
    whFrom: IN_TRANSIT_WH,
    locFrom: IN_TRANSIT_LOC,
    whTo,
    locTo: destCond,
    refDoc,
    user,
    wmsDoc,
    remark: `WMS ${label} ${refDoc}${srcFt ? ` ເລກທີໂອນຕົ້ນທາງ ${srcFt}` : ""}`,
  });

  // Short-movement reasons (best-effort; never blocks the commit).
  if (notes && notes.length > 0) {
    await saveMoveNotes(client, { docNo: wmsDoc, refDoc, stage, user, notes });
  }

  return { wmsDoc, erpDoc, serials: totalSerials };
}

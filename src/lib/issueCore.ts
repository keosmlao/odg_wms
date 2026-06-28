import type { PoolClient } from "pg";
import {
  type ErpItem,
  IN_TRANSIT_WH,
  TRANSFER_FORMAT,
  issueFormatFor,
  nextErpDocNo,
  postErpIssue,
  postErpTransfer,
} from "@/lib/erpPost";

const ISSUE_STOCK_FLAG = 72; // odg_wms_trans(_detail): ໃບໂອນສິນຄ້າ (calc_flag -1)
const ISSUE_SN_FLAG = 56; // sn_trans(_detail): ໃບເບີກເປັນສິນຄ້າ (calc_flag -1)

export type IssueLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string;
  qty: number;
  serials: string[];
  rack: string;
  location: string;
  pallet: string;
};

export type ExecuteIssueParams = {
  wh: string;
  docRef: string | null;
  sourceType: string; // req | transfer | sale
  /** Doc-level location for the ERP issue header (falls back per line). */
  location: string | null;
  user: string | null;
  lines: IssueLine[];
};

/**
 * Finalize a goods issue inside the caller's transaction: validate stock/serials,
 * write the WMS movement (DP, odg_wms_trans −1) + serial ledger (+ flip
 * sn_inventory to issued) + the ERP doc (56 / 70+72). Throws on a validation
 * failure (caller rolls back). Shared by the direct issue and the pending-draft
 * confirm so both paths post identically.
 */
export async function executeIssue(client: PoolClient, p: ExecuteIssueParams): Promise<{ issueCode: string; erpDoc: string | null; serials: number }> {
  const { wh, docRef, sourceType, location, user, lines } = p;
  // A transfer (124) does NOT consume stock — it RELOCATES the goods into the
  // in-transit warehouse (9903). The destination receives them later. A req/sale
  // is a true consumption (serials leave: sn_inventory.status → 1).
  const isTransfer = sourceType === "transfer";

  // 0) Items that actually hold in-stock serials must be issued by serial.
  const snRes = await client.query<{ item_code: string }>(
    `SELECT DISTINCT item_code FROM public.sn_inventory
     WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)`,
    [wh, lines.map((l) => l.item_code)],
  );
  const hasSerials = new Set(snRes.rows.map((r) => r.item_code));
  for (const line of lines) {
    if (hasSerials.has(line.item_code) && line.serials.length === 0) {
      throw new Error(`ສິນຄ້າ ${line.item_code} ມີ serial — ຕ້ອງເລືອກ/ຍິງ serial ກ່ອນຈ່າຍ`);
    }
  }

  // 1) Validate each line: qty ≤ node balance; serials in stock here.
  for (const line of lines) {
    const balRes = await client.query<{ before: string }>(
      `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS before
       FROM public.odg_wms_trans_detail t
       WHERE (t.status = 0 OR t.status IS NULL)
         AND t.wh_code = $1
         AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  = $2
         AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
         AND COALESCE(NULLIF(TRIM(t.pallet), ''), '')      = $4
         AND t.item_code = $5`,
      [wh, line.rack, line.location, line.pallet, line.item_code],
    );
    const before = Number.parseFloat(balRes.rows[0]?.before ?? "0") || 0;
    if (line.qty > before + 1e-6) {
      throw new Error(`ສິນຄ້າ ${line.item_code}: ຈ່າຍ ${line.qty} ເກີນຄົງເຫຼືອ ${before}`);
    }
    if (line.serials.length > 0) {
      const okRes = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.sn_inventory
         WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($1) AND item_code = $2 AND wh_code = $3 AND COALESCE(status, 0) = 0`,
        [line.serials, line.item_code, wh],
      );
      if ((Number.parseInt(okRes.rows[0]?.n ?? "0", 10) || 0) !== line.serials.length) {
        throw new Error(`ສິນຄ້າ ${line.item_code}: ບາງ serial ບໍ່ມີໃນສາງ ຫຼື ຖືກຈ່າຍໄປແລ້ວ`);
      }
    }
  }

  // 2) doc_no = DP<YYMMDD>-<seq5>.
  const docNo = (
    await client.query<{ doc_no: string }>(
      `SELECT 'DP' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('public.odg_wms_trans_roworder_seq')::text, 5, '0') AS doc_no`,
    )
  ).rows[0].doc_no;

  // 3) WMS movement header.
  await client.query(
    `INSERT INTO public.odg_wms_trans (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
     VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
    [ISSUE_STOCK_FLAG, docNo, docRef || null, wh, user],
  );

  const totalSerials = lines.reduce((s, l) => s + l.serials.length, 0);
  if (totalSerials > 0) {
    await client.query(
      `INSERT INTO public.sn_trans (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_def, doc_format_code, wh_code)
       VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, $5, 'DP', $6)`,
      [ISSUE_SN_FLAG, docNo, user, totalSerials, docRef || null, wh],
    );
  }

  for (const line of lines) {
    await client.query(
      `INSERT INTO public.odg_wms_trans_detail
         (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
          shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, -1, to_char(now(), 'HH24:MI'), $12)`,
      [ISSUE_STOCK_FLAG, docNo, docRef || null, line.item_code, line.item_name, line.qty, line.unit_code || null, line.rack || null, line.location || null, wh, user, line.pallet || null],
    );
    // Transfer: park the goods in the in-transit warehouse (+1 at 9903, shelf =
    // the 124 ref so receive/return can find them). Net company stock unchanged.
    if (isTransfer) {
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
            shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $10, 0, 1, to_char(now(), 'HH24:MI'), NULL)`,
        [ISSUE_STOCK_FLAG, docNo, docRef || null, line.item_code, line.item_name, line.qty, line.unit_code || null, docRef || null, IN_TRANSIT_WH, user],
      );
    }
    if (line.serials.length > 0) {
      await client.query(
        `INSERT INTO public.sn_trans_detail
           (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
         SELECT $1, $2, CURRENT_DATE, $3, $4::varchar, inv.sn, 1, $5::varchar, $6, $7, -1, inv.rack, inv.location, inv.pallet, inv.isn
         FROM public.sn_inventory inv
         WHERE COALESCE(NULLIF(inv.sn, ''), inv.isn) = ANY($8) AND inv.item_code = $4::varchar AND inv.wh_code = $5::varchar`,
        [ISSUE_SN_FLAG, docNo, user, line.item_code, wh, line.item_name, docRef || null, line.serials],
      );
      if (isTransfer) {
        // Relocate the serial into 9903, tagged with the 124 ref (location), still
        // in-stock (status 0). Receive/return moves it on to dest/source.
        await client.query(
          `UPDATE public.sn_inventory
             SET wh_code = $1, location = $2, rack = NULL, pallet = NULL, user_mapping = $3, updated_at = now()
           WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($4) AND item_code = $5 AND wh_code = $6 AND COALESCE(status, 0) = 0`,
          [IN_TRANSIT_WH, docRef || null, user, line.serials, line.item_code, wh],
        );
      } else {
        await client.query(
          `UPDATE public.sn_inventory SET status = 1, user_mapping = $1
           WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($2) AND item_code = $3 AND wh_code = $4 AND COALESCE(status, 0) = 0`,
          [user, line.serials, line.item_code, wh],
        );
      }
    }
  }

  // 4) ERP posting (same tx).
  let erpDoc: string | null = null;
  if (sourceType === "req" || sourceType === "transfer") {
    const byItem = new Map<string, ErpItem>();
    for (const l of lines) {
      const e = byItem.get(l.item_code);
      if (e) e.qty += l.qty;
      else byItem.set(l.item_code, { item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: l.qty });
    }
    const items = [...byItem.values()];
    if (sourceType === "req") {
      const fmt = issueFormatFor(wh);
      erpDoc = await nextErpDocNo(client, fmt);
      await postErpIssue(client, { docNo: erpDoc, format: fmt, items, wh, location: location || null, refDoc: docRef || null, user, wmsDoc: docNo, remark: docRef ? `WMS issue ${docRef}` : null });
    } else {
      const dest = await client.query<{ wh_to: string | null; location_to: string | null }>(
        `SELECT wh_to, location_to FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = 124 LIMIT 1`,
        [docRef],
      );
      const whTo = dest.rows[0]?.wh_to ?? "";
      if (!whTo) throw new Error("ບໍ່ພົບສາງປາຍທາງຂອງໃບຂໍໂອນ (124)");
      // ERP leg 1 of the transfer: source → in-transit (9903). The destination
      // posts leg 2 (9903 → dest) when it receives.
      erpDoc = await nextErpDocNo(client, TRANSFER_FORMAT);
      await postErpTransfer(client, { docNo: erpDoc, format: TRANSFER_FORMAT, items, whFrom: wh, locFrom: location || null, whTo: IN_TRANSIT_WH, locTo: docRef || null, refDoc: docRef || null, user, wmsDoc: docNo, remark: docRef ? `WMS transfer ${docRef} → ສາງລະຫວ່າງທາງ` : null });
    }
  }

  return { issueCode: docNo, erpDoc, serials: totalSerials };
}

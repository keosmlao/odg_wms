import type { PoolClient } from "pg";

/**
 * ERP (SmartBiz/SML) document posting for WMS goods-out.
 *
 * Verified against the production ERP (od_trans_flag + real docs):
 *   ໃບຂໍເບີກ (122)  → fulfilling creates ໃບເບີກເປັນສິນຄ້າ  trans_flag 56  (single −1 leg)
 *   ໃບຂໍໂອນ (124)  → fulfilling creates ໃບໂອນ            trans_flag 70+72 (paired)
 *   ບິນຂາຍ (44)    → the sale already books stock out (nothing to post)
 *
 * A transfer (ໃບໂອນ) is two ic_trans headers under ONE doc_no:
 *   72 leg: calc_flag −1, wh_code = source, wh_code_2 = dest
 *   70 leg: calc_flag +1, wh_code = dest,   wh_code_2 = source
 *
 * Balance caches:
 *   ic_inventory.balance_qty is GLOBAL (one row/item, a real cached column). An
 *   issue (consumption) decrements it; a transfer is net-zero across the company
 *   so it is NOT changed. `stock_balance` is a VIEW (computed per warehouse incl.
 *   average_cost) — it must NOT be written; it recomputes from the ERP's own
 *   base data once the ic_trans_detail rows exist.
 *
 * SAFETY: the SmartBiz cost/balance logic is non-trivial. We only insert the
 * authoritative movement documents and the one well-defined cache (the global
 * balance_qty quantity); the per-warehouse view recomputes the rest.
 */

export const ERP_ISSUE_FLAG = 56; // ໃບເບີກເປັນສິນຄ້າ
export const ERP_TRANSFER_OUT = 72; // ໃບໂອນສິນຄ້າ (out leg)
export const ERP_TRANSFER_IN = 70; // ໃບເບີກສິນຄ້າ (in leg)
export const ERP_PURCHASE_CREDIT_FLAG = 12; // ໃບຊື້ສິນຄ້າຕິດໜີ້ (goods-in +1 AND sets AP)
const TRANS_TYPE = 3; // stock-movement document family
const TRANS_TYPE_PURCHASE = 1; // purchase/AP document family

export type ErpItem = { item_code: string; item_name: string | null; unit_code: string | null; qty: number };

/**
 * Per-warehouse default doc_format_code for a ໃບເບີກ (56). In SmartBiz the format
 * is really category-driven, but each warehouse has a dominant format (derived
 * from the last 180 days of real 56 docs). Override per warehouse as needed.
 * Transfers (ໃບໂອນ) always use FT.
 */
export const ISSUE_FORMAT_BY_WH: Record<string, string> = {
  "1101": "WFOK", "1102": "WFOH", "1103": "SWC", "1104": "IOK", "1105": "WFOH",
  "1201": "WFOH", "1202": "WFOH", "1203": "SWC", "1204": "SWC", "1205": "WFOH", "1206": "SWC",
  "1301": "WEOH", "1302": "WCPH", "1303": "WCPH", "1304": "WEOH",
  "1401": "WEOH", "1404": "WFOH", "9904": "IOIT",
};
export const TRANSFER_FORMAT = "FT";
/**
 * In-transit warehouse (ສາງລະຫວ່າງທາງ, code 9903). A transfer (124) is fulfilled
 * in stages: the source issues INTO 9903 (source→9903), the destination later
 * RECEIVES out of it (9903→dest, actual qty), and the source may RETURN the
 * remainder (9903→source). Goods parked in 9903 carry doc_ref = the 124 doc, so
 * the live in-transit balance is SUM(qty·calc_flag) over wh_code=9903 for that ref.
 */
export const IN_TRANSIT_WH = "9903";
export function issueFormatFor(wh: string): string {
  return ISSUE_FORMAT_BY_WH[wh] ?? "WFOH"; // WFOH = most common overall fallback
}

/**
 * Next ERP doc_no for a format: `<format><YYMM><####>` (e.g. IOIT26060019,
 * FT26060474) — running = max for that format+month + 1. A transaction-scoped
 * advisory lock serializes WMS allocations; a unique-violation retry would still
 * be needed if SmartBiz allocates the same number concurrently (caller handles).
 */
export async function nextErpDocNo(client: PoolClient, format: string): Promise<string> {
  await client.query(`SELECT pg_advisory_xact_lock(424243, hashtext($1))`, [format]);
  const r = await client.query<{ doc_no: string }>(
    `SELECT $1 || to_char(CURRENT_DATE, 'YYMM') ||
            lpad((COALESCE(MAX(substring(doc_no from char_length($1) + 5)::int), 0) + 1)::text, 4, '0') AS doc_no
     FROM public.ic_trans
     WHERE doc_format_code = $1
       AND doc_no LIKE $1 || to_char(CURRENT_DATE, 'YYMM') || '%'
       AND substring(doc_no from char_length($1) + 5) ~ '^[0-9]+$'`,
    [format],
  );
  return r.rows[0].doc_no;
}

/**
 * Average cost for COGS. Uses the cached `ic_inventory.average_cost` (global, ~5ms).
 * The per-warehouse `stock_balance` VIEW is more precise but RECOMPUTES from all base
 * data (tens of seconds per call) — far too slow to run per line inside the issue
 * transaction. SmartBiz recomputes the authoritative per-warehouse cost from the
 * movement rows we insert, so the cached value is a safe estimate to post with.
 */
async function avgCost(client: PoolClient, item: string, _wh: string): Promise<number> {
  const r = await client.query<{ average_cost: string | null }>(
    `SELECT average_cost FROM public.ic_inventory WHERE code = $1 LIMIT 1`,
    [item],
  );
  return Number.parseFloat(r.rows[0]?.average_cost ?? "0") || 0;
}

function insHeaderSql(): string {
  // doc_ref_trans = the WMS DP doc that created this ERP doc → lets the DP
  // delete find and reverse the 56 / 70+72 it posted.
  return `INSERT INTO public.ic_trans
    (trans_type, trans_flag, doc_date, doc_no, doc_format_code, branch_code,
     wh_from, location_from, wh_to, location_to, remark, status, doc_success,
     doc_time, creator_code, total_amount, total_cost, doc_ref_trans, create_date_time_now)
   VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0,
           to_char(now(),'HH24:MI'), $11, $12, $12, $13, now())`;
}

function insDetailSql(): string {
  return `INSERT INTO public.ic_trans_detail
    (trans_type, trans_flag, doc_date, doc_no, item_code, item_name, unit_code,
     qty, calc_flag, wh_code, shelf_code, wh_code_2, shelf_code_2, branch_code,
     average_cost, sum_of_cost, sum_amount_exclude_vat, ref_doc_no, line_number,
     stand_value, divide_value, is_get_price, status, doc_time, create_date_time_now)
   VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $15, $16, $17, 1, 1, 1, 0, to_char(now(),'HH24:MI'), now())`;
}

/** Post a ໃບເບີກເປັນສິນຄ້າ (56) for an issue fulfilled from a 122 request. */
export async function postErpIssue(
  client: PoolClient,
  opts: { docNo: string; format: string; items: ErpItem[]; wh: string; location: string | null; refDoc: string | null; user: string | null; wmsDoc?: string | null; branch?: string; remark?: string | null },
): Promise<{ total: number }> {
  const branch = opts.branch ?? "00";
  let total = 0;
  const costed = [] as { it: ErpItem; cost: number }[];
  for (const it of opts.items) {
    const cost = await avgCost(client, it.item_code, opts.wh);
    costed.push({ it, cost });
    total += it.qty * cost;
  }
  await client.query(insHeaderSql(), [
    TRANS_TYPE, ERP_ISSUE_FLAG, opts.docNo, opts.format, branch,
    opts.wh, opts.location, null, null, opts.remark ?? null, opts.user, total, opts.wmsDoc ?? null,
  ]);
  let line = 0;
  for (const { it, cost } of costed) {
    const sum = Math.round(it.qty * cost * 100) / 100;
    await client.query(insDetailSql(), [
      TRANS_TYPE, ERP_ISSUE_FLAG, opts.docNo, it.item_code, it.item_name, it.unit_code,
      it.qty, -1, opts.wh, opts.location, null, null, branch, cost, sum, opts.refDoc, line++,
    ]);
    // consumption leaves the company → drop the global cached balance.
    // (stock_balance is a computed view and refreshes itself from the new rows.)
    await client.query(`UPDATE public.ic_inventory SET balance_qty = COALESCE(balance_qty, 0) - $1 WHERE code = $2`, [it.qty, it.item_code]);
  }
  return { total };
}

/** Post a ໃບໂອນ (paired 72 out + 70 in) for a transfer fulfilled from a 124 request. */
export async function postErpTransfer(
  client: PoolClient,
  opts: { docNo: string; format: string; items: ErpItem[]; whFrom: string; locFrom: string | null; whTo: string; locTo: string | null; refDoc: string | null; user: string | null; wmsDoc?: string | null; branch?: string; remark?: string | null },
): Promise<{ total: number }> {
  const branch = opts.branch ?? "00";
  let total = 0;
  const costed = [] as { it: ErpItem; cost: number }[];
  for (const it of opts.items) {
    const cost = await avgCost(client, it.item_code, opts.whFrom);
    costed.push({ it, cost });
    total += it.qty * cost;
  }
  // Two headers, same doc_no: 72 (out) then 70 (in).
  for (const flag of [ERP_TRANSFER_OUT, ERP_TRANSFER_IN]) {
    await client.query(insHeaderSql(), [
      TRANS_TYPE, flag, opts.docNo, opts.format, branch,
      opts.whFrom, opts.locFrom, opts.whTo, opts.locTo, opts.remark ?? null, opts.user, total, opts.wmsDoc ?? null,
    ]);
  }
  let line = 0;
  for (const { it, cost } of costed) {
    const sum = Math.round(it.qty * cost * 100) / 100;
    // 72 out leg: −1 from source
    await client.query(insDetailSql(), [
      TRANS_TYPE, ERP_TRANSFER_OUT, opts.docNo, it.item_code, it.item_name, it.unit_code,
      it.qty, -1, opts.whFrom, opts.locFrom, opts.whTo, opts.locTo, branch, cost, sum, opts.refDoc, line,
    ]);
    // 70 in leg: +1 into dest
    await client.query(insDetailSql(), [
      TRANS_TYPE, ERP_TRANSFER_IN, opts.docNo, it.item_code, it.item_name, it.unit_code,
      it.qty, 1, opts.whTo, opts.locTo, opts.whFrom, opts.locFrom, branch, cost, sum, opts.refDoc, line++,
    ]);
    // Transfer is net-zero for the global balance; the per-warehouse view
    // (stock_balance) recomputes from the inserted legs. Nothing else to cache.
  }
  return { total };
}

/**
 * Reverse the ERP doc(s) posted by a WMS DP issue (found via doc_ref_trans):
 * restore ic_inventory.balance_qty and delete the ic_trans / ic_trans_detail.
 *
 * Restoring balance = `balance_qty − SUM(qty·calc_flag)` per item: for a 56
 * issue (one −1 leg) that adds the qty back; for a 70+72 transfer the legs net
 * to zero, so it is a no-op (matching how the post left the global balance).
 */
export async function reverseErpByWmsDoc(client: PoolClient, wmsDoc: string): Promise<{ reversed: number; docs: string[] }> {
  const found = await client.query<{ doc_no: string }>(
    `SELECT DISTINCT doc_no FROM public.ic_trans WHERE doc_ref_trans = $1`,
    [wmsDoc],
  );
  const docNos = found.rows.map((r) => r.doc_no);
  if (docNos.length === 0) return { reversed: 0, docs: [] };
  await client.query(
    `UPDATE public.ic_inventory i
       SET balance_qty = COALESCE(i.balance_qty, 0) - agg.net
     FROM (
       SELECT item_code, SUM(qty * calc_flag) AS net
       FROM public.ic_trans_detail WHERE doc_no = ANY($1)
       GROUP BY item_code
     ) agg
     WHERE i.code = agg.item_code`,
    [docNos],
  );
  await client.query(`DELETE FROM public.ic_trans_detail WHERE doc_no = ANY($1)`, [docNos]);
  await client.query(`DELETE FROM public.ic_trans WHERE doc_no = ANY($1)`, [docNos]);
  return { reversed: docNos.length, docs: docNos };
}

// ── Goods receipt → credit purchase (ໃບຊື້ສິນຄ້າຕິດໜີ້, flag 12) ─────────────
// Posts a purchase invoice that (a) books stock IN (+1) and (b) sets the payable
// to the supplier. AP (fa_ap_balance / odg_ap_balance) are VIEWS that recompute
// from ic_trans, so inserting the header + detail is enough — no AP table write.
//
// Prices + VAT + supplier come from the referenced PO (ic_trans flag 6). Only
// received items that exist on the PO can be priced; others are returned in
// `missing` (their stock is already received in WMS, just not on this AP doc).

export type PurchaseReceiptLine = { item_code: string; item_name: string | null; unit_code: string | null; qty: number };

/** PO doc_format_code → credit-purchase format (POT→PUIT, POH→PUIH). */
function purchaseFormatForPo(poFormat: string): string {
  if (poFormat === "POT") return "PUIT";
  if (poFormat === "POH") return "PUIH";
  return "PUIH";
}

type PoHeader = {
  doc_format_code: string; cust_code: string | null; branch_code: string | null;
  vat_rate: string | null; currency_code: string | null; exchange_rate: string | null;
};

export async function postErpPurchaseReceipt(
  client: PoolClient,
  opts: {
    poNo: string;              // referenced PO (ic_trans flag 6) — source of price/VAT/supplier
    items: PurchaseReceiptLine[]; // received quantities (priced at PO price)
    wh: string;
    location?: string | null;  // landing shelf (shelf_code)
    user: string | null;
    wmsDoc: string;            // WMS receipt doc → doc_ref_trans (lets a delete reverse it)
    remark?: string | null;
  },
): Promise<{ docNo: string; total: number; posted: number; missing: string[] } | null> {
  const poRes = await client.query<PoHeader>(
    `SELECT doc_format_code, cust_code, branch_code, vat_rate, currency_code, exchange_rate
     FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = 6 LIMIT 1`,
    [opts.poNo],
  );
  const po = poRes.rows[0];
  if (!po) return null; // no PO → cannot price the payable

  const priceRes = await client.query<{ item_code: string; price: string }>(
    `SELECT item_code, MAX(COALESCE(NULLIF(price_exclude_vat, 0), price)) AS price
     FROM public.ic_trans_detail WHERE doc_no = $1 GROUP BY item_code`,
    [opts.poNo],
  );
  const priceByItem = new Map(priceRes.rows.map((r) => [r.item_code, Number.parseFloat(r.price) || 0]));

  const vatRate = Number.parseFloat(po.vat_rate ?? "0") || 0;
  const branch = po.branch_code ?? "00";
  const priced: { it: PurchaseReceiptLine; price: number; exVat: number; vat: number }[] = [];
  const missing: string[] = [];
  for (const it of opts.items) {
    if (Math.round(it.qty) <= 0) continue;
    const price = priceByItem.get(it.item_code);
    if (price === undefined) { missing.push(it.item_code); continue; }
    const exVat = Math.round(it.qty * price * 100) / 100;
    const vat = Math.round(exVat * (vatRate / 100) * 100) / 100;
    priced.push({ it, price, exVat, vat });
  }
  if (priced.length === 0) return { docNo: "", total: 0, posted: 0, missing };

  const totalExVat = priced.reduce((s, p) => s + p.exVat, 0);
  const totalVat = priced.reduce((s, p) => s + p.vat, 0);
  const totalAfterVat = Math.round((totalExVat + totalVat) * 100) / 100;

  const docNo = await nextErpDocNo(client, purchaseFormatForPo(po.doc_format_code));

  // Header (flag 12). credit_date defaults to today (net terms recompute in ERP).
  await client.query(
    `INSERT INTO public.ic_trans
       (trans_type, trans_flag, doc_date, doc_no, doc_format_code, branch_code,
        cust_code, vat_rate, currency_code, exchange_rate,
        total_value, total_before_vat, total_vat_value, total_after_vat, total_amount,
        credit_date, doc_ref, doc_ref_date, tax_doc_no, tax_doc_date,
        remark, status, doc_success, doc_time, creator_code, doc_ref_trans, create_date_time_now)
     VALUES ($1,$2,CURRENT_DATE,$3,$4,$5, $6,$7,$8,$9,
             $10,$10,$11,$12,$12, CURRENT_DATE,$13,CURRENT_DATE,$3,CURRENT_DATE,
             $14,0,0,to_char(now(),'HH24:MI'),$15,$16,now())`,
    [
      TRANS_TYPE_PURCHASE, ERP_PURCHASE_CREDIT_FLAG, docNo, purchaseFormatForPo(po.doc_format_code), branch,
      po.cust_code, vatRate, po.currency_code, po.exchange_rate,
      totalExVat, totalVat, totalAfterVat,
      opts.remark ?? null, opts.user, opts.wmsDoc,
    ],
  );

  let line = 0;
  for (const { it, price, exVat, vat } of priced) {
    await client.query(
      `INSERT INTO public.ic_trans_detail
         (trans_type, trans_flag, doc_date, doc_no, item_code, item_name, unit_code,
          qty, calc_flag, wh_code, shelf_code, branch_code,
          price, price_exclude_vat, sum_amount, sum_amount_exclude_vat, total_vat_value,
          average_cost, ref_doc_no, line_number, stand_value, divide_value, is_get_price,
          status, doc_time, create_date_time_now)
       VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,
               $7,1,$8,$9,$10,
               $11,$11,$12,$13,$14,
               $11,$15,$16,1,1,1,
               0,to_char(now(),'HH24:MI'),now())`,
      [
        TRANS_TYPE_PURCHASE, ERP_PURCHASE_CREDIT_FLAG, docNo, it.item_code, it.item_name, it.unit_code,
        it.qty, opts.wh, opts.location ?? null, branch,
        price, exVat, exVat, vat,
        opts.poNo, line++,
      ],
    );
    // Goods enter the company → raise the global cached balance (mirror of issue).
    await client.query(`UPDATE public.ic_inventory SET balance_qty = COALESCE(balance_qty, 0) + $1 WHERE code = $2`, [it.qty, it.item_code]);
  }
  return { docNo, total: totalAfterVat, posted: priced.length, missing };
}

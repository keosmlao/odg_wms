import type { PoolClient } from "pg";
import { getIsnScope } from "@/lib/isnScope";

/**
 * Shared WMS goods-receipt helpers, used by both the direct receive route
 * (src/app/api/receive/route.ts) and the count-sheet → WMS-receipt flow
 * (src/app/api/receive/count/[doc]/post/route.ts).
 */

export const RECEIVE_TRANS_FLAG = 1; // stock movement: receive (calc_flag +1)
export const SN_RECEIPT_FLAG = 81; // serial ledger: goods receipt

// wms_product_receive.doc_type is a smallint — these codes mark each kind:
export const DOC_TYPE = {
  receipt: 1, // ໃບຮັບ WMS (posted goods receipt)
  count: 2, // ໃບກວດນັບ (count/inspection sheet)
} as const;

// Count-sheet (ໃບກວດນັບ) status lifecycle on wms_product_receive (smallint):
export const RECEIVE_STATUS = {
  posted: 0, // ຮັບເຂົ້າ WMS ແລ້ວ (stock posted)
  draft: 9, // ໃບກວດນັບ — counted, not yet received into WMS
  consumed: 5, // count sheet already turned into a WMS receipt
} as const;

/** ISN year-code: A = 2025, B = 2026, … (one letter per year). */
export function isnYearCode(year: number): string {
  const idx = year - 2025;
  return idx >= 0 && idx < 26 ? String.fromCharCode(65 + idx) : "A";
}

/** Generate a receive doc_no: <prefix><YYMMDD>-<seq5> (prefix e.g. RC / CK). */
export async function genDocNo(client: PoolClient, prefix: string): Promise<string> {
  const r = await client.query<{ doc_no: string }>(
    `SELECT $1 || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
            lpad(nextval('public.wms_product_receive_roworder_seq')::text, 5, '0') AS doc_no`,
    [prefix],
  );
  return r.rows[0].doc_no;
}

export type IsnInfo = { is_isn: boolean; category: string };

/**
 * ຕ້ອງເກັບ ISN ບໍ + ໝວດ (ISN ອອກໄດ້ຕໍ່ເມື່ອ ຕ້ອງເກັບ ແລະ ໝວດບໍ່ຫວ່າງ).
 *
 * ອ່ານຈາກ config ຂອງ WMS (ໝວດ + ຍົກເວັ້ນລາຍການ — src/lib/isnScope.ts) ບໍ່ແມ່ນ
 * `ic_inventory.is_isn` ອີກຕໍ່ໄປ: SML ຕັ້ງທຸງນັ້ນໄວ້ 99.8% ຂອງລາຍການ ຈຶ່ງເຮັດໃຫ້
 * ຮັບສິນຄ້າຫຍັງເຂົ້າກໍບັງຄັບສ້າງ ISN ທຸກຕົວ.
 */
export async function getIsnInfo(client: PoolClient, itemCodes: string[]): Promise<Map<string, IsnInfo>> {
  const scope = await getIsnScope(client, itemCodes);
  return new Map(Array.from(scope, ([code, s]) => [code, { is_isn: s.needs_isn, category: s.category }]));
}

/**
 * Current max running number for an ISN prefix (`<category><yearCode>`), across
 * the serial ledger, the ERP ISN mapping, serial stock, AND serials already
 * reserved on count sheets — so generated ISN never reuses a number, even when
 * several count sheets are open at once. Returns the max as a numeric string.
 */
export async function getMaxIsnSeq(client: PoolClient, prefix: string): Promise<string> {
  // Serialize ISN generation per (category+year) prefix: two concurrent
  // receipts/adjustments would otherwise read the same MAX under READ COMMITTED
  // and mint DUPLICATE ISN. The xact-scoped advisory lock is held until this
  // transaction commits — by which point its reserved rows are visible to the
  // next waiter's MAX. (All callers run inside BEGIN…COMMIT.) 424242 = ISN class.
  await client.query(`SELECT pg_advisory_xact_lock(424242, hashtext($1))`, [prefix]);
  const r = await client.query<{ maxseq: string }>(
    `SELECT GREATEST(
       COALESCE((SELECT MAX(CASE WHEN substring(sn  from 5) ~ '^[0-9]+$' THEN substring(sn  from 5)::bigint ELSE 0 END) FROM public.sn_trans_detail WHERE sn  LIKE $1), 0),
       COALESCE((SELECT MAX(CASE WHEN substring(isn from 5) ~ '^[0-9]+$' THEN substring(isn from 5)::bigint ELSE 0 END) FROM public.odg_mapping_isn  WHERE isn LIKE $1), 0),
       COALESCE((SELECT MAX(CASE WHEN substring(isn from 5) ~ '^[0-9]+$' THEN substring(isn from 5)::bigint ELSE 0 END) FROM public.sn_inventory     WHERE isn LIKE $1), 0),
       COALESCE((SELECT MAX(CASE WHEN substring(serial_number from 5) ~ '^[0-9]+$' THEN substring(serial_number from 5)::bigint ELSE 0 END) FROM public.wms_product_receive_serial_detail WHERE serial_number LIKE $1), 0)
     )::text AS maxseq`,
    [`${prefix}%`],
  );
  return r.rows[0].maxseq;
}

export type CountSerialInput = { serial_number: string };
export type CountLineInput = { item_code: string; qty: number; serials: CountSerialInput[] };

/**
 * Reserve a count sheet's serials in wms_product_receive_serial_detail at save
 * time (ref_rec_doc = count doc): manual serials verbatim, then auto-generate ISN
 * for the remaining (qty − manual) units of each serialized item. Generated
 * numbers continue the global per-(category, year) sequence and are reserved by
 * their own rows (getMaxIsnSeq counts them), so a later line / count sheet never
 * reuses one. They are committed to the serial ledger only at WMS-receipt time.
 */
export async function writeCountSerials(
  client: PoolClient,
  docNo: string,
  lines: CountLineInput[],
  poNos: string[] = [],
): Promise<{ generated: number; manual: number; reused: number; serializedNoCategory: number }> {
  const info = await getIsnInfo(client, lines.map((l) => l.item_code));
  const yearCode = isnYearCode(new Date().getFullYear());
  let generated = 0, manual = 0, reused = 0, serializedNoCategory = 0;
  for (const line of lines) {
    for (const s of line.serials) {
      await client.query(
        `INSERT INTO public.wms_product_receive_serial_detail (ref_rec_doc, ref_rec_date, item_code, serial_number, is_lock_record, create_date_time_now)
         VALUES ($1, CURRENT_DATE, $2, $3, 0, now())`,
        [docNo, line.item_code, s.serial_number],
      );
      manual += 1;
    }
    const inf = info.get(line.item_code);
    if (!inf?.is_isn) continue;
    const target = Math.round(line.qty);

    // Serials already reused onto this doc (preserved across PUT edits).
    const existingReused = Number.parseInt(
      (await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.wms_product_receive_serial_detail
         WHERE ref_rec_doc = $1 AND item_code = $2 AND COALESCE(is_lock_record,0) = 1`,
        [docNo, line.item_code],
      )).rows[0]?.n ?? "0",
      10,
    );

    let need = target - line.serials.length - existingReused;
    if (need < 0) {
      // Counted qty dropped below what's already reused → release the surplus
      // reused serials back to the held pool (they stay on this doc, ignore_sync=1).
      await client.query(
        `UPDATE public.wms_product_receive_serial_detail SET ignore_sync = 1, is_lock_record = 0, last_update_date_time_now = now()
         WHERE ctid IN (
           SELECT ctid FROM public.wms_product_receive_serial_detail
           WHERE ref_rec_doc = $1 AND item_code = $2 AND COALESCE(is_lock_record,0) = 1
           ORDER BY serial_number DESC LIMIT $3)`,
        [docNo, line.item_code, -need],
      );
      continue;
    }
    if (need === 0) continue;

    // 1) Reuse held SN from earlier (incomplete) receipts of the SAME PO(s)+item —
    //    the labels are already printed. Re-point them onto this count sheet.
    //    Matches any of the sheet's POs via the receipt's PO list.
    if (poNos.length > 0) {
      const claimed = await client.query<{ serial_number: string }>(
        `UPDATE public.wms_product_receive_serial_detail
           SET ref_rec_doc = $1, ignore_sync = 0, is_lock_record = 1, last_update_date_time_now = now()
         WHERE ctid IN (
           SELECT sd.ctid
           FROM public.wms_product_receive_serial_detail sd
           JOIN public.wms_product_receive_po rp ON rp.doc_no = sd.ref_rec_doc AND rp.po_no = ANY($2)
           WHERE sd.item_code = $3
             AND COALESCE(sd.ignore_sync,0) = 1 AND sd.ref_rec_doc <> $1
           ORDER BY sd.serial_number
           FOR UPDATE OF sd SKIP LOCKED
           LIMIT $4)
         RETURNING serial_number`,
        [docNo, poNos, line.item_code, need],
      );
      reused += claimed.rowCount ?? 0;
      need -= claimed.rowCount ?? 0;
    }

    // 2) Generate fresh ISN for whatever is still short.
    if (need <= 0) continue;
    if (!inf.category) { serializedNoCategory += 1; continue; }
    const prefix = `${inf.category}${yearCode}`;
    const maxseq = await getMaxIsnSeq(client, prefix);
    await client.query(
      `INSERT INTO public.wms_product_receive_serial_detail (ref_rec_doc, ref_rec_date, item_code, serial_number, is_lock_record, create_date_time_now)
       SELECT $1, CURRENT_DATE, $2, $3 || lpad(($4::bigint + g)::text, 7, '0'), 0, now()
       FROM generate_series(1, $5) g`,
      [docNo, line.item_code, prefix, maxseq, need],
    );
    generated += need;
  }
  return { generated, manual, reused, serializedNoCategory };
}

export type StockLine = {
  item_code: string;
  item_name: string | null;
  qty: number;
  unit_code: string | null;
  rack: string | null;
  location: string | null;
  pallet: string | null;
};

/** WMS stock-movement header (odg_wms_trans) — one per receive. */
export async function insertTransHeader(
  client: PoolClient,
  opts: { docNo: string; docRef: string | null; wh: string; user: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO public.odg_wms_trans
       (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
     VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
    [RECEIVE_TRANS_FLAG, opts.docNo, opts.docRef, opts.wh, opts.user],
  );
}

/** WMS stock-movement detail (odg_wms_trans_detail, +1) — updates location balance. */
export async function insertTransDetail(
  client: PoolClient,
  opts: { docNo: string; docRef: string | null; wh: string; user: string | null; line: StockLine },
): Promise<void> {
  const { line } = opts;
  await client.query(
    `INSERT INTO public.odg_wms_trans_detail
       (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name,
        qty, unit_code, shelf_code, shelf_code1, wh_code, user_created,
        status, calc_flag, doc_time, pallet)
     VALUES
       ($1, CURRENT_DATE, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        0, 1, to_char(now(), 'HH24:MI'), $12)`,
    [
      RECEIVE_TRANS_FLAG,
      opts.docNo,
      opts.docRef,
      line.item_code,
      line.item_name,
      line.qty,
      line.unit_code || null,
      line.rack || null,
      line.location || null,
      opts.wh,
      opts.user,
      line.pallet || null,
    ],
  );
}

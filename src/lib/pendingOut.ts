/**
 * ສິນຄ້າຄ້າງຈ່າຍອອກສາງ — outbound documents that still owe stock.
 *
 * A source document (ໃບເບີກ 122 / ໃບໂອນ 124 / ບິນຂາຍ 44) is "ຄ້າງຈ່າຍ" while its
 * ordered qty has not physically left the warehouse. Per item line:
 *
 *   remaining = (qty − cancel_qty)                      ← what the doc asks for
 *             − outbound stock movements for the doc    ← already gone out
 *             − open pick slip (wms_product_out, status 0)  ← reserved, not confirmed
 *
 * MATCHING THE MOVEMENT TO THE SOURCE DOC is the subtle part, and differs by kind:
 *
 *   ບິນຂາຍ 44   the stock movement carries doc_ref = the bill itself (CAK…/CAHAC…)
 *   ໃບຂໍເບີກ 122 the request is fulfilled by an ERP ໃບເບີກ 56 (SWC…) whose doc_ref
 *                is the request; the stock movement then points at the *56*, not
 *                at the 122
 *   ໃບຂໍໂອນ 124 same shape, fulfilled by an ERP ໃບໂອນ 70/72 (FT…)
 *
 * So the netting resolves one hop through those child documents — matching only on
 * the source doc_no (what `/api/movements/issue/source` does) leaves every 122/124
 * looking fully outstanding forever.
 *
 * Movement flags: 2 = the outbound rows the ERP writes (all 223k of them in this
 * database), 72 = the rows the in-app goods-issue screen writes. Both are counted.
 * The +1 leg into in-transit 9903 is excluded so a transfer is not netted twice.
 */
import { query } from "@/lib/db";

/** Source-doc kinds this report covers, in menu order. */
export const PENDING_OUT_TYPES = [
  { key: "req", flag: 122, label: "ໃບເບີກ" },
  { key: "transfer", flag: 124, label: "ໃບໂອນ" },
  { key: "sale", flag: 44, label: "ບິນຂາຍ" },
] as const;

export type PendingOutTypeKey = (typeof PENDING_OUT_TYPES)[number]["key"];

const FLAG_BY_KEY = new Map<string, number>(PENDING_OUT_TYPES.map((t) => [t.key, t.flag]));
export const LABEL_BY_FLAG: Record<number, string> = Object.fromEntries(
  PENDING_OUT_TYPES.map((t) => [t.flag, t.label]),
);

/**
 * ບິນຮັບຄືນ / ຍົກເລີກ — staff mark a dead document by typing a note in
 * `ic_trans.remark_4` (e.g. "cn ຮັບຄືນ", "ລູກຄ້າຍົກເລີກ", "ເປີດບີນຜິດ"). Nothing
 * structural distinguishes them: the header stays trans_flag 44, is_cancel 0,
 * status 0, and the lines keep calc_flag −1 — so without this rule a returned
 * bill sits in the report as ຄ້າງຈ່າຍ forever.
 *
 * Only return/cancel vocabulary is excluded. Other remark_4 notes (ເຄື່ອງໝົດ,
 * ບໍ່ມີເຄື່ອງ) mean the document IS still waiting, so those rows stay and the note
 * is shown on them instead.
 */
export const DEAD_DOC_RE = [
  // ຮັບຄືນ — ລວມຕົວສະກົດ ຄຶນ / ຄື່ນ ທີ່ພົບໃນຂໍ້ມູນຈິງ
  "ຄືນ", "ຄຶນ", "ຄື່ນ",
  // ຍົກເລີກ — ຫຼາຍຕົວສະກົດ (ີ/ິ, ຂາດ ົ)
  "ຍົກເລີກ", "ຍົກເລິກ", "ຍກເລີກ", "ຍກເລິກ",
  // ລູກຄ້າບໍ່ເອົາ / ປ່ຽນເອົາລຸ້ນອື່ນ → ໃບເດີມຕາຍ
  "ບໍ່ເອົາ", "ບໍ່ເອັາ", "ບໍເອົາ", "ປ່ຽນ", "ປຽ່ນ", "ປ໋ຽນ",
  // ເປີດ/ເບີກ/ອອກສາງ ຜິດ ຫຼື ຊ້ຳ
  "ຜິດ", "ຊ້ຳ", "ຊຳກັນ", "ບໍ່ຖືກ", "ອອກໃໝ່", "ເປີດໃຫ່ມ",
  // ພາສາໄທ ທີ່ພະນັກງານພິມປົນ — **ຄຳຄົ້ນ ບໍ່ແມ່ນຂໍ້ຄວາມ UI** ຢ່າແປເປັນລາວ
  "ยกเลิก", "ยๆกเลีก", "ผิด", "ช้ำ", "คืน",
].join("|");

/**
 * ບໍ່ນັບບໍລິການ: ລະຫັດຂຶ້ນຕົ້ນດ້ວຍ 9 (ໝວດບໍລິການ/ຄ່າແຮງ) ແລະ item_type 1 (ບໍລິການ)
 * / 3 (notcount) — ທັງສອງແທບບໍ່ມີ stock ຈິງໃນ WMS ຈຶ່ງບໍ່ມີວັນ "ຈ່າຍອອກ" ໄດ້.
 * Assumes the query aliases ic_trans_detail as `d` and ic_inventory as `inv`.
 */
export const ITEM_EXCLUDE_SQL = `
         AND d.item_code IS NOT NULL AND d.item_code <> ''
         AND d.item_code NOT LIKE '9%'
         AND COALESCE(inv.item_type, 0) NOT IN (1, 3)`;

/**
 * ໃບຮັບຄືນສິນຄ້າ (CN — "ໃບຮັບຄືນສິນຄ້າ/ເພີ່ມໜີ້", doc_format CNK/CNHPB/CNHCE/…).
 * A real ERP document, not a remark: goods the customer sent back, so that qty
 * must never be counted as still owing.
 */
export const RETURN_DOC_FLAG = 48;

/** odg_wms_trans_detail flags that mean "stock left the warehouse". */
export const OUT_MOVE_FLAGS = "2, 72";
/** ic_trans flags of the fulfilment documents raised against a 122 / 124 request. */
export const CHILD_DOC_FLAGS = "56, 70, 72";
export const IN_TRANSIT = "9903";
/** Hard cap so a wide date range can never stream an unbounded result set. */
export const MAX_LINES = 20_000;

/** Parse the `type` query param (csv of keys) into ERP trans_flags. Empty = all. */
export function flagsFromParam(raw: string | null): number[] {
  const keys = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const flags = keys.map((k) => FLAG_BY_KEY.get(k)).filter((f): f is number => f !== undefined);
  return flags.length > 0 ? flags : PENDING_OUT_TYPES.map((t) => t.flag);
}

export type PendingOutLine = {
  doc_no: string;
  trans_flag: number;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  /** Document timestamp (date + time), the anchor the waiting time counts from. */
  doc_ts: string | null;
  want_date: string | null;
  aging_days: number;
  /** Waiting time in seconds — full resolution, for the ຄ້າງ display. */
  aging_seconds: number;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  /** ປະເພດຂົນສົ່ງ from ic_trans_shipment.transport_code → transport_type. */
  transport_code: string | null;
  transport_name: string | null;
  remark: string | null;
  /** ic_trans.remark_4 — ໝາຍເຫດຂອງພະນັກງານ (ເຊັ່ນ ເຄື່ອງໝົດ, ບໍ່ມີເຄື່ອງ). */
  note: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: number;
  issued: number;
  picking: number;
  /** ຈຳນວນທີ່ລູກຄ້າສົ່ງຄືນແລ້ວ (ໃບ CN flag 48) — ບໍ່ຕ້ອງຈ່າຍອອກອີກ. */
  returned: number;
  remaining: number;
};

export type PendingOutFilter = {
  /**
   * The warehouse to report on. Required: the netting joins are only fast enough
   * per warehouse — an all-warehouse run over 90 days does not complete.
   */
  wh: string;
  flags: number[];
  /** Look-back window on the document date, in days. */
  days: number;
};

type Raw = {
  doc_no: string;
  trans_flag: number;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  doc_ts: string | null;
  want_date: string | null;
  aging_days: number | null;
  aging_seconds: string | null;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  /** ປະເພດຂົນສົ່ງ from ic_trans_shipment.transport_code → transport_type. */
  transport_code: string | null;
  transport_name: string | null;
  remark: string | null;
  /** ic_trans.remark_4 — ໝາຍເຫດຂອງພະນັກງານ (ເຊັ່ນ ເຄື່ອງໝົດ, ບໍ່ມີເຄື່ອງ). */
  note: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  issued: string;
  picking: string;
  returned: string;
  remaining: string;
};

const num = (v: string | null) => Math.round((Number.parseFloat(v ?? "") || 0) * 1e6) / 1e6;

/**
 * Every outstanding (document × item) line, oldest document first.
 *
 * Text search is deliberately NOT done here: the caller filters the returned rows,
 * so both the by-document and by-item views stay consistent with one another (a
 * SQL-side item filter would leave document totals showing only the matched lines).
 */
export async function pendingOutLines(f: PendingOutFilter): Promise<PendingOutLine[]> {
  const args: unknown[] = [f.flags, f.days, f.wh, MAX_LINES];

  const rows = await query<Raw>(
    `WITH src AS (
       SELECT d.doc_no, d.trans_flag, d.wh_code, d.item_code,
              MAX(d.item_name) AS item_name,
              MAX(d.unit_code) AS unit_code,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
       WHERE d.trans_flag = ANY($1)
         AND (d.status = 0 OR d.status IS NULL)
         AND d.doc_date >= CURRENT_DATE - $2::int
         AND d.wh_code = $3
         ${ITEM_EXCLUDE_SQL}
       GROUP BY d.doc_no, d.trans_flag, d.wh_code, d.item_code
     ),
     -- ໃບເບີກ/ໃບໂອນ ERP ທີ່ອອກໃຫ້ໃບຂໍ (122/124) — ໃບເຄື່ອນໄຫວ stock ອ້າງອີງໃບນີ້.
     -- DISTINCT ສຳຄັນ: ໃບໂອນ 1 ໃບຖືກບັນທຶກ 2 ແຖວ (flag 70 ຂາອອກ + 72 ຂາເຂົ້າ) ດ້ວຍ
     -- doc_no ດຽວກັນ — ຖ້າບໍ່ dedupe, join ຈະນັບຈຳນວນຈ່າຍອອກເປັນ 2 ເທົ່າ
     child AS (
       SELECT DISTINCT x.doc_no AS child_no, x.doc_ref AS src_no
       FROM public.ic_trans x
       WHERE x.trans_flag IN (${CHILD_DOC_FLAGS})
         AND COALESCE(x.is_cancel, 0) = 0
         AND x.doc_ref IN (SELECT doc_no FROM src)
     ),
     issued AS (
       -- ຂາອອກຈາກຕົ້ນທາງເທົ່ານັ້ນ — ຂາ +1 ເຂົ້າສາງລະຫວ່າງທາງ 9903 ບໍ່ນັບ.
       -- ຈັບຄູ່ໄດ້ 2 ທາງ: doc_ref = ໃບຕົ້ນທາງໂດຍກົງ (ບິນຂາຍ) ຫຼື ຜ່ານໃບລູກ (ເບີກ/ໂອນ).
       SELECT COALESCE(ch.src_no, w.doc_ref) AS doc_no, w.item_code, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       LEFT JOIN child ch ON ch.child_no = w.doc_ref
       WHERE w.trans_flag IN (${OUT_MOVE_FLAGS})
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '${IN_TRANSIT}'
         -- ຈ່າຍອອກບໍ່ເກີດກ່ອນວັນທີ່ໃບ — ຕັດຊ່ວງໃຫ້ query ໄວ
         AND w.doc_date >= CURRENT_DATE - $2::int
         AND (ch.src_no IS NOT NULL OR w.doc_ref IN (SELECT doc_no FROM src))
       GROUP BY 1, w.item_code
     ),
     -- ໃບຮັບຄືນສິນຄ້າ (CN, trans_flag 48): ເຊື່ອມກັບບິນຕົ້ນສະບັບຜ່ານ ref_doc_no
     -- ຂອງ **ແຕ່ລະແຖວ** (header.doc_ref ຫວ່າງເກືອບເຄິ່ງ ຈຶ່ງເຊື່ອຖືບໍ່ໄດ້).
     -- ຈຳນວນທີ່ຮັບຄືນແລ້ວ ບໍ່ຕ້ອງຈ່າຍອອກອີກ ຈຶ່ງຫັກອອກຄືກັບຈ່າຍແລ້ວ.
     returned AS (
       SELECT r.ref_doc_no AS doc_no, r.item_code, SUM(r.qty) AS ret_qty
       FROM public.ic_trans_detail r
       JOIN public.ic_trans rh ON rh.doc_no = r.doc_no AND rh.trans_flag = r.trans_flag
       WHERE r.trans_flag = ${RETURN_DOC_FLAG}
         AND (r.status = 0 OR r.status IS NULL)
         AND COALESCE(rh.is_cancel, 0) = 0
         -- ຮັບຄືນເກີດກ່ອນວັນທີ່ບິນບໍ່ໄດ້ — ຕັດຊ່ວງໃຫ້ query ໄວ (19s → <1s)
         AND r.doc_date >= CURRENT_DATE - $2::int
         AND r.ref_doc_no IN (SELECT doc_no FROM src)
       GROUP BY 1, 2
     ),
     picking AS (
       -- ໃບເກັບສິນຄ້າ (pick) ທີ່ສ້າງແລ້ວ ລໍຖ້າຢືນຢັນ — ຈອງໄວ້ແລ້ວ ຖືວ່າບໍ່ຄ້າງ
       SELECT o.ref_doc_no AS doc_no, d.item_code, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0
         AND o.ref_doc_no IN (SELECT doc_no FROM src)
       GROUP BY o.ref_doc_no, d.item_code
     )
     SELECT s.doc_no, s.trans_flag, s.wh_code,
            w.name_1 AS wh_name,
            to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
            -- ຈຸດເລີ່ມນັບເວລາຄ້າງ: ເວລາສ້າງໃບຈິງ, ຖ້າບໍ່ມີຈຶ່ງໃຊ້ ວັນທີ່ + ເວລາ ໃນໃບ
            to_char(COALESCE(h.create_date_time_now,
                             h.doc_date::timestamp + COALESCE(NULLIF(TRIM(h.doc_time), '')::time, '00:00'::time)),
                    'YYYY-MM-DD HH24:MI:SS') AS doc_ts,
            to_char(h.want_date, 'YYYY-MM-DD') AS want_date,
            (CURRENT_DATE - h.doc_date)::int AS aging_days,
            EXTRACT(EPOCH FROM (now() - COALESCE(h.create_date_time_now,
                             h.doc_date::timestamp + COALESCE(NULLIF(TRIM(h.doc_time), '')::time, '00:00'::time))))::bigint::text AS aging_seconds,
            h.cust_code, cu.name_1 AS cust_name,
            e.fullname_lo AS sale_name,
            NULLIF(TRIM(tr.transport_code), '') AS transport_code,
            tr.transport_name,
            h.remark,
            NULLIF(TRIM(h.remark_4), '') AS note,
            s.item_code, s.item_name, s.unit_code,
            s.src_qty::numeric::text AS ordered,
            COALESCE(i.wms_qty, 0)::numeric::text AS issued,
            COALESCE(p.pend_qty, 0)::numeric::text AS picking,
            COALESCE(rt.ret_qty, 0)::numeric::text AS returned,
            (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(p.pend_qty, 0) - COALESCE(rt.ret_qty, 0))::numeric::text AS remaining
     FROM src s
     JOIN public.ic_trans h ON h.doc_no = s.doc_no AND h.trans_flag = s.trans_flag
     LEFT JOIN issued i  ON i.doc_no = s.doc_no AND i.item_code = s.item_code
     LEFT JOIN picking p ON p.doc_no = s.doc_no AND p.item_code = s.item_code
     LEFT JOIN returned rt ON rt.doc_no = s.doc_no AND rt.item_code = s.item_code
     LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.sale_code
     -- ປະເພດຂົນສົ່ງ: ic_trans.transport_code ຫວ່າງທຸກແຖວ ຈຶ່ງອ່ານຈາກ ic_trans_shipment
     -- (1 ແຖວ/ໃບ) ແລ້ວແປລະຫັດເປັນຊື່ຜ່ານ transport_type
     LEFT JOIN LATERAL (
       SELECT sh.transport_code, tt.name_1 AS transport_name
       FROM public.ic_trans_shipment sh
       LEFT JOIN public.transport_type tt ON tt.code = sh.transport_code
       WHERE sh.doc_no = s.doc_no AND sh.trans_flag = s.trans_flag
       LIMIT 1
     ) tr ON TRUE
     WHERE COALESCE(h.is_cancel, 0) = 0
       -- ບິນຮັບຄືນ / ຍົກເລີກ ບໍ່ແມ່ນຄ້າງຈ່າຍ (ເບິ່ງ DEAD_DOC_RE)
       AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
       AND (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(p.pend_qty, 0) - COALESCE(rt.ret_qty, 0)) > 0.0001
     ORDER BY h.doc_date ASC NULLS LAST, s.doc_no, s.item_code
     LIMIT $4`,
    args,
  );

  return rows.map((r) => ({
    doc_no: r.doc_no,
    trans_flag: r.trans_flag,
    wh_code: r.wh_code,
    wh_name: r.wh_name,
    doc_date: r.doc_date,
    doc_ts: r.doc_ts,
    want_date: r.want_date,
    aging_days: r.aging_days ?? 0,
    aging_seconds: Math.max(0, Number.parseInt(r.aging_seconds ?? "0", 10) || 0),
    cust_code: r.cust_code,
    cust_name: r.cust_name,
    sale_name: r.sale_name,
    transport_code: r.transport_code,
    transport_name: r.transport_name,
    remark: r.remark,
    note: r.note,
    item_code: r.item_code,
    item_name: r.item_name,
    unit_code: r.unit_code,
    ordered: num(r.ordered),
    issued: num(r.issued),
    picking: num(r.picking),
    returned: num(r.returned),
    remaining: num(r.remaining),
  }));
}

/**
 * WMS stock on hand for the given items, within the report's warehouse scope —
 * lets the by-item view say whether the outstanding qty can actually be filled.
 */
export async function itemStockOnHand(
  wh: string,
  itemCodes: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (itemCodes.length === 0) return map;

  // No `status` filter — same rule as the balance page: status=1 marks the
  // outbound leg of an internal relocation, not a void.
  const rows = await query<{ item_code: string; bal: string }>(
    `SELECT t.item_code, SUM(t.qty * t.calc_flag)::numeric::text AS bal
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND t.item_code = ANY($2)
     GROUP BY t.item_code`,
    [wh, itemCodes],
  );
  for (const r of rows) map.set(r.item_code, num(r.bal));
  return map;
}

export type PendingOutDoc = {
  doc_no: string;
  trans_flag: number;
  type_label: string;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  doc_ts: string | null;
  want_date: string | null;
  aging_days: number;
  aging_seconds: number;
  cust_code: string | null;
  cust_name: string | null;
  sale_name: string | null;
  transport_code: string | null;
  transport_name: string | null;
  remark: string | null;
  /** ic_trans.remark_4 — ໝາຍເຫດຂອງພະນັກງານ (ເຊັ່ນ ເຄື່ອງໝົດ, ບໍ່ມີເຄື່ອງ). */
  note: string | null;
  lines: number;
  ordered: number;
  issued: number;
  picking: number;
  returned: number;
  remaining: number;
  /** true once part of the document has already gone out (partial issue). */
  partial: boolean;
};

/** Roll the line rows up to one row per document. */
export function groupByDoc(lines: PendingOutLine[]): PendingOutDoc[] {
  const map = new Map<string, PendingOutDoc>();
  for (const l of lines) {
    const key = `${l.doc_no}|${l.trans_flag}|${l.wh_code}`;
    let d = map.get(key);
    if (!d) {
      d = {
        doc_no: l.doc_no,
        trans_flag: l.trans_flag,
        type_label: LABEL_BY_FLAG[l.trans_flag] ?? String(l.trans_flag),
        wh_code: l.wh_code,
        wh_name: l.wh_name,
        doc_date: l.doc_date,
        doc_ts: l.doc_ts,
        want_date: l.want_date,
        aging_days: l.aging_days,
        aging_seconds: l.aging_seconds,
        cust_code: l.cust_code,
        cust_name: l.cust_name,
        sale_name: l.sale_name,
        transport_code: l.transport_code,
        transport_name: l.transport_name,
        remark: l.remark,
        note: l.note,
        lines: 0,
        ordered: 0,
        issued: 0,
        picking: 0,
        returned: 0,
        remaining: 0,
        partial: false,
      };
      map.set(key, d);
    }
    d.lines += 1;
    d.ordered += l.ordered;
    d.issued += l.issued;
    d.picking += l.picking;
    d.returned += l.returned;
    d.remaining += l.remaining;
  }
  const out = [...map.values()];
  for (const d of out) d.partial = d.issued > 0.0001;
  return out.sort((a, b) => b.aging_days - a.aging_days || a.doc_no.localeCompare(b.doc_no));
}

export type PendingOutItem = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  docs: number;
  remaining: number;
  picking: number;
  /** WMS stock on hand in the report's warehouse scope. */
  on_hand: number;
  /** remaining − on_hand when positive: qty that cannot be filled today. */
  shortfall: number;
  /** Age of the oldest document still waiting on this item. */
  oldest_days: number;
  /** Same, in seconds — for the full-resolution ຄ້າງ display. */
  oldest_seconds: number;
};

/** "12 ມື້ 04:07:33" — waiting time to the second, as the report shows it. */
export function formatWait(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hh = String(Math.floor((s % 86400) / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return days > 0 ? `${days} ມື້ ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

/** Roll the line rows up to one row per item, oldest-waiting first. */
export function groupByItem(
  lines: PendingOutLine[],
  onHand: Map<string, number>,
): PendingOutItem[] {
  const map = new Map<string, PendingOutItem & { _docs: Set<string> }>();
  for (const l of lines) {
    let it = map.get(l.item_code);
    if (!it) {
      it = {
        item_code: l.item_code,
        item_name: l.item_name,
        unit_code: l.unit_code,
        docs: 0,
        remaining: 0,
        picking: 0,
        on_hand: onHand.get(l.item_code) ?? 0,
        shortfall: 0,
        oldest_days: 0,
        oldest_seconds: 0,
        _docs: new Set<string>(),
      };
      map.set(l.item_code, it);
    }
    it._docs.add(`${l.doc_no}|${l.trans_flag}`);
    it.remaining += l.remaining;
    it.picking += l.picking;
    if (l.aging_days > it.oldest_days) it.oldest_days = l.aging_days;
    if (l.aging_seconds > it.oldest_seconds) it.oldest_seconds = l.aging_seconds;
    if (!it.item_name && l.item_name) it.item_name = l.item_name;
  }
  return [...map.values()]
    .map(({ _docs, ...it }) => ({
      ...it,
      docs: _docs.size,
      remaining: Math.round(it.remaining * 1e6) / 1e6,
      shortfall: Math.max(0, Math.round((it.remaining - it.on_hand) * 1e6) / 1e6),
    }))
    .sort((a, b) => b.shortfall - a.shortfall || b.remaining - a.remaining);
}

/** Aging buckets used by both the KPI strip and the clickable filter. */
export const AGING_BUCKETS = [
  { id: "0_7", label: "0–7 ມື້", max: 7 },
  { id: "8_30", label: "8–30 ມື້", max: 30 },
  { id: "31_60", label: "31–60 ມື້", max: 60 },
  { id: "61_90", label: "61–90 ມື້", max: 90 },
  { id: "90p", label: "90+ ມື້", max: Number.POSITIVE_INFINITY },
] as const;

export function bucketOf(days: number): string {
  return (AGING_BUCKETS.find((b) => days <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).id;
}

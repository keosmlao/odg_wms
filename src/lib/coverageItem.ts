/**
 * "ສາງອື່ນມີບໍ?" — ເບິ່ງສິນຄ້າ **ລາຍການດຽວ** ຂ້າມທຸກສາງ.
 *
 * ຄູ່ກັບ `coverage.ts`: ໜ້ານັ້ນຖາມວ່າ "ສາງນີ້ ພຽງພໍບໍ" ຕໍ່ສິນຄ້າທັງໝົດ — ແຕ່ເມື່ອ
 * ເຫັນລາຍການທີ່ **ໝົດ/ວິກິດ** ຢູ່ສາງໜຶ່ງ ຄຳຖາມຕໍ່ໄປທັນທີຄື "ແລ້ວສາງອື່ນມີບໍ,
 * ບ່ອນໃດແບ່ງໄດ້". ໂມດູນນີ້ຕອບຄຳຖາມນັ້ນດ້ວຍຄຳຮ້ອງດຽວ ໄວພໍທີ່ຈະເປີດເບິ່ງໄດ້ຈາກ
 * ໃນຕາຕະລາງເລີຍ.
 *
 * **ກຸນແຈຄວາມໄວ:** `sml_ic_function_stock_balance_warehouse` ຮັບ `item_code_list`
 * ເປັນພາຣາມິເຕີທີ 2. ເອີ້ນທັງສາງ (ບໍ່ກອງລະຫັດ) ໃຊ້ 0.4–6 ວິນາທີ/ສາງ ແຕ່ກອງ
 * **ລະຫັດດຽວ** ຂ້າມ 15 ສາງ ໃຊ້ພຽງ ~60ms — ຈຶ່ງບໍ່ຕ້ອງພຶ່ງ cache ຂອງ coverage
 * ແລະ ບໍ່ຕ້ອງລໍວິເຄາະສາງທີ່ຍັງບໍ່ໄດ້ເປີດເບິ່ງ.
 *
 * ນິຍາມ ຄົງເຫຼືອ / ຂາຍສຸດທິ / ວັນທີ່ພໍໃຊ້ / ສະຖານະ ໃຊ້ຊຸດດຽວກັນກັບ `coverage.ts`
 * ເພື່ອບໍ່ໃຫ້ຕົວເລກສອງໜ້າຂັດກັນເອງ.
 */
import { query } from "@/lib/db";
import { DEAD_DOC_RE, RETURN_DOC_FLAG } from "@/lib/pendingOut";
import { DEFAULT_THRESHOLDS, type CoverageStatus, type Thresholds } from "@/lib/coverage";

const SALE_FLAG = 44;

export type ItemWarehouseRow = {
  wh_code: string;
  wh_name: string | null;
  /** ຄົງເຫຼືອ ERP — ຕົວຕັ້ງດຽວກັນກັບໜ້າ Coverage. */
  on_hand: number;
  /** ຄົງເຫຼືອຕາມບັນຊີ WMS — ໄວ້ທຽບຄວາມສອດຄ່ອງ. */
  wms_on_hand: number;
  avg_cost: number;
  sold: number;
  bills: number;
  last_sale: string | null;
  avg_daily: number;
  days_cover: number | null;
  status: CoverageStatus;
  /**
   * ແບ່ງໃຫ້ສາງອື່ນໄດ້ປະມານເທົ່າໃດ ໂດຍຕົນເອງຍັງພໍໃຊ້ເຖິງຂີດ `low` ວັນ.
   * ສາງທີ່ບໍ່ຂາຍລາຍການນີ້ເລີຍ = ແບ່ງໄດ້ໝົດ.
   */
  spare: number;
};

export type ItemAcrossResult = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  days: number;
  thresholds: Thresholds;
  rows: ItemWarehouseRow[];
};

const num = (v: string | number | null | undefined): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
};

/** ຄົງເຫຼືອ ERP ຂອງລະຫັດດຽວ ຂ້າມສາງ — ກອງທັງລະຫັດ ແລະ ລາຍຊື່ສາງໃນຟັງຊັນເລີຍ. */
const ERP_ITEM_SQL = `
  SELECT NULLIF(TRIM(b.warehouse), '')              AS wh_code,
         NULLIF(TRIM(b.ic_name), '')                AS item_name,
         NULLIF(TRIM(b.ic_unit_code), '')           AS unit_code,
         b.balance_qty::text                        AS on_hand,
         COALESCE(NULLIF(b.average_cost, 0), b.average_cost_end, 0)::text AS avg_cost
  FROM sml_ic_function_stock_balance_warehouse(date(timezone('WAST', now())), $1, $2) b
  WHERE NULLIF(TRIM(b.warehouse), '') IS NOT NULL`;

/** ຍອດຂາຍສຸດທິ (ບິນຂາຍ ຫັກ ໃບຮັບຄືນ) ຂອງລະຫັດດຽວ ແຍກຕາມສາງ. */
const SALES_ITEM_SQL = `
  WITH sales AS (
    SELECT d.wh_code,
           SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS sold,
           count(DISTINCT d.doc_no)                            AS bills,
           MAX(d.doc_date)                                     AS last_sale,
           MAX(d.item_name)                                    AS item_name,
           MAX(d.unit_code)                                    AS unit_code
    FROM public.ic_trans_detail d
    JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
    WHERE d.trans_flag = ${SALE_FLAG}
      AND d.item_code = $1 AND d.wh_code = ANY($2)
      AND d.doc_date >= CURRENT_DATE - $3::int
      AND (d.status = 0 OR d.status IS NULL)
      AND COALESCE(h.is_cancel, 0) = 0
      AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
    GROUP BY 1
  ),
  ret AS (
    SELECT r.wh_code, SUM(r.qty) AS ret_qty
    FROM public.ic_trans_detail r
    JOIN public.ic_trans rh ON rh.doc_no = r.doc_no AND rh.trans_flag = r.trans_flag
    WHERE r.trans_flag = ${RETURN_DOC_FLAG}
      AND r.item_code = $1 AND r.wh_code = ANY($2)
      AND r.doc_date >= CURRENT_DATE - $3::int
      AND (r.status = 0 OR r.status IS NULL)
      AND COALESCE(rh.is_cancel, 0) = 0
    GROUP BY 1
  )
  SELECT s.wh_code,
         GREATEST(s.sold - COALESCE(r.ret_qty, 0), 0)::text AS sold,
         s.bills::int                                       AS bills,
         to_char(s.last_sale, 'YYYY-MM-DD')                 AS last_sale,
         s.item_name, s.unit_code
  FROM sales s
  LEFT JOIN ret r ON r.wh_code = s.wh_code`;

/** ຄົງເຫຼືອ WMS ຂອງລະຫັດດຽວ ແຍກຕາມສາງ (ບໍ່ກອງ status — ເບິ່ງເຫດຜົນໃນ coverage.ts). */
const WMS_ITEM_SQL = `
  SELECT t.wh_code, SUM(t.qty * t.calc_flag)::text AS on_hand
  FROM public.odg_wms_trans_detail t
  WHERE t.item_code = $1 AND t.wh_code = ANY($2)
  GROUP BY 1`;

/**
 * ສິນຄ້າລາຍການດຽວ ຢູ່ທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດ.
 *
 * ຄືນສະເພາະສາງທີ່ **ມີຂອງ ຫຼື ມີການຂາຍ** — ສາງທີ່ບໍ່ກ່ຽວຂ້ອງເລີຍ ບໍ່ຄວນລົກຕາ.
 */
export async function loadItemAcrossWarehouses(
  itemCode: string,
  whCodes: string[],
  days: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Promise<ItemAcrossResult> {
  const span = Math.max(1, days);
  if (whCodes.length === 0) {
    return { item_code: itemCode, item_name: null, unit_code: null, days: span, thresholds, rows: [] };
  }

  const [erp, sales, wms, whNames, master] = await Promise.all([
    query<{ wh_code: string; item_name: string | null; unit_code: string | null; on_hand: string | null; avg_cost: string | null }>(
      ERP_ITEM_SQL,
      [itemCode, whCodes.join(",")],
    ),
    query<{ wh_code: string; sold: string | null; bills: number | null; last_sale: string | null; item_name: string | null; unit_code: string | null }>(
      SALES_ITEM_SQL,
      [itemCode, whCodes, span],
    ),
    query<{ wh_code: string; on_hand: string | null }>(WMS_ITEM_SQL, [itemCode, whCodes]),
    query<{ code: string; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1)`,
      [whCodes],
    ),
    query<{ name: string | null; unit_code: string | null }>(
      `SELECT name_1 AS name, NULLIF(TRIM(unit_standard), '') AS unit_code FROM public.ic_inventory WHERE code = $1`,
      [itemCode],
    ),
  ]);

  type Acc = { on_hand: number; wms_on_hand: number; avg_cost: number; sold: number; bills: number; last_sale: string | null };
  const acc = new Map<string, Acc>();
  const at = (wh: string): Acc => {
    let r = acc.get(wh);
    if (!r) { r = { on_hand: 0, wms_on_hand: 0, avg_cost: 0, sold: 0, bills: 0, last_sale: null }; acc.set(wh, r); }
    return r;
  };

  let itemName: string | null = master[0]?.name ?? null;
  let unitCode: string | null = null;

  for (const e of erp) {
    const r = at(e.wh_code);
    r.on_hand = num(e.on_hand);
    r.avg_cost = Math.max(0, num(e.avg_cost));
    itemName ??= e.item_name;
    unitCode ??= e.unit_code;
  }
  for (const s of sales) {
    const r = at(s.wh_code);
    r.sold = num(s.sold);
    r.bills = s.bills ?? 0;
    r.last_sale = s.last_sale;
    itemName ??= s.item_name;
    unitCode ??= s.unit_code;
  }
  for (const w of wms) {
    const qty = num(w.on_hand);
    if (qty === 0 && !acc.has(w.wh_code)) continue;
    at(w.wh_code).wms_on_hand = qty;
  }

  const nameOf = new Map(whNames.map((w) => [w.code, w.name]));

  const rows: ItemWarehouseRow[] = [...acc.entries()]
    .filter(([, r]) => r.on_hand !== 0 || r.wms_on_hand !== 0 || r.sold > 0)
    .map(([wh_code, r]) => {
      const avg_daily = Math.round((r.sold / span) * 1e6) / 1e6;
      const days_cover = avg_daily > 0 ? Math.round((r.on_hand / avg_daily) * 10) / 10 : null;

      // ຊຸດກົດດຽວກັນກັບ computeItems() ໃນ coverage.ts
      let status: CoverageStatus;
      if (r.on_hand < 0) status = "negative";
      else if (avg_daily <= 0) status = r.on_hand > 0 ? "idle" : "ok";
      else if (r.on_hand <= 0) status = "out";
      else if ((days_cover as number) < thresholds.critical) status = "critical";
      else if ((days_cover as number) < thresholds.low) status = "low";
      else if ((days_cover as number) > thresholds.over) status = "over";
      else status = "ok";

      // ເຫຼືອໄວ້ໃຫ້ຕົນເອງເຖິງຂີດ `low` ວັນ ຄືກັນກັບ keep_days ຂອງໜ້າຂໍ້ສະເໜີການໂອນ
      const keep = avg_daily * thresholds.low;
      const spare = Math.max(0, Math.round((r.on_hand - keep) * 100) / 100);

      return {
        wh_code,
        wh_name: nameOf.get(wh_code) ?? null,
        on_hand: Math.round(r.on_hand * 100) / 100,
        wms_on_hand: Math.round(r.wms_on_hand * 100) / 100,
        avg_cost: Math.round(r.avg_cost * 100) / 100,
        sold: Math.round(r.sold * 100) / 100,
        bills: r.bills,
        last_sale: r.last_sale,
        avg_daily,
        days_cover,
        status,
        spare,
      };
    })
    .sort((a, b) => b.spare - a.spare || b.on_hand - a.on_hand || a.wh_code.localeCompare(b.wh_code));

  return {
    item_code: itemCode,
    item_name: itemName,
    unit_code: unitCode ?? master[0]?.unit_code ?? null,
    days: span,
    thresholds,
    rows,
  };
}

/**
 * ລາຍງານການເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ —
 *
 *     ຍອດຍົກມາ + ເຂົ້າ − ອອກ = ຄົງເຫຼືອ     (ຕໍ່ 1 ສິນຄ້າ ໃນ 1 ສາງ ໃນ 1 ເດືອນ)
 *
 * ເປັນ "ບັດສິນຄ້າ" ຂອງເດືອນ: ໜຶ່ງແຖວຕໍ່ໜຶ່ງລາຍການສິນຄ້າ ພ້ອມ ຍີ່ຫໍ້ ແລະ ຫົວໜ່ວຍ.
 * ໜ້າ /movements/daily ຕອບວ່າ "ມື້ໃດເຄື່ອນໄຫວຫຼາຍ", ໜ້ານີ້ຕອບວ່າ "ສິນຄ້າໃດ
 * ເຄື່ອນໄຫວຫຼາຍ ແລະ ທ້າຍເດືອນເຫຼືອເທົ່າໃດ".
 *
 * ການຍ້າຍພາຍໃນສາງບໍ່ແມ່ນການເຄື່ອນໄຫວ — ກົດດຽວກັນກັບ `dailyMovement.ts`:
 * trans_flag 77 (ຍ້າຍບ່ອນເກັບ) ຂຽນຄູ່ ±1 ໃນສາງດຽວກັນສະເໝີ, flag 99 ບາງເທື່ອກໍ່ຄື
 * ກັນ — ຖ້ານັບຈະເຮັດໃຫ້ ເຂົ້າ ແລະ ອອກ ບວມທັງສອງຂາ ທັ້ງທີ່ຍອດສາງບໍ່ປ່ຽນ. 77 ຕັດ
 * ອອກເລີຍ, ສ່ວນ 99 ຕັດສະເພາະຄູ່ທີ່ທັງສອງຂາຢູ່ສາງນີ້.
 *
 * ຍ້ອນຄູ່ຍ້າຍພາຍໃນນັ້ນສຸດທິເປັນ 0 ຢູ່ແລ້ວ ຄົງເຫຼືອຈຶ່ງຄິດຈາກ SUM(qty × calc_flag)
 * ທັງໝົດເຖິງທ້າຍເດືອນ ໂດຍບໍ່ຕ້ອງກອງ — ແລະ ສົມຜົນ ຍົກມາ+ເຂົ້າ−ອອກ=ຄົງເຫຼືອ ຍັງລົງ.
 *
 * ບໍ່ກັ່ນຕອງ `status`: ໃນ odg_wms_trans_detail status=1 ບໍ່ແມ່ນ "ຍົກເລີກ" (ເບິ່ງ
 * ໝາຍເຫດໃນ `locationMovement.ts`).
 */
import { query } from "@/lib/db";

export type MonthItemRow = {
  item_code: string;
  item_name: string | null;
  /** ຍີ່ຫໍ້ — ic_brand.name_1 ຖ້າມີ, ບໍ່ດັ່ງນັ້ນເອົາ ic_inventory.item_brand ດິບ. */
  brand: string | null;
  unit_code: string | null;
  /** ຍອດຍົກມາ — ຄົງເຫຼືອກ່ອນວັນທຳອິດຂອງເດືອນ. */
  opening: number;
  qty_in: number;
  qty_out: number;
  /** ຄົງເຫຼືອ = ຍອດຍົກມາ + ເຂົ້າ − ອອກ. */
  closing: number;
  /** ຈຳນວນເອກະສານທີ່ແຕະສິນຄ້ານີ້ໃນເດືອນ (ບໍ່ນັບການຍ້າຍພາຍໃນສາງ). */
  docs: number;
};

export type MonthTotals = {
  items: number;
  opening: number;
  qty_in: number;
  qty_out: number;
  closing: number;
};

export type MonthFilter = {
  wh: string;
  /** ເດືອນລາຍງານ ຮູບແບບ YYYY-MM. */
  month: string;
  /** ເອົາສິນຄ້າທີ່ບໍ່ເຄື່ອນໄຫວໃນເດືອນ (ມີແຕ່ຍອດຄ້າງ) ມານຳບໍ. */
  includeIdle: boolean;
};

/** ສິນຄ້າຫຼາຍກວ່ານີ້ໃນໃບດຽວ ອ່ານບໍ່ໄຫວຢູ່ແລ້ວ — ກັນ payload ໃຫຍ່ເກີນ. */
export const MAX_ITEMS = 5000;

const num = (v: string | null | undefined) => Math.round((Number.parseFloat(v ?? "") || 0) * 1e6) / 1e6;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export function isMonth(s: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** ວັນທຳອິດ ແລະ ວັນສຸດທ້າຍຂອງເດືອນ (YYYY-MM-DD). */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** ຊື່ເດືອນລາວ ສຳລັບຫົວລາຍງານ. */
export const MONTH_LO = [
  "ມັງກອນ", "ກຸມພາ", "ມີນາ", "ເມສາ", "ພຶດສະພາ", "ມິຖຸນາ",
  "ກໍລະກົດ", "ສິງຫາ", "ກັນຍາ", "ຕຸລາ", "ພະຈິກ", "ທັນວາ",
];

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_LO[m - 1] ?? m} ${y}`;
}

/** ໜຶ່ງແຖວຕໍ່ໜຶ່ງສິນຄ້າ — ຫົວໃຈຂອງລາຍງານ. */
export async function monthlyItems(f: MonthFilter): Promise<MonthItemRow[]> {
  const { from, to } = monthRange(f.month);
  const rows = await query<{
    item_code: string; item_name: string | null; brand: string | null; unit_code: string | null;
    opening: string; qty_in: string; qty_out: string; closing: string; docs: number;
  }>(
    `WITH reloc AS (
       -- flag 99 ທີ່ມີທັງຂາເຂົ້າ ແລະ ຂາອອກ ໃນສາງດຽວກັນ = ຍ້າຍພາຍໃນ ບໍ່ນັບ
       SELECT doc_no, item_code
       FROM public.odg_wms_trans_detail
       WHERE trans_flag = 99 AND wh_code = $1 AND doc_date >= $2 AND doc_date <= $3
       GROUP BY doc_no, item_code
       HAVING count(*) FILTER (WHERE calc_flag = 1) > 0
          AND count(*) FILTER (WHERE calc_flag = -1) > 0
     ),
     base AS (
       SELECT t.item_code, t.item_name, t.unit_code, t.qty, t.calc_flag, t.doc_date, t.doc_no,
              (t.trans_flag = 77 OR r.doc_no IS NOT NULL) AS is_reloc
       FROM public.odg_wms_trans_detail t
       LEFT JOIN reloc r ON r.doc_no = t.doc_no AND r.item_code = t.item_code AND t.trans_flag = 99
       WHERE t.wh_code = $1 AND t.doc_date <= $3
         AND t.item_code IS NOT NULL AND t.item_code <> ''
     ),
     agg AS (
       SELECT item_code,
              MAX(item_name) FILTER (WHERE NULLIF(TRIM(item_name), '') IS NOT NULL) AS wms_name,
              MAX(unit_code) FILTER (WHERE NULLIF(TRIM(unit_code), '') IS NOT NULL) AS wms_unit,
              COALESCE(SUM(qty * calc_flag) FILTER (WHERE doc_date < $2), 0)                          AS opening,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = 1 AND NOT is_reloc), 0)  AS qty_in,
              COALESCE(SUM(qty) FILTER (WHERE doc_date >= $2 AND calc_flag = -1 AND NOT is_reloc), 0) AS qty_out,
              COALESCE(SUM(qty * calc_flag), 0)                                                       AS closing,
              count(DISTINCT doc_no) FILTER (WHERE doc_date >= $2 AND NOT is_reloc)::int              AS docs
       FROM base
       GROUP BY item_code
     )
     SELECT a.item_code,
            COALESCE(NULLIF(TRIM(inv.name_1), ''), a.wms_name)                     AS item_name,
            COALESCE(NULLIF(TRIM(br.name_1), ''), NULLIF(TRIM(inv.item_brand), '')) AS brand,
            COALESCE(NULLIF(TRIM(inv.unit_standard), ''), a.wms_unit)              AS unit_code,
            a.opening::numeric::text  AS opening,
            a.qty_in::numeric::text   AS qty_in,
            a.qty_out::numeric::text  AS qty_out,
            a.closing::numeric::text  AS closing,
            a.docs
     FROM agg a
     LEFT JOIN public.ic_inventory inv ON inv.code = a.item_code
     LEFT JOIN public.ic_brand br      ON br.code  = inv.item_brand
     WHERE a.qty_in <> 0 OR a.qty_out <> 0
        ${f.includeIdle ? "OR a.opening <> 0 OR a.closing <> 0" : ""}
     ORDER BY (a.qty_in + a.qty_out) DESC, a.closing DESC, a.item_code
     LIMIT ${MAX_ITEMS}`,
    [f.wh, from, to],
  );

  return rows.map((r) => ({
    item_code: r.item_code,
    item_name: r.item_name,
    brand: r.brand,
    unit_code: r.unit_code,
    opening: num(r.opening),
    qty_in: num(r.qty_in),
    qty_out: num(r.qty_out),
    closing: num(r.closing),
    docs: r.docs,
  }));
}

export function monthTotals(rows: MonthItemRow[]): MonthTotals {
  return {
    items: rows.length,
    opening: round(rows.reduce((s, r) => s + r.opening, 0)),
    qty_in: round(rows.reduce((s, r) => s + r.qty_in, 0)),
    qty_out: round(rows.reduce((s, r) => s + r.qty_out, 0)),
    closing: round(rows.reduce((s, r) => s + r.closing, 0)),
  };
}

/**
 * ກອງດ້ວຍຄຳຄົ້ນ ແລະ ຍີ່ຫໍ້ — ໃຊ້ຮ່ວມກັນລະຫວ່າງ Excel ແລະ ໜ້າພິມ ເພື່ອໃຫ້ໄດ້
 * ຊຸດແຖວດຽວກັນກັບທີ່ຜູ້ໃຊ້ເຫັນຢູ່ໜ້າຈໍ.
 */
export function filterRows(rows: MonthItemRow[], q: string, brand: string): MonthItemRow[] {
  const needle = q.trim().toLowerCase();
  const b = brand.trim();
  return rows.filter(
    (r) =>
      (!b || (r.brand ?? "") === b) &&
      (!needle || `${r.item_code} ${r.item_name ?? ""} ${r.brand ?? ""}`.toLowerCase().includes(needle)),
  );
}

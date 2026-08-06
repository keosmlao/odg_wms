import { query } from "@/lib/db";
import { DEAD_DOC_RE } from "@/lib/pendingOut";

/**
 * ໃບຈັດຖ້ຽວ (TMS trip sheet) → ໃບສັ່ງຈ່າຍ (pick slip).
 *
 * ຂົນສົ່ງຈັດຖ້ຽວໃນລະບົບ TMS:
 *   odg_tms              — ຫົວໃບຈັດຖ້ຽວ (1 ຖ້ຽວ = 1 ລົດ + 1 ຄົນຂັບ + ຮອບ/ສາຍ)
 *   odg_tms_detail       — ບິນທີ່ຂຶ້ນລົດຄັນນີ້ (bill_no = ic_trans.doc_no, trans_flag 44)
 *   odg_tms_detail_item  — ລາຍການ + `selected_qty` = ຈຳນວນທີ່ຂຶ້ນລົດຖ້ຽວນີ້ຈິງ
 *                          (1 ບິນ ອາດແບ່ງຂຶ້ນຫຼາຍຖ້ຽວ — ຂໍ້ມູນຈິງມີກໍລະນີແບບນີ້)
 *
 * ຝັ່ງ WMS: ໃບ pick (wms_product_out) ຍັງເປັນ 1 ໃບ / 1 ບິນ ຄືເກົ່າ, ເພາະ
 * `ref_doc_no` ຂອງມັນຄືຕົວທີ່ໃຊ້ຫັກຄ້າງຈ່າຍ ແລະ post ເຂົ້າ ERP ຕອນຢືນຢັນ.
 * ຖ້ຽວຖືກເກັບແຍກໄວ້ໃນ `wms_pick_trip` (migration 031) ເປັນຕົວມັດໃບ pick
 * ຫຼາຍໃບເຂົ້າກັນ.
 *
 * ຍອດທີ່ "ຕ້ອງຈ່າຍ" ຕໍ່ (ບິນ, ສິນຄ້າ) =
 *   min( ຈຳນວນທີ່ຖ້ຽວນີ້ຂົນ , ຍອດຄ້າງຈ່າຍຂອງບິນ )
 * ໂດຍຍອດຄ້າງຈ່າຍ = qty ໃນບິນ − ທີ່ WMS ຈ່າຍໄປແລ້ວ − ທີ່ຄ້າງຢູ່ໃນໃບ pick ອື່ນ
 * (ສູດດຽວກັນກັບໜ້າ ບິນຂາຍ ໃນ /api/movements/issue/pending).
 */

export const SALE_FLAG = 44;
/** odg_wms_trans_detail flag ທີ່ຂາອອກຂອງ WMS ຂຽນລົງ (ຄືກັບ issue route). */
export const ISSUE_STOCK_FLAG = 72;

/**
 * odg_tms.job_status — 0 ຮ່າງ/ລໍອະນຸມັດ, 1 ອະນຸມັດແລ້ວ (ຍັງບໍ່ອອກລົດ),
 * 2 ອອກລົດແລ້ວ, 3 ສົ່ງຈົບ, 4 ປິດວຽກ. ຕົວທີ່ບອກ "ເລີ່ມຈັດສົ່ງແລ້ວ" ແທ້ໆ ຄື
 * `dispatch_started_at` (ຂໍ້ມູນຈິງ: NULL ສະເພາະ job_status 0/1 ເທົ່ານັ້ນ).
 */
export const TRIP_JOB_STATUS_LABEL: Record<number, string> = {
  0: "ລໍຖ້າອະນຸມັດ",
  1: "ພ້ອມຈັດ (ຍັງບໍ່ອອກລົດ)",
  2: "ອອກລົດແລ້ວ",
  3: "ສົ່ງຈົບແລ້ວ",
  4: "ປິດວຽກແລ້ວ",
};

export type TripBill = {
  bill_no: string;
  bill_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  /** ຍອດທີ່ຖ້ຽວນີ້ຕ້ອງຈ່າຍອອກ (ຫັກທີ່ຈ່າຍແລ້ວ ແລະ ທີ່ຢູ່ໃນໃບ pick ອື່ນແລ້ວ). */
  need_qty: string;
  /** ຈຳນວນທີ່ຖ້ຽວນີ້ວາງແຜນຂົນ (odg_tms_detail_item.selected_qty). */
  trip_qty: string;
  /** ຄ້າງຈ່າຍທັງບິນ (ບໍ່ຈຳກັດສະເພາະຖ້ຽວນີ້). */
  remaining_qty: string;
  /** ຢູ່ໃນໃບ pick ທີ່ຍັງບໍ່ໄດ້ຢືນຢັນ. */
  pending_qty: string;
  line_count: number;
  /** ໃບ pick ທີ່ອອກຈາກຖ້ຽວນີ້ໃຫ້ບິນນີ້ແລ້ວ (ຍັງບໍ່ຢືນຢັນ ຫຼື ຢືນຢັນແລ້ວ). */
  picks: string[];
};

export type TripRow = {
  doc_no: string;
  doc_date: string | null;
  date_logistic: string | null;
  car: string | null;
  car_name: string | null;
  driver: string | null;
  driver_name: string | null;
  route_code: string | null;
  route_name: string | null;
  round_code: string | null;
  round_name: string | null;
  round_time: string | null;
  approve_status: number | null;
  job_status: number | null;
  job_close: string | null;
  /** ເວລາທີ່ຂົນສົ່ງກົດ "ເລີ່ມຈັດສົ່ງ" — null = ຍັງບໍ່ອອກລົດ. */
  dispatch_started_at: string | null;
  created_at: string | null;
  bills_total: number;
  bills_pending: number;
  need_qty: string;
  pending_qty: string;
  /** ໃບ pick ທີ່ອອກຈາກຖ້ຽວນີ້ແລ້ວ (ທຸກບິນ). */
  picks: number;
  bills: TripBill[];
};

/** ຕົວກອງ + ຂໍ້ຄວາມຄົ້ນຫາ (ເລກຖ້ຽວ / ລົດ / ຄົນຂັບ / ເລກບິນ / ລູກຄ້າ). */
export type TripListArgs = {
  wh: string;
  q?: string;
  days?: number;
  limit?: number;
  /** true = ເອົາສະເພາະຖ້ຽວທີ່ຍັງມີຂອງຄ້າງຈ່າຍ (ຄ່າເລີ່ມຕົ້ນ). */
  onlyPending?: boolean;
  /** true = ເອົາສະເພາະຖ້ຽວທີ່ຍັງບໍ່ທັນເລີ່ມຈັດສົ່ງ (ຍັງບໍ່ອອກລົດ) — ຄ່າເລີ່ມຕົ້ນ. */
  onlyNotStarted?: boolean;
};

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * SQL ກາງ: ຕໍ່ (ຖ້ຽວ, ບິນ, ສິນຄ້າ) ໃນສາງ `$1` ພ້ອມຍອດ need/remaining.
 * ໃຊ້ຮ່ວມກັນທັງລາຍການຖ້ຽວ ແລະ ລາຍລະອຽດຖ້ຽວ ເພື່ອບໍ່ໃຫ້ສູດຄິດຍອດແຕກກັນ.
 *
 * Placeholders: $1 = wh_code, $2 = trip filter SQL fragment's params follow.
 */
const NEED_CTE = (tripFilterSql: string) => `
  trip AS (
    SELECT t.doc_no, t.doc_date, t.date_logistic, t.car, t.driver,
           t.approve_status, t.job_status, t.job_close, t.dispatch_started_at,
           t.delivery_round_code, t.delivery_route_code, t.create_date_time_now
    FROM public.odg_tms t
    WHERE ${tripFilterSql}
  ),
  tms_bill AS (
    SELECT DISTINCT d.doc_no AS trip_no, d.bill_no
    FROM public.odg_tms_detail d
    JOIN trip tr ON tr.doc_no = d.doc_no
    WHERE COALESCE(NULLIF(TRIM(d.bill_no), ''), '') <> ''
  ),
  -- ຈຳນວນທີ່ຖ້ຽວນີ້ວາງແຜນຂົນ ຕໍ່ (ບິນ, ສິນຄ້າ)
  tms_item AS (
    SELECT i.doc_no AS trip_no, i.bill_no, i.item_code,
           SUM(COALESCE(NULLIF(i.selected_qty, 0), i.qty, 0)) AS trip_qty
    FROM public.odg_tms_detail_item i
    JOIN trip tr ON tr.doc_no = i.doc_no
    WHERE COALESCE(NULLIF(TRIM(i.bill_no), ''), '') <> ''
    GROUP BY i.doc_no, i.bill_no, i.item_code
  ),
  -- ບິນທີ່ TMS ບອກລາຍການມາ (ຖ້າບໍ່ມີເລີຍ → fallback ໃຊ້ຍອດຄ້າງທັງບິນ)
  tms_item_bill AS (
    SELECT DISTINCT trip_no, bill_no FROM tms_item
  ),
  -- ຍອດຕາມບິນຂາຍໃນສາງນີ້
  src AS (
    SELECT b.bill_no, d.item_code,
           MAX(d.item_name) AS item_name,
           MAX(d.unit_code) AS unit_code,
           SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
    FROM (SELECT DISTINCT bill_no FROM tms_bill) b
    JOIN public.ic_trans_detail d
      ON d.doc_no = b.bill_no AND d.trans_flag = ${SALE_FLAG} AND d.wh_code = $1
    WHERE (d.status = 0 OR d.status IS NULL)
      AND d.item_code NOT LIKE '97%'   -- ໝວດ 97 ບໍ່ຈ່າຍອອກສາງ
    GROUP BY b.bill_no, d.item_code
  ),
  issued AS (
    SELECT w.doc_ref AS bill_no, w.item_code, SUM(w.qty) AS wms_qty
    FROM public.odg_wms_trans_detail w
    WHERE w.trans_flag = ${ISSUE_STOCK_FLAG}
      AND (w.status = 0 OR w.status IS NULL)
      AND w.calc_flag = -1 AND w.wh_code <> '9903'
      AND w.doc_ref IN (SELECT bill_no FROM src)
    GROUP BY w.doc_ref, w.item_code
  ),
  -- ໃບ pick ທີ່ຄ້າງຢືນຢັນ. ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) ເກັບບິນໄວ້ລະດັບແຖວ.
  pend AS (
    SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS bill_no, d.item_code, SUM(d.qty) AS pend_qty
    FROM public.wms_product_out o
    JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
    WHERE COALESCE(o.status, 0) = 0
      AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) IN (SELECT bill_no FROM src)
    GROUP BY 1, d.item_code
  ),
  -- ບິນທີ່ຍັງມີຊີວິດ (ບໍ່ຍົກເລີກ / ບໍ່ແມ່ນໃບຮັບຄືນ)
  live_bill AS (
    SELECT h.doc_no AS bill_no, h.doc_date, h.cust_code, h.remark, cu.name_1 AS cust_name
    FROM public.ic_trans h
    LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
    WHERE h.trans_flag = ${SALE_FLAG}
      AND h.doc_no IN (SELECT bill_no FROM src)
      AND COALESCE(h.is_cancel, 0) = 0
      AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
  ),
  need AS (
    SELECT tb.trip_no, s.bill_no, s.item_code, s.item_name, s.unit_code,
           s.src_qty,
           COALESCE(ti.trip_qty, 0) AS trip_qty,
           COALESCE(i.wms_qty, 0) AS issued_qty,
           COALESCE(p.pend_qty, 0) AS pending_qty,
           GREATEST(s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(p.pend_qty, 0), 0) AS remaining,
           -- ຖ້າ TMS ບອກລາຍການຂອງບິນນີ້ມາ → ຈ່າຍພຽງເທົ່າທີ່ຖ້ຽວນີ້ຂົນ
           LEAST(
             GREATEST(s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(p.pend_qty, 0), 0),
             CASE WHEN tib.bill_no IS NULL
                  THEN GREATEST(s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(p.pend_qty, 0), 0)
                  ELSE COALESCE(ti.trip_qty, 0) END
           ) AS need_qty
    FROM tms_bill tb
    JOIN src s ON s.bill_no = tb.bill_no
    JOIN live_bill lb ON lb.bill_no = s.bill_no
    LEFT JOIN tms_item ti ON ti.trip_no = tb.trip_no AND ti.bill_no = s.bill_no AND ti.item_code = s.item_code
    LEFT JOIN tms_item_bill tib ON tib.trip_no = tb.trip_no AND tib.bill_no = s.bill_no
    LEFT JOIN issued i ON i.bill_no = s.bill_no AND i.item_code = s.item_code
    LEFT JOIN pend p ON p.bill_no = s.bill_no AND p.item_code = s.item_code
  )`;

/** ລາຍການໃບຈັດຖ້ຽວ ທີ່ຍັງມີສິນຄ້າຄ້າງຈ່າຍໃນສາງນີ້. */
export async function listTrips(a: TripListArgs): Promise<TripRow[]> {
  const days = Math.min(Math.max(a.days ?? 14, 1), 365);
  const limit = Math.min(Math.max(a.limit ?? 40, 1), 200);
  const q = (a.q ?? "").trim();
  const onlyPending = a.onlyPending !== false;
  // ຄ່າເລີ່ມຕົ້ນ: ສະແດງສະເພາະຖ້ຽວທີ່ຍັງບໍ່ທັນອອກລົດ — ຖ້ຽວທີ່ອອກໄປແລ້ວ
  // ເກັບເຄື່ອງໃສ່ບໍ່ໄດ້ອີກ, ຂຶ້ນມາໃນລາຍການມີແຕ່ເຮັດໃຫ້ຍິບຜິດໃບ.
  const notStartedSql = a.onlyNotStarted === false
    ? ""
    : " AND t.dispatch_started_at IS NULL AND t.job_close IS NULL AND COALESCE(t.job_status, 0) < 2";

  // $1 = wh, $2 = days, $3 = q (ອາດບໍ່ມີ), ສຸດທ້າຍ = limit
  const args: unknown[] = [a.wh, days];
  let searchJoin = "";
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    const i = args.length;
    searchJoin = `
      AND (t.doc_no ILIKE $${i} ESCAPE '\\'
        OR t.car ILIKE $${i} ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM public.odg_tms_car c
                    WHERE c.code = t.car AND (c.name_1 ILIKE $${i} ESCAPE '\\' OR c.plate_no ILIKE $${i} ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM public.odg_tms_driver dr
                    WHERE dr.code = t.driver AND dr.name_1 ILIKE $${i} ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM public.odg_tms_detail td
                    WHERE td.doc_no = t.doc_no AND td.bill_no ILIKE $${i} ESCAPE '\\'))`;
  }
  args.push(limit);
  const limitIdx = args.length;

  const rows = await query<TripRow & { bills_json: TripBill[] | null }>(
    `WITH ${NEED_CTE(`t.doc_date >= CURRENT_DATE - $2::int${notStartedSql} ${searchJoin}`)},
     bill_roll AS (
       SELECT n.trip_no, n.bill_no,
              SUM(n.need_qty) AS need_qty,
              SUM(n.trip_qty) AS trip_qty,
              SUM(n.remaining) AS remaining_qty,
              SUM(n.pending_qty) AS pending_qty,
              count(*) FILTER (WHERE n.need_qty > 0.0001)::int AS line_count
       FROM need n
       GROUP BY n.trip_no, n.bill_no
     )
     SELECT tr.doc_no,
            to_char(tr.doc_date, 'YYYY-MM-DD') AS doc_date,
            to_char(tr.date_logistic, 'YYYY-MM-DD') AS date_logistic,
            tr.car, ca.name_1 AS car_name,
            tr.driver, dv.name_1 AS driver_name,
            tr.delivery_route_code AS route_code, rt.name AS route_name,
            tr.delivery_round_code AS round_code, rd.name AS round_name, rd.time_label AS round_time,
            tr.approve_status, tr.job_status,
            to_char(tr.job_close, 'YYYY-MM-DD HH24:MI') AS job_close,
            to_char(tr.dispatch_started_at, 'YYYY-MM-DD HH24:MI') AS dispatch_started_at,
            to_char(tr.create_date_time_now, 'YYYY-MM-DD HH24:MI:SS') AS created_at,
            count(*)::int AS bills_total,
            count(*) FILTER (WHERE br.need_qty > 0.0001)::int AS bills_pending,
            SUM(br.need_qty)::numeric::text AS need_qty,
            SUM(br.pending_qty)::numeric::text AS pending_qty,
            (SELECT count(*)::int FROM public.wms_pick_trip pt WHERE pt.trip_doc_no = tr.doc_no) AS picks,
            COALESCE(jsonb_agg(
              jsonb_build_object(
                'bill_no', br.bill_no,
                'bill_date', to_char(lb.doc_date, 'YYYY-MM-DD'),
                'cust_code', lb.cust_code,
                'cust_name', lb.cust_name,
                'need_qty', br.need_qty::numeric::text,
                'trip_qty', br.trip_qty::numeric::text,
                'remaining_qty', br.remaining_qty::numeric::text,
                'pending_qty', br.pending_qty::numeric::text,
                'line_count', br.line_count,
                'picks', COALESCE((SELECT jsonb_agg(DISTINCT pt.doc_no)
                                   FROM public.wms_pick_trip pt
                                   JOIN public.wms_product_out po ON po.doc_no = pt.doc_no
                                   LEFT JOIN public.wms_product_out_detail pd ON pd.doc_no = pt.doc_no
                                   WHERE pt.trip_doc_no = tr.doc_no
                                     AND COALESCE(NULLIF(TRIM(pd.ref_doc_no), ''), po.ref_doc_no, pt.bill_no) = br.bill_no), '[]'::jsonb)
              ) ORDER BY br.need_qty DESC, br.bill_no
            ), '[]'::jsonb) AS bills_json
     FROM trip tr
     JOIN bill_roll br ON br.trip_no = tr.doc_no
     LEFT JOIN live_bill lb ON lb.bill_no = br.bill_no
     LEFT JOIN public.odg_tms_car ca ON ca.code = tr.car
     LEFT JOIN public.odg_tms_driver dv ON dv.code = tr.driver
     LEFT JOIN public.odg_tms_delivery_route rt ON rt.code = tr.delivery_route_code
     LEFT JOIN public.odg_tms_delivery_round rd ON rd.code = tr.delivery_round_code
     GROUP BY tr.doc_no, tr.doc_date, tr.date_logistic, tr.car, ca.name_1, tr.driver, dv.name_1,
              tr.delivery_route_code, rt.name, tr.delivery_round_code, rd.name, rd.time_label,
              tr.approve_status, tr.job_status, tr.job_close, tr.dispatch_started_at, tr.create_date_time_now
     ${onlyPending ? "HAVING SUM(br.need_qty) > 0.0001" : ""}
     ORDER BY tr.doc_date DESC, tr.doc_no DESC
     LIMIT $${limitIdx}`,
    args,
  );

  return rows.map(({ bills_json, ...r }) => ({
    ...r,
    bills: (bills_json ?? []).filter((b) => Number.parseFloat(b.need_qty) > 0.0001 || Number.parseFloat(b.pending_qty) > 0.0001),
  }));
}

export type TripNeedLine = {
  bill_no: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  need_qty: number;
  trip_qty: number;
  remaining: number;
};

/** ຍອດທີ່ຕ້ອງຈ່າຍ ຕໍ່ (ບິນ, ສິນຄ້າ) ຂອງ 1 ຖ້ຽວ — ໃຊ້ທັງຕອນສະແດງ ແລະ ຕອນສ້າງໃບ. */
export async function tripNeedLines(wh: string, tripNo: string): Promise<TripNeedLine[]> {
  const rows = await query<{
    bill_no: string;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    need_qty: string;
    trip_qty: string;
    remaining: string;
  }>(
    `WITH ${NEED_CTE("t.doc_no = $2")}
     SELECT n.bill_no, n.item_code, n.item_name, n.unit_code,
            n.need_qty::numeric::text AS need_qty,
            n.trip_qty::numeric::text AS trip_qty,
            n.remaining::numeric::text AS remaining
     FROM need n
     WHERE n.need_qty > 0.0001
     ORDER BY n.item_code, n.bill_no`,
    [wh, tripNo],
  );
  return rows.map((r) => ({
    bill_no: r.bill_no,
    item_code: r.item_code,
    item_name: r.item_name,
    unit_code: r.unit_code,
    need_qty: Number.parseFloat(r.need_qty) || 0,
    trip_qty: Number.parseFloat(r.trip_qty) || 0,
    remaining: Number.parseFloat(r.remaining) || 0,
  }));
}

export type TripHeader = {
  doc_no: string;
  doc_date: string | null;
  date_logistic: string | null;
  car: string | null;
  car_name: string | null;
  driver: string | null;
  driver_name: string | null;
  driver_tel: string | null;
  route_code: string | null;
  route_name: string | null;
  round_code: string | null;
  round_name: string | null;
  round_time: string | null;
  approve_status: number | null;
  job_status: number | null;
  job_close: string | null;
  dispatch_started_at: string | null;
};

export async function tripHeader(tripNo: string): Promise<TripHeader | null> {
  const rows = await query<TripHeader>(
    `SELECT t.doc_no,
            to_char(t.doc_date, 'YYYY-MM-DD') AS doc_date,
            to_char(t.date_logistic, 'YYYY-MM-DD') AS date_logistic,
            t.car, ca.name_1 AS car_name,
            t.driver, dv.name_1 AS driver_name, dv.tel AS driver_tel,
            t.delivery_route_code AS route_code, rt.name AS route_name,
            t.delivery_round_code AS round_code, rd.name AS round_name, rd.time_label AS round_time,
            t.approve_status, t.job_status,
            to_char(t.job_close, 'YYYY-MM-DD HH24:MI') AS job_close,
            to_char(t.dispatch_started_at, 'YYYY-MM-DD HH24:MI') AS dispatch_started_at
     FROM public.odg_tms t
     LEFT JOIN public.odg_tms_car ca ON ca.code = t.car
     LEFT JOIN public.odg_tms_driver dv ON dv.code = t.driver
     LEFT JOIN public.odg_tms_delivery_route rt ON rt.code = t.delivery_route_code
     LEFT JOIN public.odg_tms_delivery_round rd ON rd.code = t.delivery_round_code
     WHERE t.doc_no = $1
     LIMIT 1`,
    [tripNo],
  );
  return rows[0] ?? null;
}

export type NodeStock = {
  rack: string;
  location: string;
  pallet: string;
  qty: string;
  first_in: string | null;
  /** serial ຄົງເຫຼືອຢູ່ node ນີ້ — null = ສິນຄ້ານີ້ບໍ່ໄດ້ຄຸມ serial. */
  sn_qty: number | null;
};

/** ບ່ອນຈັດເກັບ (FIFO) ຂອງແຕ່ລະສິນຄ້າໃນສາງ + ຈຳນວນ serial ຢູ່ແຕ່ລະ node. */
export async function stockNodes(
  wh: string,
  itemCodes: string[],
): Promise<{ nodes: Map<string, NodeStock[]>; serialItems: Set<string> }> {
  if (itemCodes.length === 0) return { nodes: new Map(), serialItems: new Set() };

  // ສິນຄ້າທີ່ "ຄຸມ serial ຈິງ" = is_isn ແລະ ມີ serial ຄົງເຫຼືອໃນສາງນີ້
  // (ຄືກັບ /api/movements/issue/source — ທຸງ is_isn ຢ່າງດຽວກວ້າງເກີນໄປ).
  const serialRows = await query<{ item_code: string }>(
    `SELECT DISTINCT si.item_code
     FROM public.sn_inventory si
     JOIN public.ic_inventory inv ON inv.code = si.item_code
     WHERE si.wh_code = $1 AND si.item_code = ANY($2)
       AND COALESCE(si.status, 0) = 0 AND COALESCE(inv.is_isn, 0) = 1`,
    [wh, itemCodes],
  );
  const serialItems = new Set(serialRows.map((r) => r.item_code));

  // NOTE: ບໍ່ກອງ `status` — status=1 ຄືຂາອອກຂອງການຍ້າຍພາຍໃນ (flag 77), ບໍ່ແມ່ນ void.
  const locRows = await query<{
    item_code: string; rack: string; location: string; pallet: string; qty: string; first_in: string | null;
  }>(
    `SELECT t.item_code,
            COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
            COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
            COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
            SUM(t.qty * t.calc_flag)::text AS qty,
            to_char(MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0), 'YYYY-MM-DD') AS first_in
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND t.item_code = ANY($2)
     GROUP BY t.item_code, rack, location, pallet
     HAVING SUM(t.qty * t.calc_flag) > 0.0001
     ORDER BY t.item_code, MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) ASC NULLS LAST, SUM(t.qty * t.calc_flag) DESC`,
    [wh, itemCodes],
  );

  const snRows = serialItems.size > 0
    ? await query<{ item_code: string; rack: string; location: string; pallet: string; sn_qty: string }>(
        `SELECT i.item_code,
                COALESCE(NULLIF(TRIM(i.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(i.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(i.pallet), ''), '')   AS pallet,
                count(*)::text AS sn_qty
         FROM public.sn_inventory i
         WHERE i.wh_code = $1 AND i.item_code = ANY($2) AND COALESCE(i.status, 0) = 0
         GROUP BY i.item_code, rack, location, pallet`,
        [wh, [...serialItems]],
      )
    : [];
  const snByNode = new Map<string, number>();
  for (const r of snRows) {
    snByNode.set(`${r.item_code}|${r.rack}|${r.location}|${r.pallet}`, Number.parseInt(r.sn_qty, 10) || 0);
  }

  const nodes = new Map<string, NodeStock[]>();
  for (const r of locRows) {
    const entry: NodeStock = {
      rack: r.rack,
      location: r.location,
      pallet: r.pallet,
      qty: r.qty,
      first_in: r.first_in,
      sn_qty: serialItems.has(r.item_code) ? snByNode.get(`${r.item_code}|${r.rack}|${r.location}|${r.pallet}`) ?? 0 : null,
    };
    const arr = nodes.get(r.item_code);
    if (arr) arr.push(entry);
    else nodes.set(r.item_code, [entry]);
  }
  return { nodes, serialItems };
}

export type Allocation = { rack: string; location: string; pallet: string; qty: number };

/**
 * ແບ່ງຈຳນວນທີ່ຕ້ອງເກັບ ລົງຕາມບ່ອນຈັດເກັບແບບ FIFO (ເກົ່າກ່ອນ).
 * ຖ້າໃບ pick ບັງຄັບ serial → ເອົາ node ທີ່ມີ serial ໜູນຫຼັງກ່ອນ, ເພາະ node
 * ທີ່ມີແຕ່ຍອດແຕ່ບໍ່ມີ serial ຈະ pick ບໍ່ໄດ້ຈິງ.
 */
export function allocateFifo(need: number, nodes: NodeStock[], needsSn: boolean): Allocation[] {
  const order = nodes.map((_, i) => i);
  if (needsSn) {
    const covered = (i: number) => (nodes[i].sn_qty ?? 0) > 0;
    order.sort((a, b) => Number(covered(b)) - Number(covered(a)));
  }
  const out: Allocation[] = [];
  let left = need;
  for (const i of order) {
    if (left <= 0.0001) break;
    const n = nodes[i];
    let stock = Number.parseFloat(n.qty) || 0;
    if (needsSn) stock = Math.min(stock, n.sn_qty ?? 0);
    if (stock <= 0) continue;
    const take = Math.min(left, stock);
    out.push({ rack: n.rack, location: n.location, pallet: n.pallet, qty: take });
    left -= take;
  }
  // ຮຽງຄືນຕາມລຳດັບ FIFO ຂອງ dropdown
  out.sort((a, b) => {
    const ia = nodes.findIndex((n) => n.rack === a.rack && n.location === a.location && n.pallet === a.pallet);
    const ib = nodes.findIndex((n) => n.rack === b.rack && n.location === b.location && n.pallet === b.pallet);
    return ia - ib;
  });
  return out;
}

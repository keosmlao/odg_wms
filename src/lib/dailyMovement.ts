/**
 * ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ — the warehouse's daily book, in two shapes:
 *
 *   ຈຳນວນສິນຄ້າ (stock card)   ຍອດຍົກມາ + ຮັບເຂົ້າ − ຈ່າຍອອກ = ຍົກໄປ
 *   ຈຳນວນໃບ (bill flow)        ໃບຄ້າງຍົກມາ + ເປີດບິນ − ຈ່າຍຄົບ = ຄ້າງຍົກໄປ
 *
 * The two answer different questions — how much stock moved, and how the pending
 * backlog grew or shrank — so both are produced from one call.
 *
 * INTERNAL RELOCATION IS NOT MOVEMENT. trans_flag 77 (ຍ້າຍບ່ອນເກັບ) always writes
 * a ±1 pair inside the same warehouse, and flag 99 sometimes does; counting those
 * would inflate both ຮັບເຂົ້າ and ຈ່າຍອອກ while the warehouse total never changed.
 * 77 is dropped outright, 99 only when its two legs sit in this same warehouse.
 *
 * The document-side rules (services excluded, ບິນຮັບຄືນ/ຍົກເລີກ excluded, netting
 * through child docs) are shared with the pending-out report — see `pendingOut.ts`.
 */
import { query } from "@/lib/db";
import { CHILD_DOC_FLAGS, DEAD_DOC_RE, ITEM_EXCLUDE_SQL, OUT_MOVE_FLAGS, IN_TRANSIT, RETURN_DOC_FLAG } from "@/lib/pendingOut";

export type DayStock = {
  date: string;
  /** ຍອດຍົກມາ — closing balance of the previous day. */
  opening: number;
  qty_in: number;
  qty_out: number;
  in_docs: number;
  out_docs: number;
  /** ເປີດບິນ — qty newly demanded that day (ໃບເບີກ/ໂອນ/ບິນຂາຍ). */
  bill_qty: number;
  bill_docs: number;
  /** ຍົກໄປ = opening + in − out. */
  closing: number;
};

export type DayBills = {
  date: string;
  /** ໃບຄ້າງຍົກມາ — still unfilled at the start of the day. */
  carry_in: number;
  /** ເປີດບິນ — documents raised that day. */
  opened: number;
  /** ຈ່າຍຄົບ — documents fully issued that day. */
  closed: number;
  /** ຄ້າງຍົກໄປ = carry_in + opened − closed. */
  carry_out: number;
};

export type DailyFilter = { wh: string; from: string; to: string; flags: number[] };

const num = (v: string | null) => Math.round((Number.parseFloat(v ?? "") || 0) * 1e6) / 1e6;

/** YYYY-MM-DD for every day in the range, so quiet days still get a row. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * ຍອດຍົກມາ at the start of `from`: every movement the warehouse ever recorded
 * before that date. Internal relocations net to zero here so they need no filter.
 */
export async function openingBalance(wh: string, from: string): Promise<number> {
  const rows = await query<{ b: string }>(
    `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS b
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND t.doc_date < $2`,
    [wh, from],
  );
  return num(rows[0]?.b ?? "0");
}

/** Per-day quantity movement + the demand raised that day. */
export async function dailyStock(f: DailyFilter): Promise<DayStock[]> {
  const [moves, bills, opening] = await Promise.all([
    query<{ d: string; qin: string | null; qout: string | null; in_docs: number; out_docs: number }>(
      `WITH selfmove AS (
         -- flag 99 ທີ່ມີທັງຂາເຂົ້າ ແລະ ຂາອອກ ໃນສາງດຽວກັນ = ຍ້າຍພາຍໃນ ບໍ່ນັບ
         SELECT doc_no, item_code
         FROM public.odg_wms_trans_detail
         WHERE trans_flag = 99 AND wh_code = $1 AND doc_date >= $2 AND doc_date <= $3
         GROUP BY doc_no, item_code
         HAVING count(*) FILTER (WHERE calc_flag = 1) > 0
            AND count(*) FILTER (WHERE calc_flag = -1) > 0
       )
       SELECT to_char(t.doc_date, 'YYYY-MM-DD') AS d,
              SUM(t.qty) FILTER (WHERE t.calc_flag = 1)::numeric::text  AS qin,
              SUM(t.qty) FILTER (WHERE t.calc_flag = -1)::numeric::text AS qout,
              count(DISTINCT t.doc_no) FILTER (WHERE t.calc_flag = 1)::int  AS in_docs,
              count(DISTINCT t.doc_no) FILTER (WHERE t.calc_flag = -1)::int AS out_docs
       FROM public.odg_wms_trans_detail t
       WHERE t.wh_code = $1 AND t.doc_date >= $2 AND t.doc_date <= $3
         AND t.trans_flag <> 77   -- ຍ້າຍບ່ອນເກັບພາຍໃນສາງ
         AND NOT EXISTS (SELECT 1 FROM selfmove s WHERE s.doc_no = t.doc_no AND s.item_code = t.item_code)
       GROUP BY 1`,
      [f.wh, f.from, f.to],
    ),
    query<{ d: string; docs: number; q: string }>(
      `SELECT to_char(d.doc_date, 'YYYY-MM-DD') AS d,
              count(DISTINCT d.doc_no)::int AS docs,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0))::numeric::text AS q
       FROM public.ic_trans_detail d
       JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
       LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
       WHERE d.trans_flag = ANY($4) AND d.wh_code = $1
         AND d.doc_date >= $2 AND d.doc_date <= $3
         AND (d.status = 0 OR d.status IS NULL)
         AND COALESCE(h.is_cancel, 0) = 0
         AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
         ${ITEM_EXCLUDE_SQL}
       GROUP BY 1`,
      [f.wh, f.from, f.to, f.flags],
    ),
    openingBalance(f.wh, f.from),
  ]);

  const mvBy = new Map(moves.map((r) => [r.d, r]));
  const blBy = new Map(bills.map((r) => [r.d, r]));
  let running = opening;
  return dateRange(f.from, f.to).map((date) => {
    const m = mvBy.get(date);
    const b = blBy.get(date);
    const qty_in = num(m?.qin ?? "0");
    const qty_out = num(m?.qout ?? "0");
    const row: DayStock = {
      date,
      opening: Math.round(running * 1e6) / 1e6,
      qty_in,
      qty_out,
      in_docs: m?.in_docs ?? 0,
      out_docs: m?.out_docs ?? 0,
      bill_qty: num(b?.q ?? "0"),
      bill_docs: b?.docs ?? 0,
      closing: Math.round((running + qty_in - qty_out) * 1e6) / 1e6,
    };
    running = row.closing;
    return row;
  });
}

type DocLife = { doc_no: string; trans_flag: number; opened_on: string | null; closed_on: string | null };

/**
 * When each outbound document was raised and when it was finally filled.
 *
 * "Filled" = the day the cumulative issued qty first covers the ordered qty, so a
 * document opened Monday and finished Thursday counts as carried on Tue/Wed —
 * which is exactly what makes the daily backlog add up.
 */
export async function docLifecycle(f: DailyFilter, lookbackDays: number): Promise<DocLife[]> {
  return query<DocLife>(
    `WITH src AS (
       SELECT d.doc_no, d.trans_flag,
              to_char(MIN(d.doc_date), 'YYYY-MM-DD') AS opened_on,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS ordered
       FROM public.ic_trans_detail d
       JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
       LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
       WHERE d.trans_flag = ANY($4) AND d.wh_code = $1
         AND d.doc_date >= ($2::date - $5::int) AND d.doc_date <= $3
         AND (d.status = 0 OR d.status IS NULL)
         AND COALESCE(h.is_cancel, 0) = 0
         AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
         ${ITEM_EXCLUDE_SQL}
       GROUP BY d.doc_no, d.trans_flag
     ),
     -- ໃບຮັບຄືນ (CN flag 48) ຫັກຈາກຈຳນວນສັ່ງ ຄືກັນກັບລາຍງານຄ້າງຈ່າຍ
     returned AS (
       SELECT r.ref_doc_no AS doc_no, SUM(r.qty) AS ret_qty
       FROM public.ic_trans_detail r
       JOIN public.ic_trans rh ON rh.doc_no = r.doc_no AND rh.trans_flag = r.trans_flag
       WHERE r.trans_flag = ${RETURN_DOC_FLAG}
         AND (r.status = 0 OR r.status IS NULL)
         AND COALESCE(rh.is_cancel, 0) = 0
         AND r.doc_date >= ($2::date - $5::int)
         AND r.ref_doc_no IN (SELECT doc_no FROM src)
       GROUP BY 1
     ),
     child AS (
       SELECT DISTINCT x.doc_no AS child_no, x.doc_ref AS src_no
       FROM public.ic_trans x
       WHERE x.trans_flag IN (${CHILD_DOC_FLAGS})
         AND COALESCE(x.is_cancel, 0) = 0
         AND x.doc_ref IN (SELECT doc_no FROM src)
     ),
     mv AS (
       SELECT COALESCE(ch.src_no, w.doc_ref) AS doc_no, w.doc_date::date AS d, SUM(w.qty) AS qty
       FROM public.odg_wms_trans_detail w
       LEFT JOIN child ch ON ch.child_no = w.doc_ref
       WHERE w.trans_flag IN (${OUT_MOVE_FLAGS})
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '${IN_TRANSIT}'
         AND w.doc_date >= ($2::date - $5::int)
         AND (ch.src_no IS NOT NULL OR w.doc_ref IN (SELECT doc_no FROM src))
       GROUP BY 1, 2
     ),
     cum AS (
       SELECT doc_no, d, SUM(qty) OVER (PARTITION BY doc_no ORDER BY d) AS c FROM mv
     ),
     closed AS (
       SELECT m.doc_no, to_char(MIN(m.d), 'YYYY-MM-DD') AS closed_on
       FROM cum m
       JOIN src s ON s.doc_no = m.doc_no
       LEFT JOIN returned rt ON rt.doc_no = s.doc_no
       WHERE m.c >= s.ordered - COALESCE(rt.ret_qty, 0) - 0.0001
       GROUP BY m.doc_no
     )
     -- ໃບທີ່ຮັບຄືນໝົດ (ບໍ່ເຫຼືອຫຍັງໃຫ້ຈ່າຍ) ບໍ່ນັບເປັນຄ້າງ — ຖືວ່າປິດວັນທີ່ອອກ CN
     SELECT s.doc_no, s.trans_flag, s.opened_on,
            COALESCE(cl.closed_on, rc.closed_on) AS closed_on
     FROM src s
     LEFT JOIN closed cl ON cl.doc_no = s.doc_no
     LEFT JOIN returned rt ON rt.doc_no = s.doc_no
     LEFT JOIN LATERAL (
       SELECT to_char(MIN(r.doc_date), 'YYYY-MM-DD') AS closed_on
       FROM public.ic_trans_detail r
       WHERE r.trans_flag = ${RETURN_DOC_FLAG} AND r.ref_doc_no = s.doc_no
         AND COALESCE(rt.ret_qty, 0) >= s.ordered - 0.0001
     ) rc ON TRUE`,
    [f.wh, f.from, f.to, f.flags, lookbackDays],
  );
}

/** Fold the document lifecycles into the daily backlog flow. */
export function billFlow(docs: DocLife[], from: string, to: string): DayBills[] {
  return dateRange(from, to).map((date) => {
    let carry_in = 0;
    let opened = 0;
    let closed = 0;
    for (const d of docs) {
      if (!d.opened_on) continue;
      if (d.opened_on === date) opened += 1;
      else if (d.opened_on < date && (!d.closed_on || d.closed_on >= date)) carry_in += 1;
      if (d.closed_on === date) closed += 1;
    }
    return { date, carry_in, opened, closed, carry_out: carry_in + opened - closed };
  });
}

export type DayItem = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty_in: number;
  qty_out: number;
};

/** Per-item movement on one day — the drill-down behind a ຈຳນວນສິນຄ້າ row. */
export async function dayItems(wh: string, date: string): Promise<DayItem[]> {
  const rows = await query<{ item_code: string; item_name: string | null; unit_code: string | null; qin: string | null; qout: string | null }>(
    `WITH selfmove AS (
       SELECT doc_no, item_code FROM public.odg_wms_trans_detail
       WHERE trans_flag = 99 AND wh_code = $1 AND doc_date = $2
       GROUP BY doc_no, item_code
       HAVING count(*) FILTER (WHERE calc_flag = 1) > 0 AND count(*) FILTER (WHERE calc_flag = -1) > 0
     )
     SELECT t.item_code, MAX(t.item_name) AS item_name, MAX(t.unit_code) AS unit_code,
            SUM(t.qty) FILTER (WHERE t.calc_flag = 1)::numeric::text  AS qin,
            SUM(t.qty) FILTER (WHERE t.calc_flag = -1)::numeric::text AS qout
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND t.doc_date = $2 AND t.trans_flag <> 77
       AND NOT EXISTS (SELECT 1 FROM selfmove s WHERE s.doc_no = t.doc_no AND s.item_code = t.item_code)
     GROUP BY t.item_code
     ORDER BY t.item_code`,
    [wh, date],
  );
  return rows.map((r) => ({
    item_code: r.item_code,
    item_name: r.item_name,
    unit_code: r.unit_code,
    qty_in: num(r.qin),
    qty_out: num(r.qout),
  }));
}

export type DayBill = {
  doc_no: string;
  trans_flag: number;
  cust_name: string | null;
  transport_name: string | null;
  lines: number;
  qty: number;
  note: string | null;
};

/** The documents raised on one day — the drill-down behind a ຈຳນວນໃບ row. */
export async function dayBills(wh: string, date: string, flags: number[]): Promise<DayBill[]> {
  const rows = await query<{
    doc_no: string; trans_flag: number; cust_name: string | null; transport_name: string | null;
    lines: number; qty: string; note: string | null;
  }>(
    `SELECT d.doc_no, d.trans_flag,
            MAX(cu.name_1) AS cust_name,
            MAX(tt.name_1) AS transport_name,
            count(*)::int AS lines,
            SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0))::numeric::text AS qty,
            MAX(NULLIF(TRIM(h.remark_4), '')) AS note
     FROM public.ic_trans_detail d
     JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
     LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     LEFT JOIN LATERAL (
       SELECT sh.transport_code FROM public.ic_trans_shipment sh
       WHERE sh.doc_no = d.doc_no AND sh.trans_flag = d.trans_flag LIMIT 1
     ) sh ON TRUE
     LEFT JOIN public.transport_type tt ON tt.code = sh.transport_code
     WHERE d.trans_flag = ANY($3) AND d.wh_code = $1 AND d.doc_date = $2
       AND (d.status = 0 OR d.status IS NULL)
       AND COALESCE(h.is_cancel, 0) = 0
       AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
       ${ITEM_EXCLUDE_SQL}
     GROUP BY d.doc_no, d.trans_flag
     ORDER BY d.doc_no`,
    [wh, date, flags],
  );
  return rows.map((r) => ({
    doc_no: r.doc_no,
    trans_flag: r.trans_flag,
    cust_name: r.cust_name,
    transport_name: r.transport_name,
    lines: r.lines,
    qty: num(r.qty),
    note: r.note,
  }));
}

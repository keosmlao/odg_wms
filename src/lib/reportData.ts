import "server-only";
import { query } from "@/lib/db";

/**
 * Data for the scheduled email reports.
 *
 * These mirror what the app already shows — the home KPIs (odg_wms_trans_detail
 * calc_flag ±1 for a date), /api/receive/pending, and /api/movements/health —
 * but take an explicit warehouse scope instead of reading the session cookie,
 * because the scheduler runs with no request behind it.
 *
 * Scope: null = every warehouse, [] = none, [..] = those codes.
 */
export type Scope = string[] | null;

/** `AND <col> = ANY($n)` plus the arg list, or nothing when the scope is "all". */
function scoped(scope: Scope, col: string, argIndex: number): { clause: string; args: unknown[] } {
  if (scope === null) return { clause: "", args: [] };
  return { clause: `AND ${col} = ANY($${argIndex})`, args: [scope] };
}

export type MovementSummary = { total_qty: number; movement_count: number; warehouse_count: number };

/** Today's receive (+1) or issue (−1) totals — the same aggregate as the home KPIs. */
export async function movementSummary(scope: Scope, date: string, direction: 1 | -1): Promise<MovementSummary> {
  // Fixed params first ($1 date, $2 direction); the scope arg, when present, is
  // appended LAST and referenced by its actual index — so a null scope doesn't
  // shift the fixed placeholders.
  const args: unknown[] = [date, direction];
  let clause = "";
  if (scope !== null) { args.push(scope); clause = `AND wh_code = ANY($${args.length})`; }
  const rows = await query<{ total_qty: string; movement_count: number; warehouse_count: number }>(
    `SELECT COALESCE(SUM(qty * calc_flag), 0)::text AS total_qty,
            count(*)::int AS movement_count,
            count(DISTINCT wh_code)::int AS warehouse_count
     FROM public.odg_wms_trans_detail
     WHERE (status = 0 OR status IS NULL)
       AND calc_flag = $2
       AND doc_date = $1
       ${clause}`,
    args,
  );
  const r = rows[0];
  return {
    total_qty: Math.abs(Math.round((Number.parseFloat(r?.total_qty ?? "0") || 0) * 100) / 100),
    movement_count: r?.movement_count ?? 0,
    warehouse_count: r?.warehouse_count ?? 0,
  };
}

export type DocRow = { doc_no: string; wh_code: string; lines: number; qty: number };

/** The individual documents behind a day's movement, newest first. */
export async function movementDocs(scope: Scope, date: string, direction: 1 | -1, limit = 25): Promise<DocRow[]> {
  // Fixed params first ($1 date, $2 direction, $3 limit); scope appended last.
  const args: unknown[] = [date, direction, limit];
  let clause = "";
  if (scope !== null) { args.push(scope); clause = `AND wh_code = ANY($${args.length})`; }
  const rows = await query<{ doc_no: string; wh_code: string; lines: number; qty: string }>(
    `SELECT doc_no, wh_code, count(*)::int AS lines, COALESCE(SUM(qty), 0)::text AS qty
     FROM public.odg_wms_trans_detail
     WHERE (status = 0 OR status IS NULL)
       AND calc_flag = $2
       AND doc_date = $1
       ${clause}
     GROUP BY doc_no, wh_code
     ORDER BY doc_no DESC
     LIMIT $3`,
    args,
  );
  return rows.map((r) => ({
    doc_no: r.doc_no, wh_code: r.wh_code, lines: r.lines,
    qty: Math.round((Number.parseFloat(r.qty) || 0) * 100) / 100,
  }));
}

export type PendingRow = { wh_code: string; wh_name: string | null; po_no: string; doc_date: string | null; days_waiting: number; lines: number; remaining: number };

/**
 * PO lines still waiting to be received (ໃບຮັບທີ່ຍັງຄ້າງ), oldest PO first.
 *
 * remaining = the ERP view's qty_balance − what WMS already received against
 * that PO line, matching /api/receive/pending. odg_po_remain is a slow ERP view
 * (~1.2s), so this aggregates in one pass rather than per warehouse.
 */
export async function pendingReceipts(scope: Scope, limit = 25): Promise<PendingRow[]> {
  const { clause, args } = scoped(scope, "w.code", 1);
  return (await query<{ wh_code: string; wh_name: string | null; po_no: string; doc_date: string | null; days_waiting: number | null; lines: number; remaining: string }>(
    `WITH remain AS (
       SELECT w.code AS wh_code, p.warehouse AS wh_name, p.doc_no AS po_no,
              p.doc_date, p.item_code,
              p.qty_balance - COALESCE((
                SELECT SUM(d.qty)
                FROM public.wms_product_receive_detail d
                JOIN public.wms_product_receive h ON h.doc_no = d.doc_no AND h.doc_type = 1
                -- Attribute each received line to its own PO (multi-PO receipts set
                -- d.ref_doc_no per line); fall back to the header PO for legacy receipts.
                WHERE COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), h.ref_doc_no) = p.doc_no
                  AND d.item_code = p.item_code
                  AND (h.status = 0 OR h.status IS NULL)
              ), 0) AS remaining
       FROM public.odg_po_remain p
       JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
       -- Only this year's POs (from Jan 1) — old 2023-2025 balances are stale noise.
       WHERE p.qty_balance > 0 AND p.doc_date >= date_trunc('year', CURRENT_DATE)::date ${clause}
     )
     SELECT wh_code, wh_name, po_no,
            to_char(MIN(doc_date), 'YYYY-MM-DD') AS doc_date,
            (CURRENT_DATE - MIN(doc_date))::int AS days_waiting,
            count(*)::int AS lines,
            SUM(remaining)::text AS remaining
     FROM remain
     WHERE remaining > 0.0001
     GROUP BY wh_code, wh_name, po_no
     ORDER BY MIN(doc_date) ASC NULLS LAST
     LIMIT $${args.length + 1}`,
    [...args, limit],
  )).map((r) => ({
    wh_code: r.wh_code, wh_name: r.wh_name, po_no: r.po_no, doc_date: r.doc_date,
    days_waiting: r.days_waiting ?? 0, lines: r.lines,
    remaining: Math.round((Number.parseFloat(r.remaining) || 0) * 100) / 100,
  }));
}

export type Health = { dead_items: number; dead_qty: number; sn_mismatch: number };

/**
 * Warehouse health, same definition as /api/movements/health:
 *   dead stock  — in stock but no outbound movement for > 90 days
 *   SN mismatch — (rack, location, pallet, item) nodes where WMS qty ≠ serial count
 */
export async function health(scope: Scope): Promise<Health> {
  const dead = scoped(scope, "t.wh_code", 1);
  const sn = scoped(scope, "s.wh_code", 1);
  const [deadRows, mismatchRows] = await Promise.all([
    query<{ dead_items: string; dead_qty: string }>(
      `WITH stock AS (
         SELECT t.wh_code, t.item_code,
                SUM(t.qty * t.calc_flag) AS bal,
                MAX(t.doc_date) FILTER (WHERE t.calc_flag < 0) AS last_out,
                MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) AS first_in
         FROM public.odg_wms_trans_detail t
         WHERE t.item_code IS NOT NULL AND t.item_code <> '' ${dead.clause}
         GROUP BY t.wh_code, t.item_code
         HAVING SUM(t.qty * t.calc_flag) > 0.0001
       )
       SELECT count(*) FILTER (WHERE (CURRENT_DATE - COALESCE(last_out, first_in)) > 90)::text AS dead_items,
              COALESCE(SUM(bal) FILTER (WHERE (CURRENT_DATE - COALESCE(last_out, first_in)) > 90), 0)::numeric::text AS dead_qty
       FROM stock`,
      dead.args,
    ),
    query<{ mismatch: string }>(
      `WITH sn_items AS (
         SELECT DISTINCT s.wh_code, s.item_code FROM public.sn_inventory s WHERE TRUE ${sn.clause}
       ),
       stock AS (
         SELECT t.wh_code,
                COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
                t.item_code, SUM(t.qty * t.calc_flag) AS qty
         FROM public.odg_wms_trans_detail t
         JOIN sn_items si ON si.wh_code = t.wh_code AND si.item_code = t.item_code
         GROUP BY 1, 2, 3, 4, 5
       ),
       sn AS (
         SELECT s.wh_code,
                COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet,
                s.item_code, count(*) AS cnt
         FROM public.sn_inventory s
         JOIN sn_items si ON si.wh_code = s.wh_code AND si.item_code = s.item_code
         WHERE COALESCE(s.status, 0) = 0
         GROUP BY 1, 2, 3, 4, 5
       ),
       merged AS (
         SELECT COALESCE(st.qty, 0) AS sq, COALESCE(sn.cnt, 0) AS sc
         FROM stock st
         FULL OUTER JOIN sn
           ON st.wh_code = sn.wh_code AND st.rack = sn.rack AND st.location = sn.location
          AND st.pallet = sn.pallet AND st.item_code = sn.item_code
       )
       SELECT count(*)::text AS mismatch FROM merged WHERE sq <> sc`,
      sn.args,
    ),
  ]);
  return {
    dead_items: Number.parseInt(deadRows[0]?.dead_items ?? "0", 10) || 0,
    dead_qty: Math.round((Number.parseFloat(deadRows[0]?.dead_qty ?? "0") || 0) * 100) / 100,
    sn_mismatch: Number.parseInt(mismatchRows[0]?.mismatch ?? "0", 10) || 0,
  };
}

export type MoverRow = { item_code: string; item_name: string | null; unit_code: string | null; qout: number; outmoves: number };

/**
 * Top outbound movers over the `days`-day window ending on `date` (default 7),
 * ranked by quantity issued — same aggregate as /api/movements/movers, scoped.
 * A single day is often too sparse to be useful, hence the trailing window.
 */
export async function topMovers(scope: Scope, date: string, days = 7, limit = 10): Promise<MoverRow[]> {
  const { clause, args } = scoped(scope, "wh_code", 3);
  return (await query<{ item_code: string; item_name: string | null; unit_code: string | null; qout: string; outmoves: number }>(
    `SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code,
            COALESCE(SUM(qty) FILTER (WHERE calc_flag < 0), 0)::numeric::text AS qout,
            count(*) FILTER (WHERE calc_flag < 0)::int AS outmoves
     FROM public.odg_wms_trans_detail
     WHERE (status = 0 OR status IS NULL)
       AND doc_date BETWEEN ($1::date - ($2::int - 1)) AND $1::date
       AND item_code IS NOT NULL AND item_code <> ''
       ${clause}
     GROUP BY item_code
     HAVING SUM(qty) FILTER (WHERE calc_flag < 0) > 0
     ORDER BY SUM(qty) FILTER (WHERE calc_flag < 0) DESC
     LIMIT $${args.length + 3}`,
    [date, days, ...args, limit],
  )).map((r) => ({
    item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
    qout: Math.round((Number.parseFloat(r.qout) || 0) * 100) / 100,
    outmoves: r.outmoves,
  }));
}

export type PendingIssueRow = { doc_no: string; type: string; doc_date: string | null; days_waiting: number; cust_name: string | null; lines: number; remaining: number };

/** Source-doc type by trans_flag, for the report label. */
const ISSUE_TYPE_LABEL: Record<number, string> = { 122: "ເບີກ", 124: "ໂອນ", 44: "ຂາຍ" };

/**
 * Outbound documents still waiting to be issued (ສິນຄ້າຄ້າງຈ່າຍ), oldest first.
 * Nets each source doc (ໃບເບີກ 122 / ໃບໂອນ 124 / ບິນຂາຍ 44) against what WMS has
 * already issued (72 leg, calc_flag −1, excluding the 9903 in-transit warehouse)
 * and any created-but-unconfirmed pick — the same netting as /api/movements/issue/pending.
 */
export async function pendingIssues(scope: Scope, limit = 25): Promise<PendingIssueRow[]> {
  // Fixed param $1 = limit; scope appended last. Floor at start of the year so
  // stale pre-2026 documents drop off, matching the pending-receipt filter.
  const args: unknown[] = [limit];
  let clause = "";
  if (scope !== null) { args.push(scope); clause = `AND d.wh_code = ANY($${args.length})`; }
  const rows = await query<{ doc_no: string; trans_flag: number; doc_date: string | null; days_waiting: number | null; cust_name: string | null; line_count: number; remaining: string }>(
    `WITH src AS (
       SELECT d.doc_no, d.trans_flag, count(*)::int AS line_count,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       WHERE d.trans_flag IN (122, 124, 44)
         AND (d.status = 0 OR d.status IS NULL)
         AND d.doc_date >= date_trunc('year', CURRENT_DATE)::date
         AND d.item_code NOT LIKE '97%'
         ${clause}
       GROUP BY d.doc_no, d.trans_flag
     ),
     issued AS (
       SELECT w.doc_ref AS doc_no, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       WHERE w.trans_flag = 72 AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '9903'
         AND w.doc_ref IN (SELECT doc_no FROM src)
       GROUP BY w.doc_ref
     ),
     pend AS (
       SELECT o.ref_doc_no AS doc_no, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0 AND o.ref_doc_no IN (SELECT doc_no FROM src)
       GROUP BY o.ref_doc_no
     )
     SELECT s.doc_no, s.trans_flag,
            to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
            (CURRENT_DATE - h.doc_date)::int AS days_waiting,
            cu.name_1 AS cust_name, s.line_count,
            (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS remaining
     FROM src s
     JOIN public.ic_trans h ON h.doc_no = s.doc_no AND h.trans_flag = s.trans_flag
     LEFT JOIN issued i ON i.doc_no = s.doc_no
     LEFT JOIN pend pd ON pd.doc_no = s.doc_no
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     WHERE COALESCE(h.is_cancel, 0) = 0
       -- ໃບຂໍໂອນ (124) ຈ່າຍໄດ້ໂດຍບໍ່ຕ້ອງອະນຸມັດ (ກັນສະເພາະທີ່ຖືກປະຕິເສດ)
       -- — ໃຫ້ຕົງກັບ /api/movements/issue/pending
       AND (h.trans_flag <> 124 OR COALESCE(h.status, 0) <> 2)
       AND (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
     ORDER BY h.doc_date ASC NULLS LAST
     LIMIT $1`,
    args,
  );
  return rows.map((r) => ({
    doc_no: r.doc_no, type: ISSUE_TYPE_LABEL[r.trans_flag] ?? String(r.trans_flag),
    doc_date: r.doc_date, days_waiting: r.days_waiting ?? 0, cust_name: r.cust_name, lines: r.line_count,
    remaining: Math.round((Number.parseFloat(r.remaining) || 0) * 100) / 100,
  }));
}

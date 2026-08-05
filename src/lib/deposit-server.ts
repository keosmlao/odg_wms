import "server-only";
import type { PoolClient } from "pg";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";
import {
  DEFAULT_SETTINGS,
  type DepositRow,
  type DepositSettings,
} from "@/lib/deposit";

function num(v: string | null | undefined, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the current global deposit settings. Missing keys fall back to
 * DEFAULT_SETTINGS values so the system always has a usable tier set
 * even after a fresh install.
 */
export async function getDepositSettings(): Promise<DepositSettings> {
  const rows = await query<{ key: string; value: string }>(
    `SELECT key, value FROM public.wms_deposit_setting`,
  );
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    fee_model: "tiered_percent",
    free_days_max: Math.round(
      num(m.get("free_days_max") ?? null, DEFAULT_SETTINGS.free_days_max),
    ),
    tier1_days_max: Math.round(
      num(m.get("tier1_days_max") ?? null, DEFAULT_SETTINGS.tier1_days_max),
    ),
    tier1_pct: num(m.get("tier1_pct") ?? null, DEFAULT_SETTINGS.tier1_pct),
    tier2_days_max: Math.round(
      num(m.get("tier2_days_max") ?? null, DEFAULT_SETTINGS.tier2_days_max),
    ),
    tier2_pct: num(m.get("tier2_pct") ?? null, DEFAULT_SETTINGS.tier2_pct),
    tier3_days_max: Math.round(
      num(m.get("tier3_days_max") ?? null, DEFAULT_SETTINGS.tier3_days_max),
    ),
    tier3_pct: num(m.get("tier3_pct") ?? null, DEFAULT_SETTINGS.tier3_pct),
    tier4_pct: num(m.get("tier4_pct") ?? null, DEFAULT_SETTINGS.tier4_pct),
    min_charge: num(m.get("min_charge") ?? null, DEFAULT_SETTINGS.min_charge),
    max_charge: num(m.get("max_charge") ?? null, DEFAULT_SETTINGS.max_charge),
    currency: m.get("currency") ?? DEFAULT_SETTINGS.currency,
  };
}

/**
 * Elapsed days for an active deposit, matching `elapsedDays()` on the client:
 * any partial day counts as a full day, minimum 1.
 */
const DAYS_SQL = `GREATEST(1, CEIL(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - d.start_date::timestamp)) / 86400.0))::int`;

/** Aging buckets selectable from the list screen. */
export type AgingFilter = "" | "over" | "tier2" | "tier3" | "tier4" | "soon";

export type DepositListFilters = {
  status?: string;
  q?: string;
  aging?: AgingFilter;
  from?: string;
  to?: string;
};

export type DepositListRow = {
  deposit_id: number;
  deposit_code: string;
  wh_code: string;
  wh_name: string | null;
  cust_code: string | null;
  cust_name: string | null;
  sale_code: string | null;
  sale_name: string | null;
  start_date: string;
  end_date: string | null;
  status: DepositRow["status"];
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: string;
  tier2_days_max: number;
  tier2_pct: string;
  tier3_days_max: number;
  tier3_pct: string;
  tier4_pct: string;
  min_charge: string;
  max_charge: string;
  currency: string;
  total_items: number;
  total_qty: string;
  total_value: string;
  bill_count: number;
  /** Bill numbers on this deposit, comma-separated. */
  bill_docs: string | null;
  /** Selling department(s) of those bills, from ic_trans → erp_department_list. */
  dept_names: string | null;
  /** Salesperson to show: the deposit snapshot, else resolved from the bill. */
  sale_display: string | null;
  settled_fee: string | null;
  settled_days: number | null;
  days_elapsed: number;
  created_at: string;
  created_employee: string | null;
};

/**
 * Build the deposit list query shared by the list screen and the CSV export so
 * the two can never drift. Search, date range and aging are all resolved in
 * SQL — filtering in JS after a LIMIT would silently hide older matches.
 */
export function buildDepositListQuery(
  filters: DepositListFilters,
  accessible: string[] | null,
  limit: number,
): { sql: string; args: unknown[] } {
  const args: unknown[] = [];
  const where: string[] = [];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`d.wh_code = ANY($${args.length})`);
  }
  const status = filters.status ?? "";
  if (status === "active" || status === "settled" || status === "cancelled") {
    args.push(status);
    where.push(`d.status = $${args.length}`);
  }
  const q = (filters.q ?? "").trim();
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(
      `(d.deposit_code ILIKE $${i} OR d.cust_code ILIKE $${i} OR d.cust_name ILIKE $${i}
        OR d.wh_code ILIKE $${i} OR d.sale_name ILIKE $${i}
        OR EXISTS (SELECT 1 FROM public.wms_deposit_bill sb
                    WHERE sb.deposit_id = d.deposit_id AND sb.doc_no ILIKE $${i}))`,
    );
  }
  if (filters.from) {
    args.push(filters.from);
    where.push(`d.start_date >= $${args.length}::date`);
  }
  if (filters.to) {
    args.push(filters.to);
    where.push(`d.start_date <= $${args.length}::date`);
  }

  // Aging only means anything while the goods are still in the warehouse.
  const agingWhere: string[] = [];
  switch (filters.aging) {
    case "over":
      agingWhere.push("x.days_elapsed > x.free_days_max");
      break;
    case "tier2":
      agingWhere.push("x.days_elapsed > x.tier1_days_max");
      break;
    case "tier3":
      agingWhere.push("x.days_elapsed > x.tier2_days_max");
      break;
    case "tier4":
      agingWhere.push("x.days_elapsed > x.tier3_days_max");
      break;
    case "soon":
      agingWhere.push(`(
        (x.free_days_max  - x.days_elapsed) BETWEEN 0 AND 1
        OR (x.tier1_days_max - x.days_elapsed) BETWEEN 0 AND 1
        OR (x.tier2_days_max - x.days_elapsed) BETWEEN 0 AND 1
        OR (x.tier3_days_max - x.days_elapsed) BETWEEN 0 AND 1
      )`);
      break;
    default:
      break;
  }
  if (agingWhere.length) agingWhere.push("x.status = 'active'");

  args.push(limit);
  const limitIdx = args.length;

  const sql = `
    SELECT * FROM (
      SELECT
        d.deposit_id, d.deposit_code, d.wh_code,
        w.name_1 AS wh_name,
        d.cust_code, d.cust_name, d.sale_code, d.sale_name,
        d.start_date::text AS start_date,
        d.end_date::text   AS end_date,
        d.status,
        d.free_days_max,
        d.tier1_days_max, d.tier1_pct::text AS tier1_pct,
        d.tier2_days_max, d.tier2_pct::text AS tier2_pct,
        d.tier3_days_max, d.tier3_pct::text AS tier3_pct,
        d.tier4_pct::text  AS tier4_pct,
        d.min_charge::text AS min_charge,
        d.max_charge::text AS max_charge,
        d.currency,
        d.total_items,
        d.total_qty::text   AS total_qty,
        d.total_value::text AS total_value,
        bl.bill_count,
        bl.bill_docs,
        bl.dept_names,
        COALESCE(NULLIF(d.sale_name, ''), bl.bill_sale_names) AS sale_display,
        d.settled_fee::text AS settled_fee,
        d.settled_days,
        ${DAYS_SQL} AS days_elapsed,
        d.created_at::text AS created_at,
        e.fullname_lo      AS created_employee
      FROM public.wms_deposit d
      LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
      LEFT JOIN public.odg_employee e ON e.employee_id = d.created_by
      -- Bill numbers, and the selling department behind them. The deposit
      -- snapshot keeps the customer/salesperson but not the department, so it
      -- is read back from the source bill in ic_trans.
      LEFT JOIN LATERAL (
        SELECT
          count(*)::int AS bill_count,
          string_agg(DISTINCT b.doc_no, ', ' ORDER BY b.doc_no) AS bill_docs,
          string_agg(
            DISTINCT COALESCE(NULLIF(dl.name_1, ''), NULLIF(t.department_code, '')),
            ', '
          ) AS dept_names,
          -- Fallback for deposits taken before the salesperson was snapshotted.
          string_agg(
            DISTINCT COALESCE(
              NULLIF(b.sale_name, ''), NULLIF(se.fullname_lo, ''), NULLIF(t.sale_code, '')
            ),
            ', '
          ) AS bill_sale_names
        FROM public.wms_deposit_bill b
        LEFT JOIN public.ic_trans t
               ON t.doc_no = b.doc_no AND t.trans_flag = b.trans_flag
        LEFT JOIN public.erp_department_list dl ON dl.code = t.department_code
        LEFT JOIN public.odg_employee se ON se.employee_code = t.sale_code
        WHERE b.deposit_id = d.deposit_id
      ) bl ON TRUE
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ) x
    ${agingWhere.length ? `WHERE ${agingWhere.join(" AND ")}` : ""}
    ORDER BY x.start_date DESC, x.deposit_id DESC
    LIMIT $${limitIdx}
  `;
  return { sql, args };
}

/** Count + value of the active deposits in each aging bucket. */
export type AgingSummaryRow = {
  level: "free" | "tier1" | "tier2" | "tier3" | "tier4";
  n: number;
  value: string;
};

export async function agingSummary(
  accessible: string[] | null,
): Promise<AgingSummaryRow[]> {
  const args: unknown[] = [];
  let whClause = "";
  if (Array.isArray(accessible)) {
    args.push(accessible);
    whClause = `AND d.wh_code = ANY($${args.length})`;
  }
  return query<AgingSummaryRow>(
    `SELECT
       CASE
         WHEN days_elapsed <= free_days_max  THEN 'free'
         WHEN days_elapsed <= tier1_days_max THEN 'tier1'
         WHEN days_elapsed <= tier2_days_max THEN 'tier2'
         WHEN days_elapsed <= tier3_days_max THEN 'tier3'
         ELSE 'tier4'
       END AS level,
       count(*)::int      AS n,
       SUM(total_value)::text AS value
     FROM (
       SELECT d.free_days_max, d.tier1_days_max, d.tier2_days_max,
              d.tier3_days_max, d.total_value,
              ${DAYS_SQL} AS days_elapsed
       FROM public.wms_deposit d
       WHERE d.status = 'active' ${whClause}
     ) x
     GROUP BY 1`,
    args,
  );
}

/**
 * Re-sum a deposit's cached header totals from its bill snapshot rows. Called
 * after bills are added to or removed from an active deposit.
 */
export async function recalcDepositTotals(
  client: PoolClient,
  depositId: number,
): Promise<void> {
  await client.query(
    `UPDATE public.wms_deposit d
        SET total_items = COALESCE(t.items, 0),
            total_qty   = COALESCE(t.qty, 0),
            total_value = COALESCE(t.value, 0)
       FROM (
         SELECT SUM(items)::int AS items,
                SUM(qty_sum)    AS qty,
                SUM(value_sum)  AS value
         FROM public.wms_deposit_bill
         WHERE deposit_id = $1
       ) t
      WHERE d.deposit_id = $1`,
    [depositId],
  );
}

export type DepositGuard =
  | { ok: true; session: Session; row: DepositRow }
  | { ok: false; response: NextResponse };

export async function requireDepositAccess(
  depositId: number,
): Promise<DepositGuard> {
  const userSession = await getSession();
  if (!userSession) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" },
        { status: 401 },
      ),
    };
  }
  if (!userSession.role) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" },
        { status: 403 },
      ),
    };
  }

  const rows = await query<DepositRow>(
    `SELECT
       deposit_id, deposit_code, wh_code, cust_code, cust_name,
       start_date::text AS start_date,
       end_date::text   AS end_date,
       status,
       fee_model,
       free_days_max,
       tier1_days_max, tier1_pct::text AS tier1_pct,
       tier2_days_max, tier2_pct::text AS tier2_pct,
       tier3_days_max, tier3_pct::text AS tier3_pct,
       tier4_pct::text  AS tier4_pct,
       min_charge::text AS min_charge,
       max_charge::text AS max_charge,
       currency,
       total_items,
       total_qty::text   AS total_qty,
       total_value::text AS total_value,
       settled_fee::text AS settled_fee,
       settled_days,
       note,
       created_by,
       created_at::text  AS created_at,
       settled_by,
       settled_at::text  AS settled_at
     FROM public.wms_deposit
     WHERE deposit_id = $1`,
    [depositId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ພົບການຮັບຝາກ" },
        { status: 404 },
      ),
    };
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(row.wh_code)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
        { status: 403 },
      ),
    };
  }

  return { ok: true, session: userSession, row };
}

/** Generate the next deposit_code for a given date. Format: DP-YYYYMM-NNN */
export async function nextDepositCode(startDate: string): Promise<string> {
  const d = new Date(startDate);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `DP-${ym}-`;
  const rows = await query<{ max: string | null }>(
    `SELECT MAX(deposit_code) AS max
     FROM public.wms_deposit
     WHERE deposit_code LIKE $1`,
    [`${prefix}%`],
  );
  const last = rows[0]?.max ?? null;
  const lastN = last ? Number.parseInt(last.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastN + 1).padStart(3, "0")}`;
}

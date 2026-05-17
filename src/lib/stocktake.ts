import "server-only";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";

export type SessionStatus = "open" | "pending_approval" | "closed";

export type SessionRow = {
  session_id: number;
  session_code: string;
  wh_code: string;
  name: string | null;
  note: string | null;
  status: SessionStatus;
  count_date: string;
  blind: boolean;
  created_by: number | null;
  created_at: string;
  submitted_by: number | null;
  submitted_at: string | null;
  approved_by: number | null;
  approval_note: string | null;
  closed_by: number | null;
  closed_at: string | null;
};

export const SESSION_SELECT_FIELDS = `
  session_id, session_code, wh_code, name, note, status,
  count_date::text AS count_date,
  blind,
  created_by, created_at::text AS created_at,
  submitted_by, submitted_at::text AS submitted_at,
  approved_by, approval_note,
  closed_by, closed_at::text AS closed_at
`;

export type SessionGuard =
  | { ok: true; session: Session; row: SessionRow }
  | { ok: false; response: NextResponse };

export async function requireSessionAccess(
  sessionId: number,
  opts: { mustBeOpen?: boolean } = {},
): Promise<SessionGuard> {
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

  const rows = await query<SessionRow>(
    `SELECT ${SESSION_SELECT_FIELDS}
     FROM public.wms_stocktake_session
     WHERE session_id = $1`,
    [sessionId],
  );
  const row = rows[0];
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ບໍ່ພົບຮອບກວດນັບ" },
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

  if (opts.mustBeOpen && row.status !== "open") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            row.status === "pending_approval"
              ? "ຮອບກວດນັບກຳລັງລໍຖ້າອະນຸມັດ — ບໍ່ສາມາດແກ້ໄຂໄດ້"
              : "ຮອບກວດນັບປິດແລ້ວ — ບໍ່ສາມາດແກ້ໄຂໄດ້",
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, session: userSession, row };
}

/**
 * Generate the next session_code for the given count_date. Format: ST-YYYYMM-NNN
 */
export async function nextSessionCode(countDate: string): Promise<string> {
  const d = new Date(countDate);
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = `ST-${ym}-`;
  const rows = await query<{ max: string | null }>(
    `SELECT MAX(session_code) AS max
     FROM public.wms_stocktake_session
     WHERE session_code LIKE $1`,
    [`${prefix}%`],
  );
  const last = rows[0]?.max ?? null;
  const lastN = last ? Number.parseInt(last.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastN + 1).padStart(3, "0")}`;
}

export function asNumericString(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  if (!Number.isFinite(n)) return null;
  return String(n);
}

export function trimOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * SQL for taking the SML snapshot — the frozen "current" balance from
 * `odg_wms_trans_detail` for a given warehouse, used as the variance baseline.
 *
 * Parameters: $1 = session_id, $2 = wh_code
 */
export const SNAPSHOT_INSERT_SQL = `
  INSERT INTO public.wms_stocktake_snapshot
    (session_id, item_code, item_name, unit_code, snapshot_qty)
  SELECT
    $1,
    t.item_code,
    MAX(t.item_name),
    MAX(t.unit_code),
    SUM(t.qty * t.calc_flag)::numeric
  FROM public.odg_wms_trans_detail t
  WHERE (t.status = 0 OR t.status IS NULL)
    AND t.wh_code = $2
    AND t.item_code IS NOT NULL
    AND t.item_code <> ''
  GROUP BY t.item_code
  HAVING SUM(t.qty * t.calc_flag) <> 0
`;

/**
 * SQL for rebuilding the per-warehouse pending-bill cache from the source
 * tables (ic_trans_shipment + ic_trans + ic_trans_detail + odg_tms_detail).
 *
 * Parameters: $1 = wh_code
 *
 * Strategy: pre-filter bill keys with EXISTS (cheap), then aggregate
 * each via LATERAL — avoids aggregating all 32k+ pending bills of a
 * warehouse just to materialize the rows.
 */
export const PENDING_BILL_CACHE_REBUILD_SQL = `
  INSERT INTO public.wms_pending_bill_cache (
    wh_code, doc_no, trans_flag, doc_date,
    cust_code, cust_name, transport_name,
    sale_code, sale_name, currency_code,
    lines, items, qty_sum, value_sum,
    tms_total, tms_shipped, tms_last_sent, refreshed_at
  )
  SELECT
    $1,
    bk.doc_no,
    bk.trans_flag,
    bk.doc_date,
    bk.cust_code,
    cust.name_1                            AS cust_name,
    bk.transport_name,
    bk.sale_code,
    sale.fullname_lo                       AS sale_name,
    bk.currency_code,
    COALESCE(agg.lines, 0),
    COALESCE(agg.items, 0),
    COALESCE(agg.qty_sum, 0),
    COALESCE(agg.value_sum, 0),
    COALESCE(tms.tms_total, 0),
    COALESCE(tms.tms_shipped, 0),
    tms.tms_last_sent,
    CURRENT_TIMESTAMP
  FROM (
    SELECT
      sh.doc_no,
      sh.trans_flag,
      sh.doc_date,
      sh.cust_code,
      sh.transport_name,
      t.sale_code,
      t.currency_code
    FROM public.ic_trans_shipment sh
    JOIN public.ic_trans t
      ON t.doc_no = sh.doc_no
     AND t.trans_flag = sh.trans_flag
     AND t.status = 0
    WHERE EXISTS (
            SELECT 1 FROM public.ic_trans_detail d
            WHERE d.doc_no = sh.doc_no
              AND d.trans_flag = sh.trans_flag
              AND d.wh_code = $1
              AND (d.status = 0 OR d.status IS NULL)
              AND d.item_code IS NOT NULL
              AND d.item_code <> ''
          )
  ) bk
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int                    AS lines,
      count(DISTINCT d.item_code)::int AS items,
      SUM(d.qty)::numeric              AS qty_sum,
      SUM(COALESCE(d.sum_amount, d.qty * d.price))::numeric AS value_sum
    FROM public.ic_trans_detail d
    WHERE d.doc_no = bk.doc_no
      AND d.trans_flag = bk.trans_flag
      AND d.wh_code = $1
      AND (d.status = 0 OR d.status IS NULL)
      AND d.item_code IS NOT NULL
      AND d.item_code <> ''
  ) agg ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      count(*)::int AS tms_total,
      count(*) FILTER (WHERE status = 1)::int AS tms_shipped,
      MAX(sent_end) AS tms_last_sent
    FROM public.odg_tms_detail tms
    WHERE tms.bill_no = bk.doc_no
  ) tms ON TRUE
  LEFT JOIN public.ar_customer cust ON cust.code = bk.cust_code
  LEFT JOIN public.odg_employee sale ON sale.employee_code = bk.sale_code
`;

/**
 * SQL for rebuilding the pending-shipment snapshot for a session, derived
 * from the bills the user picked into `wms_stocktake_pending_bill`.
 *
 * The picked bills' qty is added back to the SML baseline at variance time.
 * Pending is NOT auto-populated on session creation — the user must pick
 * bills explicitly through the pending-bills UI.
 *
 * Parameters: $1 = session_id, $2 = wh_code
 */
export const PENDING_INSERT_SQL = `
  INSERT INTO public.wms_stocktake_pending
    (session_id, item_code, item_name, unit_code, pending_qty)
  SELECT
    $1,
    d.item_code,
    MAX(d.item_name),
    MAX(d.unit_code),
    SUM(d.qty)::numeric
  FROM public.wms_stocktake_pending_bill pb
  JOIN public.ic_trans_detail d
    ON d.doc_no = pb.doc_no
   AND d.trans_flag = pb.trans_flag
  WHERE pb.session_id = $1
    AND d.wh_code = $2
    AND (d.status = 0 OR d.status IS NULL)
    AND d.item_code IS NOT NULL
    AND d.item_code <> ''
  GROUP BY d.item_code
  HAVING SUM(d.qty) <> 0
`;

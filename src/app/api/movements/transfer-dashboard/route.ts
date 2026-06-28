import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Transfer pipeline overview for the warehouses the user owns. Returns the ACTIVE
 * 124 requests (not fully received, not cancelled, last 180 days) with their
 * rollup, so the client can bucket them: awaiting-approval / approved-to-issue /
 * in-transit-to-receive / in-transit-to-return / overdue.
 */
const FLAG = 124;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ rows: [], mine: [] });

  const args: unknown[] = [];
  let whClause = "";
  if (Array.isArray(accessible)) { args.push(accessible); whClause = `AND (h.wh_from = ANY($1) OR h.wh_to = ANY($1))`; }

  // CTE form: aggregate movement + requested-qty ONCE over the bounded candidate
  // set (recent + accessible). ~150x faster than a per-row correlated LATERAL.
  const rows = await query<{
    doc_no: string; doc_date: string | null; want_date: string | null; status: number | null;
    wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null;
    req: string; to_transit: string; in_transit: string; received: string;
    created_at: string | null; issued_at: string | null; received_at: string | null;
  }>(
    `WITH cand AS (
       SELECT h.doc_no, h.wh_from, h.wh_to, COALESCE(h.status,0) AS status, h.doc_date, h.want_date, h.create_date_time_now
       FROM public.ic_trans h
       WHERE h.trans_flag = ${FLAG} AND COALESCE(h.is_cancel,0) = 0 AND h.doc_date >= CURRENT_DATE - 180
       ${whClause}
     ),
     mv AS (
       SELECT d.doc_ref,
              SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = '9903') AS to_transit,
              SUM(d.qty * d.calc_flag) FILTER (WHERE d.wh_code = '9903') AS in_transit,
              SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = c.wh_to) AS received,
              MIN(d.create_date_time_now) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = '9903') AS issued_at,
              MIN(d.create_date_time_now) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = c.wh_to) AS received_at
       FROM public.odg_wms_trans_detail d
       JOIN cand c ON c.doc_no = d.doc_ref
       WHERE d.trans_flag = 72
       GROUP BY d.doc_ref
     ),
     req AS (
       SELECT x.doc_no, SUM(x.qty) AS req
       FROM public.ic_trans_detail x JOIN cand c ON c.doc_no = x.doc_no
       WHERE x.trans_flag = ${FLAG} GROUP BY x.doc_no
     )
     SELECT c.doc_no, to_char(c.doc_date,'YYYY-MM-DD') AS doc_date, to_char(c.want_date,'YYYY-MM-DD') AS want_date,
            c.status, c.wh_from, c.wh_to, wf.name_1 AS wh_from_name, wt.name_1 AS wh_to_name,
            COALESCE(r.req,0)::numeric::text AS req,
            COALESCE(m.to_transit,0)::numeric::text AS to_transit,
            COALESCE(m.in_transit,0)::numeric::text AS in_transit,
            COALESCE(m.received,0)::numeric::text AS received,
            to_char(COALESCE(c.create_date_time_now, c.doc_date::timestamp), 'YYYY-MM-DD HH24:MI:SS') AS created_at,
            to_char(m.issued_at, 'YYYY-MM-DD HH24:MI:SS') AS issued_at,
            to_char(m.received_at, 'YYYY-MM-DD HH24:MI:SS') AS received_at
     FROM cand c
     LEFT JOIN public.ic_warehouse wf ON wf.code = c.wh_from
     LEFT JOIN public.ic_warehouse wt ON wt.code = c.wh_to
     LEFT JOIN mv m ON m.doc_ref = c.doc_no
     LEFT JOIN req r ON r.doc_no = c.doc_no
     WHERE c.status = 0
        OR COALESCE(m.in_transit,0) > 0.0001
        OR (c.status = 1 AND COALESCE(m.received,0) < COALESCE(r.req,0))
     ORDER BY c.doc_no DESC LIMIT 500`,
    args,
  );

  return NextResponse.json({ rows, mine: accessible });
}

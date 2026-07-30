import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ຄົ້ນຫາ "ສິນຄ້າ" ຢູ່ໜ້າ Dashboard ການໂອນ — ບອກວ່າ ລະຫັດ/ຊື່ ສິນຄ້ານີ້ ຍັງຄ້າງຢູ່ໃບໂອນໃດ.
 *
 * Searches the ic_trans_detail lines of the same candidate set the dashboard
 * uses (trans_flag 124, not cancelled, last 180 days, accessible warehouses)
 * and returns the matching lines with their per-item rollup. The client
 * intersects the doc_no set with the rows it already holds, so only ACTIVE
 * (unfinished) documents surface.
 *
 * Query: ?q=<item code or name>
 * Returns: { matches: [{ doc_no, item_code, item_name, unit_code, req,
 *            to_transit, in_transit, received }] }
 */
const FLAG = 124;
const MOVE_FLAG = 72;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ matches: [] });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ matches: [] });

  const args: unknown[] = [`%${escapeLike(q)}%`];
  let whClause = "";
  if (Array.isArray(accessible)) { args.push(accessible); whClause = `AND (h.wh_from = ANY($2) OR h.wh_to = ANY($2))`; }

  const matches = await query<{
    doc_no: string; item_code: string; item_name: string | null; unit_code: string | null;
    req: string; to_transit: string; in_transit: string; received: string;
  }>(
    `WITH cand AS (
       SELECT h.doc_no, h.wh_to
       FROM public.ic_trans h
       WHERE h.trans_flag = ${FLAG} AND COALESCE(h.is_cancel,0) = 0 AND h.doc_date >= CURRENT_DATE - 180
       ${whClause}
     ),
     hit AS (
       SELECT x.doc_no, x.item_code, MAX(x.item_name) AS item_name, MAX(x.unit_code) AS unit_code,
              SUM(x.qty) AS req
       FROM public.ic_trans_detail x JOIN cand c ON c.doc_no = x.doc_no
       WHERE x.trans_flag = ${FLAG}
         AND (x.item_code ILIKE $1 ESCAPE '\\' OR x.item_name ILIKE $1 ESCAPE '\\')
       GROUP BY x.doc_no, x.item_code
     ),
     mv AS (
       SELECT w.doc_ref, w.item_code,
              SUM(w.qty) FILTER (WHERE w.calc_flag = 1 AND w.wh_code = '9903') AS to_transit,
              SUM(w.qty * w.calc_flag) FILTER (WHERE w.wh_code = '9903') AS in_transit,
              SUM(w.qty) FILTER (WHERE w.calc_flag = 1 AND w.wh_code = c.wh_to) AS received
       FROM public.odg_wms_trans_detail w
       JOIN hit t ON t.doc_no = w.doc_ref AND t.item_code = w.item_code
       JOIN cand c ON c.doc_no = w.doc_ref
       WHERE w.trans_flag = ${MOVE_FLAG}
       GROUP BY w.doc_ref, w.item_code
     )
     SELECT t.doc_no, t.item_code, t.item_name, t.unit_code,
            t.req::numeric::text AS req,
            COALESCE(m.to_transit,0)::numeric::text AS to_transit,
            COALESCE(m.in_transit,0)::numeric::text AS in_transit,
            COALESCE(m.received,0)::numeric::text AS received
     FROM hit t
     LEFT JOIN mv m ON m.doc_ref = t.doc_no AND m.item_code = t.item_code
     ORDER BY t.doc_no DESC, t.item_code
     LIMIT 2000`,
    args,
  );

  return NextResponse.json({ matches });
}

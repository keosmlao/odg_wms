import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * JSON adjustment history (the audit trail the web renders server-side).
 * Each document carries its evidence — date, who, reason — plus its lines
 * (before → after → diff). Scoped to the session's accessible warehouses.
 *
 * Query: ?wh=&from=&to=&q=&page=  (page size 20)
 */
const PAGE_SIZE = 20;

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  doc_type: string | null;
  note: string | null;
  wh_code: string | null;
  wh_name: string | null;
  creator_code: string | null;
  creator_name: string | null;
  line_count: number;
};

type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  shelf_code: string | null;
  box_code: string | null;
  before_qty: string;
  counted_qty: string;
  diff_qty: string;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ docs: [], total: 0, page: 1 });
  }

  const url = new URL(request.url);
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const from = (url.searchParams.get("from") ?? "").trim();
  const to = (url.searchParams.get("to") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  // Warehouse is embedded as a "[wh] note" prefix in the header remark.
  const docsCte = `
    docs AS (
      SELECT
        h.doc_no,
        to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
        h.doc_time,
        h.doc_type,
        h.creator_code,
        CASE
          WHEN left(h.remark, 1) = '[' AND position(']' in h.remark) > 1
          THEN NULLIF(substring(h.remark from 2 for position(']' in h.remark) - 2), '')
          ELSE NULL
        END AS wh_code,
        CASE
          WHEN left(h.remark, 1) = '[' AND position(']' in h.remark) > 0
          THEN NULLIF(btrim(substring(h.remark from position(']' in h.remark) + 1)), '')
          ELSE NULLIF(btrim(h.remark), '')
        END AS note,
        e.fullname_lo AS creator_name
      FROM public.wms_product_adj_stock h
      LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
    )`;

  const where: string[] = [];
  const args: unknown[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`d.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`d.wh_code = $${args.length}`);
  }
  if (from) {
    args.push(from);
    where.push(`d.doc_date >= $${args.length}`);
  }
  if (to) {
    args.push(to);
    where.push(`d.doc_date <= $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(
      `(d.doc_no ILIKE $${i} OR d.creator_name ILIKE $${i} OR d.creator_code ILIKE $${i} OR d.note ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM public.wms_product_adj_stock_detail x
          LEFT JOIN public.ic_inventory i2 ON i2.code = x.item_code
          WHERE x.doc_no = d.doc_no AND (x.item_code ILIKE $${i} OR i2.name_1 ILIKE $${i})
        ))`,
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [countRows, docs] = await Promise.all([
    query<{ n: number }>(`WITH ${docsCte} SELECT count(*)::int AS n FROM docs d ${whereSql}`, args),
    query<DocRow>(
      `WITH ${docsCte}
       SELECT d.doc_no, d.doc_date, d.doc_time, d.doc_type, d.note, d.wh_code,
              w.name_1 AS wh_name, d.creator_code, d.creator_name,
              COALESCE(agg.line_count, 0) AS line_count
       FROM docs d
       LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
       LEFT JOIN (
         SELECT doc_no, count(*)::int AS line_count
         FROM public.wms_product_adj_stock_detail GROUP BY doc_no
       ) agg ON agg.doc_no = d.doc_no
       ${whereSql}
       ORDER BY d.doc_date DESC NULLS LAST, d.doc_time DESC NULLS LAST, d.doc_no DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE],
    ),
  ]);

  const docNos = docs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT x.doc_no, x.item_code, i.name_1 AS item_name, x.unit_code,
                x.shelf_code, x.box_code,
                x.current_qty::text AS before_qty,
                x.qty::text         AS counted_qty,
                x.diff_qty::text    AS diff_qty
         FROM public.wms_product_adj_stock_detail x
         LEFT JOIN public.ic_inventory i ON i.code = x.item_code
         WHERE x.doc_no = ANY($1)
         ORDER BY x.doc_no, x.roworder`,
        [docNos],
      )
    : [];

  const linesByDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.doc_no);
    if (arr) arr.push(l);
    else linesByDoc.set(l.doc_no, [l]);
  }

  return NextResponse.json({
    total: countRows[0]?.n ?? 0,
    page,
    page_size: PAGE_SIZE,
    docs: docs.map((d) => ({ ...d, lines: linesByDoc.get(d.doc_no) ?? [] })),
  });
}

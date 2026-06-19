import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * WMS goods-receipt history (header + lines) for mobile, scoped to accessible
 * warehouses. Query: ?wh=&q=&page=  (page size 20)
 */
const PAGE_SIZE = 20;

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  wh_code: string | null;
  wh_name: string | null;
  supplier_code: string | null;
  po_no: string | null;
  remark: string | null;
  creator_code: string | null;
  creator_name: string | null;
  line_count: number;
  total_qty: string;
};
type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  box_code: string | null;
  shelf_code: string | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ docs: [] });
  }

  const url = new URL(request.url);
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);

  const where: string[] = [];
  const args: unknown[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`h.warehouse_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`h.warehouse_code = $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(`(h.doc_no ILIKE $${i} OR h.ref_doc_no ILIKE $${i} OR h.supplier_code ILIKE $${i})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const docs = await query<DocRow>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no, h.remark, h.creator_code, e.fullname_lo AS creator_name,
            COALESCE(agg.line_count,0) AS line_count, COALESCE(agg.total_qty,0)::text AS total_qty
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     LEFT JOIN (SELECT doc_no, count(*)::int AS line_count, SUM(qty) AS total_qty
                FROM public.wms_product_receive_detail GROUP BY doc_no) agg ON agg.doc_no = h.doc_no
     ${whereSql}
     ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  );

  const docNos = docs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT doc_no, item_code, item_name, unit_code, qty::text AS qty, box_code, shelf_code
         FROM public.wms_product_receive_detail WHERE doc_no = ANY($1) ORDER BY doc_no, roworder`,
        [docNos],
      )
    : [];
  const byDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const a = byDoc.get(l.doc_no);
    if (a) a.push(l);
    else byDoc.set(l.doc_no, [l]);
  }

  // Generated ISN per receive (from the serial ledger, doc_no = receive code).
  const serials = docNos.length
    ? await query<{ doc_no: string; item_code: string; sn: string }>(
        `SELECT doc_no, item_code, sn FROM public.sn_trans_detail
         WHERE doc_no = ANY($1) ORDER BY doc_no, item_code, sn`,
        [docNos],
      )
    : [];
  const snByDoc = new Map<string, { item_code: string; sn: string }[]>();
  for (const s of serials) {
    const a = snByDoc.get(s.doc_no);
    if (a) a.push({ item_code: s.item_code, sn: s.sn });
    else snByDoc.set(s.doc_no, [{ item_code: s.item_code, sn: s.sn }]);
  }

  return NextResponse.json({
    page,
    docs: docs.map((d) => ({
      ...d,
      lines: byDoc.get(d.doc_no) ?? [],
      serials: snByDoc.get(d.doc_no) ?? [],
    })),
  });
}

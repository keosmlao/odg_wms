import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { PACKING_STATUS } from "@/lib/packingList";

/**
 * ລາຍການໃບ packing ທີ່ນຳເຂົ້າແລ້ວ (scoped ຕາມສິດສາງ).
 *   GET ?wh=&status=&date=&q=&limit=
 *   status: ວ່າງ = ທີ່ຍັງໃຊ້ໄດ້ (draft+verified) · 'all' · ຫຼື ຕົວເລກ
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ docs: [] });

  const url = new URL(request.url);
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const status = (url.searchParams.get("status") ?? "").trim();
  const date = (url.searchParams.get("date") ?? "").trim();
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); where.push(sql.replaceAll("$?", `$${params.length}`)); };

  if (Array.isArray(accessible)) add("h.wh_code = ANY($?)", accessible);
  if (wh) add("h.wh_code = $?", wh);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) add("h.doc_date = $?::date", date);
  if (status === "all") { /* no filter */ }
  else if (/^\d+$/.test(status)) add("h.status = $?", Number.parseInt(status, 10));
  else add("h.status = ANY($?)", [PACKING_STATUS.draft, PACKING_STATUS.verified]);
  if (q) add("(h.doc_no ILIKE '%'||$?||'%' OR h.ref_no ILIKE '%'||$?||'%' OR h.supplier_name ILIKE '%'||$?||'%')", q);

  params.push(limit);
  const docs = await query(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.wh_code, w.name_1 AS wh_name,
            h.ref_no, h.supplier_code, h.supplier_name, h.status, h.line_count,
            h.total_qty::text AS total_qty, h.error_count, h.warn_count, h.remark,
            h.count_doc_no, h.creator_code, e.fullname_lo AS creator_name,
            to_char(h.create_date_time_now,'YYYY-MM-DD HH24:MI') AS created_at,
            COALESCE(po.po_list, ARRAY[]::text[]) AS po_list,
            COALESCE(f.file_count, 0) AS file_count
       FROM public.wms_packing_list h
       LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
       LEFT JOIN (SELECT doc_no, array_agg(DISTINCT po_no) AS po_list
                    FROM public.wms_packing_list_detail WHERE po_no IS NOT NULL GROUP BY doc_no) po
              ON po.doc_no = h.doc_no
       LEFT JOIN (SELECT doc_no, count(*)::int AS file_count
                    FROM public.wms_packing_list_file GROUP BY doc_no) f ON f.doc_no = h.doc_no
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY h.doc_date DESC, h.doc_no DESC
      LIMIT $${params.length}`,
    params,
  );
  return NextResponse.json({ docs });
}

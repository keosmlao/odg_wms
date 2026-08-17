import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * List PENDING goods-issue drafts (wms_product_out, status = 0) for the caller's
 * accessible warehouses — the queue waiting to be scan-confirmed (stage 2).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const accessible = accessibleWarehouses(session);
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [];
  const where: string[] = ["o.status = 0"];
  if (wh) { args.push(wh); where.push(`o.warehouse_code = $${args.length}`); }
  else if (Array.isArray(accessible)) {
    if (accessible.length === 0) return NextResponse.json({ docs: [] });
    args.push(accessible); where.push(`o.warehouse_code = ANY($${args.length})`);
  }

  const docs = await query<{
    doc_no: string; doc_date: string | null; doc_time: string | null; warehouse_code: string | null;
    ref_doc_no: string | null; doc_type: number | null; customer_code: string | null;
    creator_code: string | null; remark: string | null; line_count: number; serial_count: number; total_qty: string;
    trip_doc_no: string | null; trip_car: string | null; trip_car_name: string | null;
  }>(
    `SELECT o.doc_no, to_char(o.doc_date, 'YYYY-MM-DD') AS doc_date, o.doc_time,
            o.warehouse_code, o.ref_doc_no, o.doc_type, o.customer_code, o.creator_code, o.remark,
            -- ໃບທີ່ດຶງມາຈາກໃບຈັດຖ້ຽວຂອງຂົນສົ່ງ → ສະແດງເປັນຖ້ຽວດຽວກັນຢູ່ໜ້າຢືນຢັນ
            pt.trip_doc_no, pt.car AS trip_car, ca.name_1 AS trip_car_name,
            (SELECT count(*)::int FROM public.wms_product_out_detail d WHERE d.doc_no = o.doc_no) AS line_count,
            (SELECT COALESCE(SUM(d.qty),0) FROM public.wms_product_out_detail d WHERE d.doc_no = o.doc_no)::numeric::text AS total_qty,
            (SELECT count(*)::int FROM public.wms_product_out_serial_detail s WHERE s.ref_out_doc = o.doc_no) AS serial_count
     FROM public.wms_product_out o
     LEFT JOIN public.wms_pick_trip pt ON pt.doc_no = o.doc_no
     LEFT JOIN public.odg_tms_car ca ON ca.code = pt.car
     WHERE ${where.join(" AND ")}
     ORDER BY o.doc_no DESC
     LIMIT 200`,
    args,
  );
  return NextResponse.json({ docs });
}

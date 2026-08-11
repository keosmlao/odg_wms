import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Pending source documents to issue against, read from the ERP transaction table
 * `ic_trans` / `ic_trans_detail`. Three kinds, by trans_flag:
 *   req      = 122 ໃບຂໍເບີກສິນຄ້າ (issue request)
 *   transfer = 124 ໃບຂໍໂອນສິນຄ້າ (transfer request)
 *   sale     = 44  ບິນຂາຍ (sales bill)
 *
 * "Remaining" nets the document's ordered quantity against what WMS has already
 * issued for it (odg_wms_trans_detail rows with doc_ref = the source doc_no and
 * the issue trans_flag), the mirror of how goods-receipt nets a PO.
 *
 * Query: ?wh=<code>&type=req|transfer|sale&q=&days=&limit=
 * Returns: { docs:[{ doc_no, doc_date, cust_code, cust_name, remark, line_count,
 *            remaining_qty }] }
 */
const FLAG_BY_TYPE: Record<string, number> = { req: 122, transfer: 124, sale: 44 };
const ISSUE_STOCK_FLAG = 72; // odg_wms_trans_detail flag written by the issue route

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const type = url.searchParams.get("type")?.trim() ?? "req";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get("days") ?? "90", 10) || 90, 1), 730);
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);

  const flag = FLAG_BY_TYPE[type];
  if (flag === undefined) return NextResponse.json({ error: "ປະເພດເອກະສານບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [flag, wh, days];
  let searchSql = "";
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    searchSql = `AND (d.doc_no ILIKE $${args.length} ESCAPE '\\' OR d.item_code ILIKE $${args.length} ESCAPE '\\' OR d.item_name ILIKE $${args.length} ESCAPE '\\')`;
  }
  args.push(limit);
  const limitIdx = args.length;

  const docs = await query<{
    doc_no: string;
    doc_date: string | null;
    doc_time: string | null;
    cust_code: string | null;
    cust_name: string | null;
    remark: string | null;
    line_count: number;
    remaining_qty: string;
    aging_days: number | null;
    want_date: string | null;
    created_at: string | null;
    pending_qty: string;
  }>(
    `WITH src AS (
       SELECT d.doc_no,
              count(*)::int AS line_count,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       WHERE d.trans_flag = $1
         AND d.wh_code = $2
         AND (d.status = 0 OR d.status IS NULL)
         AND d.doc_date >= CURRENT_DATE - ($3::int)
         AND d.item_code NOT LIKE '97%'  -- ໝວດ 97 ບໍ່ຈ່າຍອອກສາງ
         ${searchSql}
       GROUP BY d.doc_no
     ),
     issued AS (
       -- ນັບเฉพาะขาออกจากต้นทาง (calc_flag −1, ไม่ใช่ขา +1 เข้าสางกลาง 9903)
       SELECT w.doc_ref AS doc_no, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       WHERE w.trans_flag = ${ISSUE_STOCK_FLAG}
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '9903'
         AND w.doc_ref IN (SELECT doc_no FROM src)
       GROUP BY w.doc_ref
     ),
     -- ໃບສັ່ງຈ່າຍ (pick) ທີ່ສ້າງແລ້ວ ລໍຖ້າຢືນຢັນ (status 0) — ຫักออกจากค้างทันที
     -- ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) ເກັບບິນຕົ້ນທາງໄວ້ລະດັບແຖວ → ໃຊ້ d.ref_doc_no ກ່ອນ.
     pending AS (
       SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS doc_no, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0
         AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) IN (SELECT doc_no FROM src)
       GROUP BY 1
     )
     SELECT s.doc_no,
            to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
            h.doc_time,
            h.cust_code,
            cu.name_1 AS cust_name,
            h.remark,
            s.line_count,
            (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS remaining_qty,
            -- ຢູ່ໃນໃບ pick ຄ້າງຢືນຢັນ — ຫັກອອກຈາກ remaining_qty ແລ້ວ, ສົ່ງອອກໄປໃຫ້ UI ບອກຜູ້ໃຊ້
            COALESCE(pd.pend_qty, 0)::numeric::text AS pending_qty,
            (CURRENT_DATE - h.doc_date)::int AS aging_days,
            to_char(h.want_date, 'YYYY-MM-DD') AS want_date,
            to_char(COALESCE(h.create_date_time_now, h.doc_date::timestamp + COALESCE(NULLIF(h.doc_time, '')::time, '00:00'::time)), 'YYYY-MM-DD HH24:MI:SS') AS created_at
     FROM src s
     JOIN public.ic_trans h ON h.doc_no = s.doc_no AND h.trans_flag = $1
     LEFT JOIN issued i ON i.doc_no = s.doc_no
     LEFT JOIN pending pd ON pd.doc_no = s.doc_no
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     WHERE COALESCE(h.is_cancel, 0) = 0
       -- ໃບຂໍໂອນ (124) ບໍ່ຕ້ອງລໍການອະນຸມັດອີກຕໍ່ໄປ — ລໍຖ້າ (0) ຫຼື ອະນຸມັດ (1) ຈ່າຍໄດ້ເລີຍ.
       -- ກັນໄວ້ສະເພາະໃບທີ່ຖືກ "ປฏิเสธ" (2) ເພາະນັ້ນຄືການປະຕິເສດໂດຍເຈດຕະນາ.
       AND (h.trans_flag <> 124 OR COALESCE(h.status, 0) <> 2)
       AND (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
     ORDER BY h.doc_date DESC, s.doc_no DESC
     LIMIT $${limitIdx}`,
    args,
  );

  // Per-item lines for the listed docs (netted), so each card can show its
  // contents inline — like the goods-receipt bill cards.
  const docNos = docs.map((d) => d.doc_no);
  const lineRows = docNos.length
    ? await query<{
        doc_no: string;
        item_code: string;
        item_name: string | null;
        unit_code: string | null;
        remaining: string;
      }>(
        `WITH src AS (
           SELECT d.doc_no, d.item_code, MAX(d.item_name) AS item_name, MAX(d.unit_code) AS unit_code,
                  SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
           FROM public.ic_trans_detail d
           WHERE d.doc_no = ANY($1) AND d.trans_flag = $2 AND d.wh_code = $3
             AND (d.status = 0 OR d.status IS NULL)
           GROUP BY d.doc_no, d.item_code
         ),
         issued AS (
           SELECT w.doc_ref AS doc_no, w.item_code, SUM(w.qty) AS wms_qty
           FROM public.odg_wms_trans_detail w
           WHERE w.doc_ref = ANY($1) AND w.trans_flag = ${ISSUE_STOCK_FLAG}
             AND (w.status = 0 OR w.status IS NULL)
             AND w.calc_flag = -1 AND w.wh_code <> '9903'
           GROUP BY w.doc_ref, w.item_code
         ),
         pending AS (
           SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS doc_no, d.item_code, SUM(d.qty) AS pend_qty
           FROM public.wms_product_out o
           JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
           WHERE COALESCE(o.status, 0) = 0
             AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) = ANY($1)
           GROUP BY 1, d.item_code
         )
         SELECT s.doc_no, s.item_code, s.item_name, s.unit_code,
                (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS remaining
         FROM src s
         LEFT JOIN issued i ON i.doc_no = s.doc_no AND i.item_code = s.item_code
         LEFT JOIN pending pd ON pd.doc_no = s.doc_no AND pd.item_code = s.item_code
         WHERE (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
         ORDER BY s.doc_no, s.item_code`,
        [docNos, flag, wh],
      )
    : [];

  const linesByDoc = new Map<string, { item_code: string; item_name: string | null; unit_code: string | null; remaining: string }[]>();
  for (const r of lineRows) {
    const arr = linesByDoc.get(r.doc_no);
    const entry = { item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code, remaining: r.remaining };
    if (arr) arr.push(entry);
    else linesByDoc.set(r.doc_no, [entry]);
  }

  return NextResponse.json({
    docs: docs.map((d) => ({ ...d, lines: linesByDoc.get(d.doc_no) ?? [] })),
  });
}

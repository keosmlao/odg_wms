import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";

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
 * Query: ?type=req|transfer|sale&q=&days=&limit=  (`wh` optional — ບໍ່ສົ່ງ = ທຸກສາງ
 * ທີ່ຜູ້ໃຊ້ມີສິດ; ໜ້າຈໍບໍ່ໃຫ້ເລືອກສາງແລ້ວ ແຕ່ຮັບໄວ້ໃຫ້ deep-link ເກົ່າ)
 * Returns: { warehouses:[{code,name}],
 *            docs:[{ doc_no, wh_code, doc_date, cust_code, cust_name, remark,
 *            line_count, remaining_qty }] }
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
  // ໂຫຼດເປັນຊຸດ (infinite scroll): ໜ້າຈໍດຶງ 20 ໃບກ່ອນ ແລ້ວຄ່ອຍດຶງເພີ່ມເມື່ອເລື່ອນລົງ.
  // ດຶງເກີນມາ 1 ແຖວແລ້ວຕັດຖິ້ມ — ຮູ້ວ່າ "ຍັງມີຕໍ່" ໂດຍບໍ່ຕ້ອງນັບທັງໝົດ
  // (ການນັບທັງໝົດຄື aggregate ອັນດຽວກັນທີ່ໜັກຢູ່ແລ້ວ).
  const offset = Math.max(Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const flag = FLAG_BY_TYPE[type];
  if (flag === undefined) return NextResponse.json({ error: "ປະເພດເອກະສານບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const warehouses = await scopedWarehouses(session, wh);
  if (warehouses.length === 0) return NextResponse.json({ warehouses: [], docs: [] });
  const whCodes = warehouses.map((w) => w.code);

  const args: unknown[] = [flag, whCodes, days];
  let searchSql = "";
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    searchSql = `AND (d.doc_no ILIKE $${args.length} ESCAPE '\\' OR d.item_code ILIKE $${args.length} ESCAPE '\\' OR d.item_name ILIKE $${args.length} ESCAPE '\\')`;
  }
  args.push(limit + 1);
  const limitIdx = args.length;
  args.push(offset);
  const offsetIdx = args.length;

  const docs = await query<{
    doc_no: string;
    wh_code: string;
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
              d.wh_code,
              count(*)::int AS line_count,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       -- ວັນທີເລີ່ມໃຊ້ WMS ຕໍ່ສາງ (migration 043). ການເປີດໃຊ້ເປັນການທະຍອຍ
       -- ເປີດເປັນສາງໆ — ບິນທີ່ລົງວັນທີກ່ອນສາງນັ້ນເລີ່ມ ຖືວ່າຈັດການໄປແລ້ວ
       -- ນອກລະບົບ ຈຶ່ງບໍ່ຄວນຄ້າງເຕັມລາຍການຈົນຫາບິນຈິງບໍ່ພົບ.
       -- LEFT JOIN + IS NULL: ສາງທີ່ບໍ່ໄດ້ຕັ້ງວັນທີໄວ້ ຍັງເຮັດວຽກຄືເກົ່າທຸກປະການ.
       LEFT JOIN public.odg_wms_warehouse_config wc ON wc.wh_code = d.wh_code
       WHERE d.trans_flag = $1
         AND d.wh_code = ANY($2)
         AND (d.status = 0 OR d.status IS NULL)
         AND d.doc_date >= CURRENT_DATE - ($3::int)
         AND (wc.wms_start_date IS NULL OR d.doc_date >= wc.wms_start_date)
         AND d.item_code NOT LIKE '97%'  -- ໝວດ 97 ບໍ່ຈ່າຍອອກສາງ
         ${searchSql}
       GROUP BY d.doc_no, d.wh_code
     ),
     issued AS (
       -- ນັບສະເພາະຂາອອກຈາກຕົ້ນທາງ (calc_flag −1, ບໍ່ແມ່ນຂາ +1 ເຂົ້າສາງກາງ 9903)
       SELECT w.doc_ref AS doc_no, w.wh_code, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       WHERE w.trans_flag = ${ISSUE_STOCK_FLAG}
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '9903'
         AND w.doc_ref IN (SELECT doc_no FROM src)
       GROUP BY w.doc_ref, w.wh_code
     ),
     -- ໃບສັ່ງຈ່າຍ (pick) ທີ່ສ້າງແລ້ວ ລໍຖ້າຢືນຢັນ (status 0) — ຫັກອອກຈາກຄ້າງທັນທີ
     -- ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) ເກັບບິນຕົ້ນທາງໄວ້ລະດັບແຖວ → ໃຊ້ d.ref_doc_no ກ່ອນ.
     pending AS (
       SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS doc_no,
              o.warehouse_code AS wh_code, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0
         AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) IN (SELECT doc_no FROM src)
       GROUP BY 1, 2
     )
     SELECT s.doc_no,
            s.wh_code,
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
     LEFT JOIN issued i ON i.doc_no = s.doc_no AND i.wh_code = s.wh_code
     LEFT JOIN pending pd ON pd.doc_no = s.doc_no AND pd.wh_code = s.wh_code
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     WHERE COALESCE(h.is_cancel, 0) = 0
       -- ໃບຂໍໂອນ (124) ບໍ່ຕ້ອງລໍການອະນຸມັດອີກຕໍ່ໄປ — ລໍຖ້າ (0) ຫຼື ອະນຸມັດ (1) ຈ່າຍໄດ້ເລີຍ.
       -- ກັນໄວ້ສະເພາະໃບທີ່ຖືກ "ປະຕິເສດ" (2) ເພາະນັ້ນຄືການປະຕິເສດໂດຍເຈດຕະນາ.
       AND (h.trans_flag <> 124 OR COALESCE(h.status, 0) <> 2)
       AND (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
     ORDER BY s.wh_code, h.doc_date DESC, s.doc_no DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    args,
  );

  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;

  // Per-item lines for the listed docs (netted), so each card can show its
  // contents inline — like the goods-receipt bill cards.
  const docNos = [...new Set(pageDocs.map((d) => d.doc_no))];
  const lineRows = docNos.length
    ? await query<{
        doc_no: string;
        wh_code: string;
        item_code: string;
        item_name: string | null;
        unit_code: string | null;
        remaining: string;
        on_hand: string;
      }>(
        `WITH src AS (
           SELECT d.doc_no, d.wh_code, d.item_code, MAX(d.item_name) AS item_name, MAX(d.unit_code) AS unit_code,
                  SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
           FROM public.ic_trans_detail d
           WHERE d.doc_no = ANY($1) AND d.trans_flag = $2 AND d.wh_code = ANY($3)
             AND (d.status = 0 OR d.status IS NULL)
           GROUP BY d.doc_no, d.wh_code, d.item_code
         ),
         issued AS (
           SELECT w.doc_ref AS doc_no, w.wh_code, w.item_code, SUM(w.qty) AS wms_qty
           FROM public.odg_wms_trans_detail w
           WHERE w.doc_ref = ANY($1) AND w.trans_flag = ${ISSUE_STOCK_FLAG}
             AND (w.status = 0 OR w.status IS NULL)
             AND w.calc_flag = -1 AND w.wh_code <> '9903'
           GROUP BY w.doc_ref, w.wh_code, w.item_code
         ),
         pending AS (
           SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS doc_no,
                  o.warehouse_code AS wh_code, d.item_code, SUM(d.qty) AS pend_qty
           FROM public.wms_product_out o
           JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
           WHERE COALESCE(o.status, 0) = 0
             AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) = ANY($1)
           GROUP BY 1, 2, d.item_code
         )
         ,
         -- ຄົງເຫຼືອຈິງໃນສາງຕໍ່ສິນຄ້າ — ໃຊ້ຕັດສິນວ່າໃບນີ້ "ພ້ອມຢິບ" ຫຼືບໍ່.
         -- ບໍ່ກອງ status ໂດຍເຈດຕະນາ (status=1 ຄືຂາອອກຂອງການຍ້າຍບ່ອນພາຍໃນ
         -- ບໍ່ແມ່ນການຍົກເລີກ) — ກົດດຽວກັບ lib/issueCore.ts ແລະ ໜ້າຄົງເຫຼືອ.
         -- ໄວໄດ້ຍ້ອນ index (item_code, wh_code) ຈາກ migration 045.
         onhand AS (
           SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag) AS q
             FROM public.odg_wms_trans_detail t
            WHERE t.wh_code = ANY($3)
              AND t.item_code IN (SELECT item_code FROM src)
            GROUP BY 1, 2
         )
         SELECT s.doc_no, s.wh_code, s.item_code, s.item_name, s.unit_code,
                (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS remaining,
                GREATEST(COALESCE(oh.q, 0), 0)::numeric::text AS on_hand
         FROM src s
         LEFT JOIN issued i ON i.doc_no = s.doc_no AND i.wh_code = s.wh_code AND i.item_code = s.item_code
         LEFT JOIN pending pd ON pd.doc_no = s.doc_no AND pd.wh_code = s.wh_code AND pd.item_code = s.item_code
         LEFT JOIN onhand oh ON oh.wh_code = s.wh_code AND oh.item_code = s.item_code
         WHERE (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
         ORDER BY s.doc_no, s.item_code`,
        [docNos, flag, whCodes],
      )
    : [];

  const linesByDoc = new Map<string, { item_code: string; item_name: string | null; unit_code: string | null; remaining: string }[]>();
  /**
   * ສະຖານະຄວາມພ້ອມຂອງແຕ່ລະໃບ — ແນວຄິດ "Ready" ຂອງ Odoo.
   *
   *   ready   ຂອງມີພໍທຸກລາຍການ — ໄປຢິບໄດ້ເລີຍ
   *   partial ຂອງມີບາງສ່ວນ — ຢິບໄດ້ເທົ່າທີ່ມີ
   *   waiting ບໍ່ມີຂອງເລີຍ — ລໍຮັບເຂົ້າກ່ອນ
   *
   * ເມື່ອກ່ອນຄົນຮູ້ວ່າຂອງບໍ່ພໍ **ຕໍ່ເມື່ອເປີດໃບເຂົ້າໄປສ້າງ pick ແລ້ວ** ເສຍເວລາ
   * ທັງເປີດທັງປິດ. ຄິດຢູ່ນີ້ຈຶ່ງເຫັນໄດ້ຕັ້ງແຕ່ຢູ່ໃນລາຍການ.
   *
   * ຄິດຕໍ່ລາຍການແລ້ວຈຶ່ງລວມ ບໍ່ແມ່ນທຽບຍອດລວມ — ໃບທີ່ມີ A ຢູ່ 100 ແຕ່ຂາດ B
   * ໜຶ່ງໜ່ວຍ ບໍ່ແມ່ນໃບທີ່ "ພ້ອມ".
   */
  const readyByDoc = new Map<string, { available: number; needed: number }>();
  for (const r of lineRows) {
    const k = `${r.doc_no} ${r.wh_code}`;
    const arr = linesByDoc.get(k);
    const entry = { item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code, remaining: r.remaining };
    if (arr) arr.push(entry);
    else linesByDoc.set(k, [entry]);

    const need = Number.parseFloat(r.remaining) || 0;
    const have = Number.parseFloat(r.on_hand) || 0;
    const acc = readyByDoc.get(k) ?? { available: 0, needed: 0 };
    acc.needed += need;
    acc.available += Math.min(need, have);
    readyByDoc.set(k, acc);
  }

  const readinessOf = (key: string): "ready" | "partial" | "waiting" | "unknown" => {
    const a = readyByDoc.get(key);
    if (!a || a.needed <= 0) return "unknown";
    if (a.available >= a.needed - 1e-6) return "ready";
    return a.available > 1e-6 ? "partial" : "waiting";
  };

  return NextResponse.json({
    warehouses,
    docs: pageDocs.map((d) => ({
      ...d,
      readiness: readinessOf(`${d.doc_no} ${d.wh_code}`),
      available_qty: String(readyByDoc.get(`${d.doc_no} ${d.wh_code}`)?.available ?? 0),
      lines: linesByDoc.get(`${d.doc_no} ${d.wh_code}`) ?? [] })),
    /** ຍັງມີໃບຕໍ່ໄປ — ໜ້າຈໍໃຊ້ຄ່ານີ້ຕັດສິນວ່າຈະດຶງຊຸດຕໍ່ໄປເມື່ອເລື່ອນລົງ ຫຼື ບໍ່. */
    has_more: hasMore,
    offset,
    limit,
  });
}

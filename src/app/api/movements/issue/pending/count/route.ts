import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";

/**
 * ຈຳນວນ "ຄ້າງຈ່າຍ" ສຳລັບໜ້າຫຼັກ — ນັບເອກະສານ ແລະ ຈຳນວນ ແຍກຕາມປະເພດ.
 *
 * ໃຊ້ເງື່ອນໄຂ **ອັນດຽວກັນເປັ໊ະ** ກັບ /api/movements/issue/pending (ໄຟລ໌ຂ້າງເທິງ):
 * ຄ້າງ = ຈຳນວນທີ່ຂໍ − ທີ່ WMS ຈ່າຍໄປແລ້ວ − ທີ່ຄ້າງຢູ່ໃບ pick ທີ່ຍັງບໍ່ຢືນຢັນ,
 * ພ້ອມ wms_start_date ຕໍ່ສາງ (migration 043). ຖ້າສອງບ່ອນນີ້ນັບຄົນລະແບບ
 * ຕົວເລກໜ້າຫຼັກຈະບໍ່ຕົງກັບລາຍການທີ່ກົດເຂົ້າໄປເຫັນ ຊຶ່ງແຍ່ກວ່າບໍ່ມີຕົວເລກເລີຍ.
 *
 * ຕ່າງກັນຢູ່ຈຸດດຽວ: ບໍ່ມີ LIMIT ແລະ ບໍ່ດຶງລາຍລະອຽດ — ນັບຢ່າງດຽວ.
 *
 * cache ໃນ process 60 ວິນາທີ ຕໍ່ຂອບເຂດສາງ ເພື່ອບໍ່ໃຫ້ໜ້າຫຼັກຍິງ aggregate
 * ໜັກທຸກເທື່ອທີ່ມີຄົນ refresh (ຮູບແບບດຽວກັບ /api/movements/health).
 */
const FLAGS = [44, 122, 124] as const;
const ISSUE_STOCK_FLAG = 72;
const DAYS = 90;
const TTL_MS = 60 * 1000;

export type PendingCount = {
  /** ບິນຂາຍ 44 · ໃບຂໍເບີກ 122 · ໃບຂໍໂອນ 124 */
  by_type: { sale: TypeCount; req: TypeCount; transfer: TypeCount };
  total_docs: number;
  total_qty: number;
  computed_at: number;
};
type TypeCount = { docs: number; qty: number };

const TYPE_OF: Record<number, keyof PendingCount["by_type"]> = {
  44: "sale",
  122: "req",
  124: "transfer",
};

const cacheStore = ((globalThis as unknown as {
  __wmsPendingCountCache?: Map<string, PendingCount>;
}).__wmsPendingCountCache ??= new Map<string, PendingCount>());

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const warehouses = await scopedWarehouses(session, null);
  const whCodes = warehouses.map((w) => w.code);

  const empty: PendingCount = {
    by_type: { sale: { docs: 0, qty: 0 }, req: { docs: 0, qty: 0 }, transfer: { docs: 0, qty: 0 } },
    total_docs: 0,
    total_qty: 0,
    computed_at: Date.now(),
  };
  if (whCodes.length === 0) return NextResponse.json(empty);

  const cacheKey = whCodes.join(",");
  const hit = cacheStore.get(cacheKey);
  if (hit && Date.now() - hit.computed_at < TTL_MS) {
    return NextResponse.json({ ...hit, cached: true });
  }

  const rows = await query<{ trans_flag: number; docs: number; qty: string }>(
    `WITH src AS (
       SELECT d.trans_flag, d.doc_no, d.wh_code,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       LEFT JOIN public.odg_wms_warehouse_config wc ON wc.wh_code = d.wh_code
       WHERE d.trans_flag = ANY($1)
         AND d.wh_code = ANY($2)
         AND (d.status = 0 OR d.status IS NULL)
         AND d.doc_date >= CURRENT_DATE - ($3::int)
         AND (wc.wms_start_date IS NULL OR d.doc_date >= wc.wms_start_date)
         AND d.item_code NOT LIKE '97%'
       GROUP BY d.trans_flag, d.doc_no, d.wh_code
     ),
     issued AS (
       SELECT w.doc_ref AS doc_no, w.wh_code, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       WHERE w.trans_flag = ${ISSUE_STOCK_FLAG}
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '9903'
         AND w.doc_ref IN (SELECT doc_no FROM src)
       GROUP BY w.doc_ref, w.wh_code
     ),
     pending AS (
       SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) AS doc_no,
              o.warehouse_code AS wh_code, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0
         AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) IN (SELECT doc_no FROM src)
       GROUP BY 1, 2
     )
     SELECT s.trans_flag,
            count(*)::int AS docs,
            SUM(s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS qty
     FROM src s
     JOIN public.ic_trans h ON h.doc_no = s.doc_no AND h.trans_flag = s.trans_flag
     LEFT JOIN issued i ON i.doc_no = s.doc_no AND i.wh_code = s.wh_code
     LEFT JOIN pending pd ON pd.doc_no = s.doc_no AND pd.wh_code = s.wh_code
     WHERE COALESCE(h.is_cancel, 0) = 0
       AND (h.trans_flag <> 124 OR COALESCE(h.status, 0) <> 2)
       AND (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
     GROUP BY s.trans_flag`,
    [[...FLAGS], whCodes, DAYS],
  );

  const out: PendingCount = { ...empty, computed_at: Date.now() };
  for (const r of rows) {
    const key = TYPE_OF[r.trans_flag];
    if (!key) continue;
    const qty = Math.round(Number.parseFloat(r.qty) || 0);
    out.by_type[key] = { docs: r.docs, qty };
    out.total_docs += r.docs;
    out.total_qty += qty;
  }

  cacheStore.set(cacheKey, out);
  return NextResponse.json(out);
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { minStockSummary } from "@/lib/minStock";

/**
 * Lightweight warehouse-health summary for the home control-tower cards:
 *  - dead stock: items still in stock but idle (no outbound) > 90 days
 *  - SN mismatch: (rack, location, pallet, item) nodes where WMS qty != in-stock
 *    serial count, for serial-tracked items — same key as /movements/sn-check
 *  - min stock: items below their configured minimum, in warehouses that opted
 *    into min/max control — same aggregate as /movements/min-stock
 *
 * Scoped to the caller's accessible warehouses. Cached in-process (5-min TTL)
 * keyed by scope so the home page never blocks on the heavier aggregates.
 */
type Health = {
  dead_items: number;
  dead_qty: number;
  sn_mismatch: number;
  min_below: number;
  /**
   * ບ່ອນເກັບ (ສາງ × rack × location × pallet × ສິນຄ້າ) ທີ່ຍອດຄົງເຫຼືອຕິດລົບ.
   *
   * ຍອດຕິດລົບແປວ່າ "ຈ່າຍອອກຫຼາຍກວ່າທີ່ເຄີຍຮັບເຂົ້າ" ຊຶ່ງເປັນໄປບໍ່ໄດ້ໃນຄວາມຈິງ —
   * ມັນສະແດງວ່າມີການເຄື່ອນໄຫວທີ່ບໍ່ໄດ້ບັນທຶກ ຫຼື ບັນທຶກຜິດບ່ອນ. ຕົວເລກນີ້ຄວນ
   * ເປັນ 0 ແລະ ຖ້າມັນເພີ່ມຂຶ້ນ ແປວ່າມີບາງຢ່າງກັດກ້ອນຢູ່ທຸກມື້.
   *
   * ເຝົ້າໄວ້ຢູ່ນີ້ເພາະຕາຕະລາງ odg_wms_trans_detail **ບໍ່ໄດ້ຖືກຂຽນໂດຍແອັບນີ້
   * ຝ່າຍດຽວ** — ການກວດຢູ່ໃນໂຄ້ດຂອງແອັບກັນໄດ້ແຕ່ຜູ້ຂຽນທີ່ຜ່ານແອັບ ສ່ວນການ
   * ນັບຈາກຂໍ້ມູນຈິງແບບນີ້ ເຫັນຄວາມເສຍຫາຍຈາກທຸກຝ່າຍ.
   */
  negative_bins: number;
  negative_qty: number;
  computed_at: number;
};

const TTL_MS = 5 * 60 * 1000;
const cacheStore = (globalThis as unknown as { __wmsHealthCache?: Map<string, Health> }).__wmsHealthCache ??=
  new Map<string, Health>();

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session); // null = all, [] = none, [..] = list
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ dead_items: 0, dead_qty: 0, sn_mismatch: 0, min_below: 0, negative_bins: 0, negative_qty: 0, cached: false });
  }

  const key = accessible === null ? "ALL" : [...accessible].sort().join(",");
  const hit = cacheStore.get(key);
  const now = Date.now();
  if (hit && now - hit.computed_at < TTL_MS) {
    return NextResponse.json({ ...hit, cached: true });
  }

  const whClause = accessible === null ? "" : "AND t.wh_code = ANY($1)";
  const whClauseS = accessible === null ? "" : "AND s.wh_code = ANY($1)";
  const args = accessible === null ? [] : [accessible];

  const [deadRows, mismatchRows, minStock, negRows] = await Promise.all([
    query<{ dead_items: string; dead_qty: string }>(
      `WITH stock AS (
         SELECT t.wh_code, t.item_code,
                SUM(t.qty * t.calc_flag) AS bal,
                MAX(t.doc_date) FILTER (WHERE t.calc_flag < 0) AS last_out,
                MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) AS first_in
         FROM public.odg_wms_trans_detail t
         WHERE t.item_code IS NOT NULL AND t.item_code <> '' ${whClause}
         GROUP BY t.wh_code, t.item_code
         HAVING SUM(t.qty * t.calc_flag) > 0.0001
       )
       SELECT count(*) FILTER (WHERE (CURRENT_DATE - COALESCE(last_out, first_in)) > 90)::text AS dead_items,
              COALESCE(SUM(bal) FILTER (WHERE (CURRENT_DATE - COALESCE(last_out, first_in)) > 90), 0)::numeric::text AS dead_qty
       FROM stock`,
      args,
    ),
    query<{ mismatch: string }>(
      `WITH sn_items AS (
         SELECT DISTINCT s.wh_code, s.item_code
         FROM public.sn_inventory s WHERE TRUE ${whClauseS}
       ),
       stock AS (
         SELECT t.wh_code,
                COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
                t.item_code,
                SUM(t.qty * t.calc_flag) AS qty
         FROM public.odg_wms_trans_detail t
         JOIN sn_items si ON si.wh_code = t.wh_code AND si.item_code = t.item_code
         GROUP BY 1, 2, 3, 4, 5
       ),
       sn AS (
         SELECT s.wh_code,
                COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet,
                s.item_code,
                count(*) AS cnt
         FROM public.sn_inventory s
         JOIN sn_items si ON si.wh_code = s.wh_code AND si.item_code = s.item_code
         WHERE COALESCE(s.status, 0) = 0
         GROUP BY 1, 2, 3, 4, 5
       ),
       merged AS (
         SELECT COALESCE(st.qty, 0) AS sq, COALESCE(sn.cnt, 0) AS sc
         FROM stock st
         FULL OUTER JOIN sn
           ON st.wh_code = sn.wh_code AND st.rack = sn.rack AND st.location = sn.location
          AND st.pallet = sn.pallet AND st.item_code = sn.item_code
       )
       SELECT count(*)::text AS mismatch FROM merged WHERE sq <> sc`,
      args,
    ),
    minStockSummary(accessible),
    // ບ່ອນເກັບທີ່ຍອດຕິດລົບ — ນັບຈາກຂໍ້ມູນຈິງ ຈຶ່ງເຫັນຄວາມເສຍຫາຍທີ່ມາຈາກ
    // ຜູ້ຂຽນທຸກຝ່າຍ ບໍ່ແມ່ນສະເພາະທີ່ຜ່ານແອັບນີ້.
    query<{ bins: string; qty: string }>(
      `WITH bal AS (
         SELECT SUM(t.qty * t.calc_flag) AS q
         FROM public.odg_wms_trans_detail t
         WHERE t.item_code IS NOT NULL AND t.item_code <> '' ${whClause}
         GROUP BY t.wh_code,
                  COALESCE(NULLIF(TRIM(t.shelf_code), ''), ''),
                  COALESCE(NULLIF(TRIM(t.shelf_code1), ''), ''),
                  COALESCE(NULLIF(TRIM(t.pallet), ''), ''),
                  t.item_code
       )
       SELECT count(*)::text AS bins,
              COALESCE(SUM(q), 0)::numeric::text AS qty
       FROM bal WHERE q < -0.0001`,
      args,
    ),
  ]);

  const result: Health = {
    dead_items: Number.parseInt(deadRows[0]?.dead_items ?? "0", 10) || 0,
    dead_qty: Math.round((Number.parseFloat(deadRows[0]?.dead_qty ?? "0") || 0) * 100) / 100,
    sn_mismatch: Number.parseInt(mismatchRows[0]?.mismatch ?? "0", 10) || 0,
    min_below: minStock.below,
    negative_bins: Number.parseInt(negRows[0]?.bins ?? "0", 10) || 0,
    negative_qty: Math.round(Number.parseFloat(negRows[0]?.qty ?? "0") || 0),
    computed_at: now,
  };
  cacheStore.set(key, result);
  return NextResponse.json({ ...result, cached: false });
}

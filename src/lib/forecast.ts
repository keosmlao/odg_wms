import { query } from "@/lib/db";

/**
 * ຈຳນວນຄາດການ (forecasted quantity) — ແນວຄິດຫຼັກທີ່ຢືມມາຈາກ Odoo.
 *
 *     ຄາດການ = ຄົງເຫຼືອ + ກຳລັງມາ − ຖືກຈອງ
 *
 * ຄຳຖາມທີ່ມັນຕອບຄື **"ຮັບຄຳສັ່ງນີ້ໄດ້ບໍ່"** ຊຶ່ງ "ຄົງເຫຼືອ" ຢ່າງດຽວຕອບບໍ່ໄດ້:
 * ຄົງເຫຼືອ 3 ອາດພຽງພໍ ຖ້າມີ 20 ກຳລັງມາ ຫຼື ບໍ່ພຽງພໍ ຖ້າ 3 ນັ້ນຖືກຈອງໄວ້ໝົດແລ້ວ.
 *
 * ເປັນການ **ອ່ານລ້ວນໆ** — ບໍ່ຂຽນຫຍັງລົງບັນຊີ stock ຈຶ່ງຍ້ອນຄືນໄດ້ທັນທີ.
 *
 * ── ນິຍາມແຕ່ລະຂາ ແລະ ເຫດຜົນ ──────────────────────────────────────────
 *
 * ຄົງເຫຼືອ  SUM(qty × calc_flag) ຂອງ odg_wms_trans_detail ຕໍ່ (ສາງ × ສິນຄ້າ).
 *          **ບໍ່ກອງ status** ໂດຍເຈດຕະນາ — status=1 ໝາຍເຖິງຂາອອກຂອງການຍ້າຍ
 *          ບ່ອນພາຍໃນ (trans_flag 77) ບໍ່ແມ່ນການຍົກເລີກ; ກອງມັນອອກຈະນັບຂອງ
 *          ຄືນໃຫ້ບ່ອນທີ່ຂອງຍ້າຍອອກໄປແລ້ວ. ນີ້ຄືກົດດຽວກັບ lib/issueCore.ts
 *          ແລະ ໜ້າຄົງເຫຼືອ.
 *
 * ກຳລັງມາ  ຄ້າງຮັບຕາມໃບສັ່ງຊື້ = qty_balance ຂອງ odg_po_remain ຫັກສ່ວນທີ່
 *          WMS ຮັບເຂົ້າໄປແລ້ວ — ຫຼັກການດຽວກັບ /api/receive/pending.
 *
 * ຖືກຈອງ   ຈຳນວນທີ່ຢູ່ໃນໃບ pick ທີ່ຍັງບໍ່ໄດ້ຢືນຢັນຈ່າຍ (wms_product_out status 0).
 *          ນີ້ຄືການຈອງແບບ "ອ່ອນ" ຂອງລະບົບເຮົາ — ຂອງບໍ່ໄດ້ຖືກລັອກຕໍ່ບ່ອນເກັບ
 *          ແຕ່ມັນຖືກສັນຍາໃຫ້ໃບອື່ນແລ້ວ ຈຶ່ງບໍ່ຄວນນັບວ່າຫວ່າງ.
 */
export type ForecastRow = {
  wh_code: string;
  wh_name: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  on_hand: number;
  incoming: number;
  reserved: number;
  forecast: number;
};

const n = (v: string | null | undefined) => {
  const x = Number.parseFloat(String(v ?? ""));
  return Number.isFinite(x) ? x : 0;
};

/**
 * ຄິດຄາດການໃຫ້ສິນຄ້າທີ່ຕົງກັບຄຳຄົ້ນຫາ ພາຍໃນສາງທີ່ລະບຸ.
 *
 * ຕ້ອງມີຄຳຄົ້ນຫາ — ການຄິດໃຫ້ທຸກສິນຄ້າທຸກສາງພ້ອມກັນເປັນ aggregate ໜັກ
 * ແລະ ບໍ່ມີໃຜອ່ານໝົດຢູ່ແລ້ວ.
 */
export async function forecastSearch(
  whCodes: string[],
  q: string,
  limit = 100,
): Promise<ForecastRow[]> {
  if (whCodes.length === 0 || q.trim().length < 2) return [];
  const like = `%${q.trim().replace(/[\\%_]/g, "\\$&")}%`;

  return query<{
    wh_code: string;
    wh_name: string | null;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    on_hand: string;
    incoming: string;
    reserved: string;
  }>(
    `WITH hit AS (
       -- ສິນຄ້າທີ່ຕົງກັບຄຳຄົ້ນຫາ — ຈຳກັດຂອບເຂດກ່ອນ ແລ້ວຄ່ອຍຄິດຍອດ
       SELECT i.code AS item_code, i.name_1 AS item_name, i.unit_standard AS unit_code
         FROM public.ic_inventory i
        WHERE i.code ILIKE $2 ESCAPE '\\' OR i.name_1 ILIKE $2 ESCAPE '\\'
        ORDER BY i.code
        LIMIT $3
     ),
     onhand AS (
       SELECT t.wh_code, t.item_code, SUM(t.qty * t.calc_flag) AS q
         FROM public.odg_wms_trans_detail t
         JOIN hit h ON h.item_code = t.item_code
        WHERE t.wh_code = ANY($1)
        GROUP BY 1, 2
     ),
     received AS (
       -- ສ່ວນທີ່ WMS ຮັບເຂົ້າໄປແລ້ວຕໍ່ (ໃບສັ່ງຊື້ × ສິນຄ້າ)
       SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), hh.ref_doc_no) AS po_no,
              hh.warehouse_code AS wh_code, d.item_code, SUM(d.qty) AS q
         FROM public.wms_product_receive hh
         JOIN public.wms_product_receive_detail d ON d.doc_no = hh.doc_no
         JOIN hit h ON h.item_code = d.item_code
        WHERE hh.warehouse_code = ANY($1)
          AND (hh.status = 0 OR hh.status IS NULL)
        GROUP BY 1, 2, 3
     ),
     incoming AS (
       SELECT w.code AS wh_code, p.item_code,
              SUM(GREATEST(p.qty_balance - COALESCE(r.q, 0), 0)) AS q
         FROM public.odg_po_remain p
         JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
         JOIN hit h ON h.item_code = p.item_code
         LEFT JOIN received r ON r.po_no = p.doc_no AND r.wh_code = w.code AND r.item_code = p.item_code
        WHERE p.qty_balance > 0 AND w.code = ANY($1)
        GROUP BY 1, 2
     ),
     reserved AS (
       SELECT o.warehouse_code AS wh_code, d.item_code, SUM(d.qty) AS q
         FROM public.wms_product_out o
         JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
         JOIN hit h ON h.item_code = d.item_code
        WHERE COALESCE(o.status, 0) = 0 AND o.warehouse_code = ANY($1)
        GROUP BY 1, 2
     ),
     keys AS (
       SELECT wh_code, item_code FROM onhand
       UNION SELECT wh_code, item_code FROM incoming
       UNION SELECT wh_code, item_code FROM reserved
     )
     SELECT k.wh_code,
            w.name_1 AS wh_name,
            k.item_code,
            h.item_name,
            h.unit_code,
            COALESCE(oh.q, 0)::numeric::text AS on_hand,
            COALESCE(inc.q, 0)::numeric::text AS incoming,
            COALESCE(res.q, 0)::numeric::text AS reserved
       FROM keys k
       JOIN hit h ON h.item_code = k.item_code
       LEFT JOIN public.ic_warehouse w ON w.code = k.wh_code
       LEFT JOIN onhand oh ON oh.wh_code = k.wh_code AND oh.item_code = k.item_code
       LEFT JOIN incoming inc ON inc.wh_code = k.wh_code AND inc.item_code = k.item_code
       LEFT JOIN reserved res ON res.wh_code = k.wh_code AND res.item_code = k.item_code
      ORDER BY k.item_code, k.wh_code`,
    [whCodes, like, limit],
  ).then((rows) =>
    rows.map((r) => {
      const on_hand = n(r.on_hand);
      const incoming = n(r.incoming);
      const reserved = n(r.reserved);
      return {
        wh_code: r.wh_code,
        wh_name: r.wh_name,
        item_code: r.item_code,
        item_name: r.item_name,
        unit_code: r.unit_code,
        on_hand,
        incoming,
        reserved,
        forecast: on_hand + incoming - reserved,
      };
    }),
  );
}

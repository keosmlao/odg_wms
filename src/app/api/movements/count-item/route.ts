import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ຂໍ້ມູນທີ່ໜ້າຈໍນັບຕ້ອງການ ຕໍ່ໜຶ່ງສິນຄ້າ ໃນສາງໜຶ່ງ.
 *
 * GET ?wh=1203&item=130102-0352
 *   → { item_code, item_name, unit_code, on_hand, counted_before, default_qty, history[] }
 *
 * ── "ຈຳນວນທີ່ນັບຈິງ" ຕັ້ງຕົ້ນເປັນຫຍັງ ────────────────────────────────
 *
 *   ບໍ່ເຄີຍນັບ  →  ຄົງເຫຼືອທັງສາງ
 *   ເຄີຍນັບແລ້ວ →  ຄົງເຫຼືອທັງສາງ − ທຸກຈຳນວນທີ່ເຄີຍນັບຜ່ານລະບົບນີ້
 *
 * ເຫດຜົນ: ສິນຄ້າອັນດຽວກັນມັກກະຈາຍຢູ່ຫຼາຍ location. ພໍນັບ location ທຳອິດໄດ້ 10
 * ແລ້ວ ພໍໄປ location ຕໍ່ໄປ ສິ່ງທີ່ຍັງເຫຼືອໃຫ້ຄົ້ນຫາຄື (ຄົງເຫຼືອ − 10) — ຖ້າ default
 * ເປັນຄົງເຫຼືອທັງໝົດທຸກເທື່ອ ຄົນນັບຈະບວກຊ້ຳໂດຍບໍ່ຮູ້ຕົວ.
 *
 * `counted_before` ນັບ **ທຸກຄັ້ງທີ່ເຄີຍນັບ** ບໍ່ຈຳກັດວັນ ຕາມທີ່ຕົກລົງໄວ້.
 * ຕາຕະລາງ `wms_product_adj_stock_detail` ບໍ່ມີຊ່ອງສາງ ຈຶ່ງກັ່ນຕອງສາງໂດຍ join
 * `shelf_code` (ເຊັ່ນ 120301-A259) ກັບ `odg_wms_location1`.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const item = url.searchParams.get("item")?.trim() ?? "";
  if (!wh || !item) return NextResponse.json({ error: "ຂາດສາງ ຫຼື ລະຫັດສິນຄ້າ" }, { status: 400 });
  if (/[,']/.test(item)) return NextResponse.json({ error: "ລະຫັດສິນຄ້າບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  try {
    const [info, balance, history, units] = await Promise.all([
      query<{ item_name: string | null; unit_code: string | null }>(
        `SELECT name_1 AS item_name, NULLIF(TRIM(unit_standard), '') AS unit_code
         FROM public.ic_inventory WHERE code = $1 LIMIT 1`,
        [item],
      ),
      // ຄົງເຫຼືອ ERP — ສົ່ງລະຫັດສິນຄ້າເຂົ້າຟັງຊັນ ຈຶ່ງໄວ (ບໍ່ດຶງທັງສາງ)
      query<{ on_hand: string | null; unit_code: string | null }>(
        `SELECT balance_qty::text AS on_hand, ic_unit_code AS unit_code
         FROM sml_ic_function_stock_balance_warehouse(
                date(timezone('WAST', now())), $1, $2)
         LIMIT 1`,
        [item, wh],
      ),
      // ທຸກຄັ້ງທີ່ເຄີຍນັບສິນຄ້ານີ້ ໃນສາງນີ້
      query<{ doc_no: string; shelf_code: string | null; qty: string | null; doc_date: string | null }>(
        `SELECT d.doc_no, d.shelf_code, d.qty::text AS qty,
                to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date
         FROM public.wms_product_adj_stock_detail d
         JOIN public.odg_wms_location1 l ON l.code = d.shelf_code AND l.wh_code = $2
         LEFT JOIN public.wms_product_adj_stock h ON h.doc_no = d.doc_no
         WHERE d.item_code = $1
         ORDER BY h.doc_date DESC NULLS LAST, d.doc_no DESC
         LIMIT 50`,
        [item, wh],
      ),
      // ຫົວໜ່ວຍທັງໝົດຂອງສິນຄ້າ — 2,277 ລາຍການມີ 2+ ຫົວໜ່ວຍ (ພື້ນຖານ + ຫີບ)
      // ຄົນນັບຕ້ອງປ້ອນແຍກ "3 ຫີບ + 25 ຕົວ" ບໍ່ແມ່ນຄິດເລກໃນຫົວເອງ
      query<{ unit: string; ratio: string | null }>(
        `SELECT TRIM(u.code) AS unit, u.ratio::text AS ratio
         FROM public.ic_unit_use u
         WHERE u.ic_code = $1 AND NULLIF(TRIM(u.code), '') IS NOT NULL
         ORDER BY u.ratio`,
        [item],
      ),
    ]);

    const num = (v: string | null | undefined) => {
      const n = Number.parseFloat(v ?? "");
      return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
    };

    const on_hand = num(balance[0]?.on_hand);
    const counted_before = history.reduce((s, h) => s + num(h.qty), 0);

    const baseUnit = balance[0]?.unit_code ?? info[0]?.unit_code ?? null;
    // ຖ້າ ic_unit_use ບໍ່ມີແຖວ ຢ່າງໜ້ອຍໃຫ້ມີຫົວໜ່ວຍພື້ນຖານ 1 ອັນ ບໍ່ດັ່ງນັ້ນໜ້າຈໍຈະບໍ່ມີບ່ອນປ້ອນ
    const unitList = units
      .map((u) => ({ unit: u.unit, ratio: num(u.ratio) }))
      .filter((u) => u.unit && u.ratio > 0);
    if (unitList.length === 0) unitList.push({ unit: baseUnit ?? "", ratio: 1 });

    return NextResponse.json({
      item_code: item,
      item_name: info[0]?.item_name ?? null,
      unit_code: baseUnit,
      units: unitList,
      on_hand,
      counted_before: Math.round(counted_before * 1e6) / 1e6,
      // ບໍ່ໃຫ້ຕິດລົບ — ນັບເກີນຄົງເຫຼືອແລ້ວ ຄ່າຕັ້ງຕົ້ນຄວນເປັນ 0 ບໍ່ແມ່ນເລກລົບ
      default_qty: Math.max(0, Math.round((on_hand - counted_before) * 1e6) / 1e6),
      history: history.map((h) => ({
        doc_no: h.doc_no,
        location: h.shelf_code,
        qty: num(h.qty),
        doc_date: h.doc_date,
      })),
    });
  } catch (err) {
    console.error("[count-item]", err);
    return NextResponse.json({ error: "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

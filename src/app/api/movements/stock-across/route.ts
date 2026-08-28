import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * ຄົງເຫຼືອ ERP ຂອງ **ຫຼາຍລາຍການ ຂ້າມທຸກສາງຫຼັກ** — ໃຊ້ຕອບຄຳຖາມ
 * "ລາຍການທີ່ຕິກໄວ້ ຄວນຂໍໂອນຈາກສາງໃດແດ່".
 *
 * GET ?items=130101-0267,130101-0337&exclude=1103
 *   → { warehouses: [{code,name}], rows: [{ item_code, wh_code, on_hand }] }
 *
 * ຄືນສະເພາະແຖວທີ່ **ມີຂອງ** (> 0) — ຄົງເຫຼືອ 0 ບໍ່ຊ່ວຍຕັດສິນໃຈ ແລະ ຖ້າສົ່ງ
 * ທັງໝົດ ຈຳນວນແຖວຈະເປັນ ລາຍການ × ສາງ ຊຶ່ງໃຫຍ່ໂດຍບໍ່ຈຳເປັນ.
 *
 * **ຄວາມໄວ:** `sml_ic_function_stock_balance_warehouse` ຮັບທັງລາຍການລະຫັດ
 * (ພາຣາມິເຕີ 2) ແລະ ລາຍຊື່ສາງ (ພາຣາມິເຕີ 3) — ຍິງເທື່ອດຽວຈຶ່ງພໍ ບໍ່ຕ້ອງວົນ
 * ເທື່ອລະສາງ (ເບິ່ງເຫດຜົນດຽວກັນໃນ src/lib/coverageItem.ts).
 *
 * ສິດ: ອ່ານຢ່າງດຽວ ແລະ ຕົ້ນທາງຂອງໃບຂໍໂອນແມ່ນສາງຄົນອື່ນໂດຍທຳມະຊາດ — ສິດຖືກ
 * ບັງຄັບຢູ່ຝັ່ງປາຍທາງໃນ POST /api/movements/transfer-request.
 */
const MAX_ITEMS = 300;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const items = [
    ...new Set(
      (url.searchParams.get("items") ?? "")
        .split(",")
        .map((s) => s.trim())
        // ລະຫັດຖືກຕໍ່ເປັນ string ສົ່ງເຂົ້າຟັງຊັນ — ກັນ , ແລະ ' ຫຼຸດເຂົ້າໄປ
        .filter((s) => s.length > 0 && !/[,']/.test(s)),
    ),
  ].slice(0, MAX_ITEMS);
  if (items.length === 0) return NextResponse.json({ warehouses: [], rows: [] });

  const exclude = new Set(
    (url.searchParams.get("exclude") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  try {
    // ຕົ້ນທາງຕ້ອງເປັນ **ສາງຫຼັກ** ເທົ່ານັ້ນ (ກົດດຽວກັນກັບ dropdown ໃນໜ້າວິເຄາະ)
    const warehouses = await query<{ code: string; name: string | null }>(
      `SELECT w.code, w.name_1 AS name
       FROM public.ic_warehouse w
       LEFT JOIN public.odg_wms_warehouse_config c ON c.wh_code = w.code
       WHERE COALESCE(w.status, 1) = 1
         AND w.code IS NOT NULL
         AND COALESCE(c.wh_kind, 'main') = 'main'
       ORDER BY w.code`,
    );
    const pool = warehouses.filter((w) => !exclude.has(w.code));
    if (pool.length === 0) return NextResponse.json({ warehouses: [], rows: [] });

    const rows = await query<{ wh_code: string | null; item_code: string | null; on_hand: string | null }>(
      `SELECT NULLIF(TRIM(b.warehouse), '') AS wh_code,
              b.ic_code                     AS item_code,
              b.balance_qty::text           AS on_hand
       FROM sml_ic_function_stock_balance_warehouse(
              date(timezone('WAST', now())), $1, $2) b
       WHERE b.ic_code IS NOT NULL
         AND NULLIF(TRIM(b.warehouse), '') IS NOT NULL
         AND b.balance_qty > 0`,
      [items.join(","), pool.map((w) => w.code).join(",")],
    );

    return NextResponse.json({
      warehouses: pool,
      rows: rows.map((r) => {
        const n = Number.parseFloat(r.on_hand ?? "");
        return {
          item_code: r.item_code as string,
          wh_code: r.wh_code as string,
          on_hand: Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0,
        };
      }),
    });
  } catch (err) {
    console.error("[stock-across]", err);
    return NextResponse.json({ error: "ດຶງຄົງເຫຼືອຂ້າມສາງບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

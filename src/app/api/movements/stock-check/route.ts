import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ຄົງເຫຼືອ ERP ຂອງ **ສິນຄ້າສະເພາະລາຍການ** ໃນສາງໜຶ່ງ.
 *
 * GET ?wh=1203&items=130101-0267,130101-0337
 *   → { wh, items: [{ item_code, on_hand, unit_code }] }
 *
 * ໃຊ້ຕອນຈະສ້າງໃບຂໍໂອນ — ເພື່ອບໍ່ໃຫ້ຂໍຈຳນວນທີ່ສາງຕົ້ນທາງບໍ່ມີ.
 *
 * ສົ່ງລາຍການສິນຄ້າເຂົ້າຟັງຊັນຄິດຄົງເຫຼືອໂດຍກົງ (ພາຣາມິເຕີທີ 2) ຈຶ່ງໄວກວ່າດຶງທັງສາງ
 * ຫຼາຍເທົ່າ — ວັດແທ້: 8 ລາຍການ 245ms ທຽບກັບ ທັງສາງ 5,597ms.
 */
const MAX_ITEMS = 300;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາລະບຸສາງ" }, { status: 400 });

  // ໃບຂໍໂອນກວດຄົງເຫຼືອຂອງສາງ **ຕົ້ນທາງ** ຊຶ່ງໂດຍທຳມະຊາດແມ່ນສາງຄົນອື່ນ — ຄືກັບ
  // /api/movements/items/search?scope=any. ອ່ານຢ່າງດຽວ ແລະ ສິດຖືກບັງຄັບຢູ່ຝັ່ງ
  // ປາຍທາງໃນ POST /api/movements/transfer-request.
  if (url.searchParams.get("scope") !== "any") {
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(wh)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
  }

  const items = [
    ...new Set(
      (url.searchParams.get("items") ?? "")
        .split(",")
        .map((s) => s.trim())
        // ລະຫັດສິນຄ້າຖືກຕໍ່ເປັນ string ສົ່ງເຂົ້າຟັງຊັນ — ກັນ , ແລະ ' ຫຼຸດເຂົ້າໄປ
        .filter((s) => s.length > 0 && !/[,']/.test(s)),
    ),
  ].slice(0, MAX_ITEMS);

  if (items.length === 0) return NextResponse.json({ wh, items: [] });

  try {
    const rows = await query<{ item_code: string; on_hand: string | null; unit_code: string | null }>(
      `SELECT b.ic_code AS item_code, b.balance_qty::text AS on_hand, b.ic_unit_code AS unit_code
       FROM sml_ic_function_stock_balance_warehouse(
              date(timezone('WAST', now())), $1, $2) b
       WHERE b.ic_code IS NOT NULL`,
      [items.join(","), wh],
    );

    // ລາຍການທີ່ຟັງຊັນບໍ່ຄືນມາ = ບໍ່ມີຄົງເຫຼືອ → ຕ້ອງເປັນ 0 ບໍ່ແມ່ນຫາຍໄປ
    const found = new Map(rows.map((r) => [r.item_code, r]));
    return NextResponse.json({
      wh,
      items: items.map((code) => {
        const r = found.get(code);
        const n = Number.parseFloat(r?.on_hand ?? "");
        return {
          item_code: code,
          on_hand: Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0,
          unit_code: r?.unit_code ?? null,
        };
      }),
    });
  } catch (err) {
    console.error("[stock-check]", err);
    return NextResponse.json({ error: "ດຶງຄົງເຫຼືອບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

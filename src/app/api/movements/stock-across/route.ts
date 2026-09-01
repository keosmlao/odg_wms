import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DEAD_DOC_RE, RETURN_DOC_FLAG } from "@/lib/pendingOut";

/**
 * ຄົງເຫຼືອ ERP ຂອງ **ຫຼາຍລາຍການ ຂ້າມທຸກສາງຫຼັກ** — ໃຊ້ຕອບຄຳຖາມ
 * "ລາຍການທີ່ຕິກໄວ້ ຄວນຂໍໂອນຈາກສາງໃດແດ່".
 *
 * GET ?items=130101-0267,130101-0337&exclude=1103&days=90&low=14
 *   → { warehouses: [{code,name}], rows: [{ item_code, wh_code, on_hand, spare }] }
 *
 * `spare` = ແບ່ງໃຫ້ສາງອື່ນໄດ້ເທົ່າໃດ ໂດຍ**ຕົນເອງຍັງພໍໃຊ້ເຖິງຂີດ `low` ວັນ** —
 * ສູດດຽວກັນກັບ src/lib/coverageItem.ts ເພື່ອບໍ່ໃຫ້ສອງໜ້າໃຫ້ຕົວເລກຂັດກັນ.
 * ຂໍຈາກ `on_hand` ລ້ວນໆ ຄືການຍ້າຍບັນຫາໄປໃສ່ສາງທີ່ຈ່າຍໃຫ້ ບໍ່ແມ່ນການແກ້.
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
const SALE_FLAG = 44;

/**
 * ສາງທີ່ **ເປັນຕົ້ນທາງບໍ່ໄດ້** ເຖິງຈະມີຍອດຄົງເຫຼືອກໍ່ຕາມ.
 *
 * 9903 = ສາງລະຫວ່າງທາງ — ຂອງທີ່ຈ່າຍອອກແລ້ວແຕ່ຍັງບໍ່ທັນຮັບເຂົ້າປາຍທາງ. ມັນຄື
 * ຂອງທີ່ "ກຳລັງເດີນທາງໄປຫາຄົນອື່ນຢູ່" ຈຶ່ງຂໍໂອນຈາກມັນບໍ່ໄດ້ (ເບິ່ງໜ້າ
 * /movements/transfer-receive ທີ່ຮັບຂອງອອກຈາກສາງນີ້).
 */
const NOT_A_SOURCE = new Set(["9903"]);

/** ຍອດຂາຍສຸດທິ (ບິນຂາຍ ຫັກ ໃບຮັບຄືນ) ຕໍ່ (ສາງ, ລາຍການ) ໃນຊ່ວງທີ່ກຳນົດ. */
const SALES_SQL = `
  WITH sales AS (
    SELECT d.wh_code, d.item_code,
           SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS sold
    FROM public.ic_trans_detail d
    JOIN public.ic_trans h ON h.doc_no = d.doc_no AND h.trans_flag = d.trans_flag
    WHERE d.trans_flag = ${SALE_FLAG}
      AND d.item_code = ANY($1) AND d.wh_code = ANY($2)
      AND d.doc_date >= CURRENT_DATE - $3::int
      AND (d.status = 0 OR d.status IS NULL)
      AND COALESCE(h.is_cancel, 0) = 0
      AND COALESCE(h.remark_4, '') !~* '${DEAD_DOC_RE}'
    GROUP BY 1, 2
  ),
  ret AS (
    SELECT r.wh_code, r.item_code, SUM(r.qty) AS ret_qty
    FROM public.ic_trans_detail r
    JOIN public.ic_trans rh ON rh.doc_no = r.doc_no AND rh.trans_flag = r.trans_flag
    WHERE r.trans_flag = ${RETURN_DOC_FLAG}
      AND r.item_code = ANY($1) AND r.wh_code = ANY($2)
      AND r.doc_date >= CURRENT_DATE - $3::int
      AND (r.status = 0 OR r.status IS NULL)
      AND COALESCE(rh.is_cancel, 0) = 0
    GROUP BY 1, 2
  )
  SELECT s.wh_code, s.item_code,
         GREATEST(s.sold - COALESCE(r.ret_qty, 0), 0)::text AS sold
  FROM sales s
  LEFT JOIN ret r ON r.wh_code = s.wh_code AND r.item_code = s.item_code`;

const int = (v: string | null, dflt: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

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

  const days = int(url.searchParams.get("days"), 90, 1, 730);
  // ຂີດ "ສ່ຽງ" ຂອງໜ້າວິເຄາະ — ຈຳນວນວັນທີ່ສາງຕົ້ນທາງຕ້ອງເຫຼືອໄວ້ໃຫ້ຕົນເອງ
  const low = int(url.searchParams.get("low"), 14, 0, 365);

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
    const pool = warehouses.filter((w) => !exclude.has(w.code) && !NOT_A_SOURCE.has(w.code));
    if (pool.length === 0) return NextResponse.json({ warehouses: [], rows: [] });

    const codes = pool.map((w) => w.code);
    const [balances, sales] = await Promise.all([
      query<{ wh_code: string | null; item_code: string | null; on_hand: string | null }>(
        `SELECT NULLIF(TRIM(b.warehouse), '') AS wh_code,
                b.ic_code                     AS item_code,
                b.balance_qty::text           AS on_hand
         FROM sml_ic_function_stock_balance_warehouse(
                date(timezone('WAST', now())), $1, $2) b
         WHERE b.ic_code IS NOT NULL
           AND NULLIF(TRIM(b.warehouse), '') IS NOT NULL
           AND b.balance_qty > 0`,
        [items.join(","), codes.join(",")],
      ),
      query<{ wh_code: string; item_code: string; sold: string | null }>(SALES_SQL, [
        items,
        codes,
        days,
      ]),
    ]);

    // ຂາຍສະເລ່ຍຕໍ່ມື້ ຕໍ່ (ສາງ, ລາຍການ) — ບໍ່ມີແຖວ = ສາງນັ້ນບໍ່ຂາຍລາຍການນີ້ເລີຍ
    const perDay = new Map<string, number>();
    for (const r of sales) {
      const n = Number.parseFloat(r.sold ?? "");
      perDay.set(`${r.wh_code}|${r.item_code}`, (Number.isFinite(n) ? n : 0) / days);
    }

    return NextResponse.json({
      warehouses: pool,
      rows: balances.map((r) => {
        const n = Number.parseFloat(r.on_hand ?? "");
        const onHand = Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
        // ເຫຼືອໄວ້ໃຫ້ຕົນເອງເຖິງຂີດ `low` ວັນ — ສາງທີ່ບໍ່ຂາຍລາຍການນີ້ ແບ່ງໄດ້ໝົດ
        const keep = (perDay.get(`${r.wh_code}|${r.item_code}`) ?? 0) * low;
        return {
          item_code: r.item_code as string,
          wh_code: r.wh_code as string,
          on_hand: onHand,
          spare: Math.max(0, Math.round((onHand - keep) * 100) / 100),
        };
      }),
    });
  } catch (err) {
    console.error("[stock-across]", err);
    return NextResponse.json({ error: "ດຶງຄົງເຫຼືອຂ້າມສາງບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

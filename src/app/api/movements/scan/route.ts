import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ແປລະຫັດທີ່ຍິງມາ ວ່າແມ່ນ **location** ຫຼື **ສິນຄ້າ**.
 *
 * GET ?code=120301-A259&wh=1203
 *   → { kind: "location" | "item" | "none", location?, item? }
 *
 * ລຳດັບການຫາ (location ກ່ອນ ເພາະປ້າຍທີ່ WMS ພິມເອງແມ່ນ location/pallet):
 *   1. `odg_wms_location1.code`  ເຊັ່ນ 120301-A259  (ປ້າຍທີ່ພິມຈາກ /movements/labels)
 *   2. `odg_wms_location1.name_1` ເຊັ່ນ A259 — ສະເພາະໃນສາງທີ່ເລືອກ
 *   3. `ic_inventory_barcode.barcode` — ບາໂຄດຜູ້ຜະລິດ (22,818 ລະຫັດ / 22,341 ສິນຄ້າ)
 *   4. `ic_inventory.code`      ລະຫັດສິນຄ້າ
 *
 * ── ສອງເລື່ອງທີ່ວັດແທ້ແລ້ວ ກ່ອນຂຽນ query ນີ້ ─────────────────────────
 *
 * `ic_inventory_barcode.status` ເປັນ **0 ທຸກແຖວ** (22,818/22,818) — ຖ້າກອງ
 * `status = 1` ຕາມແບບຕາຕະລາງອື່ນ ຈະບໍ່ພົບຫຍັງເລີຍ ຈຶ່ງ**ບໍ່ກອງ status**.
 *
 * ບໍ່ມີບາໂຄດໃດແປໄປຫາສິນຄ້າຫຼາຍກວ່າໜຶ່ງລາຍການ (ກວດແລ້ວ = 0 ຄູ່ຊ້ຳ) ຈຶ່ງແປ
 * ແບບໜຶ່ງຕໍ່ໜຶ່ງໄດ້ຢ່າງປອດໄພ. ແຕ່ **ສິນຄ້າໜຶ່ງມີໄດ້ຫຼາຍບາໂຄດ ຕ່າງຫົວໜ່ວຍ**
 * (ເຊັ່ນ ຕົວ ກັບ ຫີບ) ຈຶ່ງຄືນ `scanned_unit` ມານຳ — ຍິງບາໂຄດຫີບແລ້ວນັບເປັນ
 * 1 ຕົວ ຄືການນັບຜິດທີ່ເກີດງ່າຍທີ່ສຸດໃນວຽກນີ້.
 */
export type ScanLocation = {
  code: string;
  name: string | null;
  wh_code: string;
  /** ລະຫັດ rack (`location_id`) — ໃບປັບປຸງຕ້ອງການແຍກ rack ກັບ location. */
  rack: string;
};

export type ScanItem = {
  item_code: string;
  item_name: string | null;
  /** ຫົວໜ່ວຍມາດຕະຖານຂອງສິນຄ້າ. */
  unit_code: string | null;
  /** ຫົວໜ່ວຍທີ່ບາໂຄດນີ້ໝາຍເຖິງ — `null` ເມື່ອຍິງເປັນລະຫັດສິນຄ້າ. */
  scanned_unit: string | null;
  /** ບາໂຄດນີ້ = ຈັກຫົວໜ່ວຍມາດຕະຖານ (1 ເມື່ອເປັນຫົວໜ່ວຍພື້ນຖານ ຫຼື ບໍ່ຮູ້). */
  scanned_unit_size: number;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!code) return NextResponse.json({ error: "ບໍ່ມີລະຫັດ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  const scoped = (c: string) =>
    accessible === null || (Array.isArray(accessible) && accessible.includes(c));

  try {
    // ── 1+2) location ────────────────────────────────────────────────
    const locs = await query<{
      code: string; name_1: string | null; wh_code: string; location_id: string | null;
    }>(
      `SELECT code, name_1, wh_code, location_id
       FROM public.odg_wms_location1
       WHERE COALESCE(is_active, 1) = 1
         AND (UPPER(code) = UPPER($1) OR ($2 <> '' AND wh_code = $2 AND UPPER(name_1) = UPPER($1)))
       ORDER BY CASE WHEN UPPER(code) = UPPER($1) THEN 0 ELSE 1 END
       LIMIT 5`,
      [code, wh],
    );
    const loc = locs.find((l) => scoped(l.wh_code));
    if (loc) {
      return NextResponse.json({
        kind: "location",
        location: {
          code: loc.code,
          name: loc.name_1,
          wh_code: loc.wh_code,
          rack: loc.location_id ?? "",
        } satisfies ScanLocation,
      });
    }
    // ພົບ location ແຕ່ຢູ່ນອກສາງທີ່ມີສິດ — ບອກໄປຊື່ໆ ດີກວ່າປ່ອຍວ່າ "ບໍ່ພົບ"
    if (locs.length > 0) {
      return NextResponse.json(
        { error: `location ນີ້ຢູ່ສາງ ${locs[0].wh_code} ຊຶ່ງທ່ານບໍ່ມີສິດ` },
        { status: 403 },
      );
    }

    // ── 3+4) ສິນຄ້າ ──────────────────────────────────────────────────
    //
    // ບາໂຄດກ່ອນລະຫັດສິນຄ້າ ເພາະບາໂຄດບອກຫົວໜ່ວຍທີ່ຍິງນຳ. `u.ratio` ມາຈາກ
    // `ic_unit_use` ຂອງຫົວໜ່ວຍນັ້ນເອງ — ຍິງບາໂຄດຫີບ ຈຶ່ງຮູ້ວ່າ 1 ຄັ້ງ = ຈັກຕົວ.
    const items = await query<ScanItem>(
      `WITH hit AS (
         SELECT b.ic_code, NULLIF(TRIM(b.unit_code), '') AS scanned_unit, 0 AS pref
         FROM public.ic_inventory_barcode b
         WHERE b.barcode = $1 AND COALESCE(b.barcode, '') <> ''
         UNION ALL
         SELECT i.code, NULL, 1 FROM public.ic_inventory i WHERE UPPER(i.code) = UPPER($1)
       )
       SELECT i.code                              AS item_code,
              i.name_1                            AS item_name,
              NULLIF(TRIM(i.unit_standard), '')   AS unit_code,
              h.scanned_unit,
              COALESCE(u.ratio, 1)::float8        AS scanned_unit_size
       FROM hit h
       JOIN public.ic_inventory i ON i.code = h.ic_code
       LEFT JOIN public.ic_unit_use u
              ON u.ic_code = h.ic_code AND TRIM(u.code) = h.scanned_unit
       ORDER BY h.pref
       LIMIT 1`,
      [code],
    );
    if (items[0]) {
      const it = items[0];
      return NextResponse.json({
        kind: "item",
        item: {
          ...it,
          scanned_unit_size: Number(it.scanned_unit_size) > 0 ? Number(it.scanned_unit_size) : 1,
        },
      });
    }

    return NextResponse.json({ kind: "none" });
  } catch (err) {
    console.error("[scan]", err);
    return NextResponse.json({ error: "ຄົ້ນຫາບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

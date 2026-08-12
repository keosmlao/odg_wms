import { query } from "@/lib/db";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";

export type WarehouseRef = { code: string; name: string | null };

/**
 * ຂອບເຂດສາງຂອງ session ຂະຫຍາຍເປັນລາຍຊື່ code ຈິງ.
 *
 * ໜ້າຈໍ WMS ບໍ່ໃຫ້ຜູ້ໃຊ້ "ເລືອກສາງ" ອີກຕໍ່ໄປ — ທຸກໜ້າສະແດງທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດ
 * ແລ້ວຈັດກຸ່ມຕາມສາງ. API ຈຶ່ງຕ້ອງແປງ `accessibleWarehouses()` (ທີ່ຄືນ `null`
 * ໝາຍເຖິງ "ທຸກສາງ") ໃຫ້ເປັນ array ຂອງ code ສະເໝີ ເພື່ອໃຊ້ກັບ `= ANY($n)`.
 *
 * `whParam` ຍັງຮັບໄດ້ (comma-separated) ສຳລັບ deep-link ເກົ່າ ຫຼື ການສະເພາະ
 * ໃບໜຶ່ງ — ຄ່າທີ່ສົ່ງມາຈະຖືກຕັດໃຫ້ຢູ່ໃນຂອບເຂດທີ່ມີສິດສະເໝີ.
 */
export async function scopedWarehouseCodes(
  session: Session | null,
  whParam?: string | null,
): Promise<string[]> {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return [];

  const asked = (whParam ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (asked.length > 0) {
    return accessible === null ? asked : asked.filter((c) => accessible.includes(c));
  }

  if (accessible !== null) return accessible;

  const rows = await query<{ code: string }>(
    `SELECT code FROM public.ic_warehouse WHERE COALESCE(status, 1) = 1 ORDER BY code`,
  );
  return rows.map((r) => r.code);
}

/** ຄືກັບ `scopedWarehouseCodes` ແຕ່ຄືນຊື່ສາງມານຳ (ສຳລັບຫົວກຸ່ມໃນ UI). */
export async function scopedWarehouses(
  session: Session | null,
  whParam?: string | null,
): Promise<WarehouseRef[]> {
  const codes = await scopedWarehouseCodes(session, whParam);
  if (codes.length === 0) return [];
  const rows = await query<WarehouseRef>(
    `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
    [codes],
  );
  // ສາງທີ່ບໍ່ມີໃນ ic_warehouse (ຖືກລຶບ/ປິດ) ຍັງຕ້ອງຄືນ ເພື່ອບໍ່ໃຫ້ຂໍ້ມູນຫາຍ.
  const seen = new Set(rows.map((r) => r.code));
  return [...rows, ...codes.filter((c) => !seen.has(c)).map((c) => ({ code: c, name: null }))];
}

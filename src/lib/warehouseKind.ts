/**
 * ສາງຫຼັກ / ສາງຍ່ອຍ — ຄ່າຄົງທີ່ ແລະ ຕົວກວດ ທີ່ **ໃຊ້ໄດ້ທັງສອງຝັ່ງ**.
 *
 * ແຍກອອກຈາກ `warehouseConfig.ts` ເພາະໄຟລ໌ນັ້ນ import `@/lib/db` — client
 * component ຈຶ່ງ import ຄ່າຈາກມັນບໍ່ໄດ້ (ໄດ້ແຕ່ type). ຝັ່ງ DB ຢູ່ນັ້ນຄືເກົ່າ.
 */

/** main = ສາງຫຼັກ (ບໍ່ມີແມ່), sub = ສາງຍ່ອຍ (ຕ້ອງມີສາງແມ່). */
export type WarehouseKind = "main" | "sub";

export const WAREHOUSE_KINDS: { key: WarehouseKind; label: string; hint: string }[] = [
  { key: "main", label: "ສາງຫຼັກ", hint: "ສາງໃຫຍ່ທີ່ຢືນດ້ວຍຕົນເອງ — ອາດມີສາງຍ່ອຍຂຶ້ນກັບ" },
  { key: "sub", label: "ສາງຍ່ອຍ", hint: "ຂຶ້ນກັບສາງຫຼັກໜຶ່ງ (ຕ້ອງລະບຸສາງແມ່)" },
];

export const WAREHOUSE_KIND_LABEL: Record<WarehouseKind, string> = {
  main: "ສາງຫຼັກ",
  sub: "ສາງຍ່ອຍ",
};

/** ຄ່າເລີ່ມຕົ້ນ — ສາງທີ່ຍັງບໍ່ໄດ້ຕັ້ງ (ຫຼື ບໍ່ມີແຖວ config) ຖືເປັນສາງຫຼັກ. */
export const DEFAULT_WAREHOUSE_KIND: WarehouseKind = "main";

export function isWarehouseKind(v: unknown): v is WarehouseKind {
  return v === "main" || v === "sub";
}

/** ອ່ານຄ່າຈາກ DB ໃຫ້ເປັນ kind ທີ່ເຊື່ອຖືໄດ້ (ຄ່າແປກ/ວ່າງ → main). */
export function toWarehouseKind(v: unknown): WarehouseKind {
  return isWarehouseKind(v) ? v : DEFAULT_WAREHOUSE_KIND;
}

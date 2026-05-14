/**
 * ກຳນົດ "ຕຳແໜ່ງ" ກວດນັບດ້ວຍ rack + location (ຄ່າວ່າງ = null) ເພື່ອກວດບໍ່ໃຫ້ key ສິນຄ້າຊ້ຳຄູ່ດຽວກັນໃນປ້າຍດຽວກັນ.
 */

export function normalizeSlotPart(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function normalizeItemCode(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type CountSlotLine = {
  item_code: string;
  rack_code: string | null;
  location_code: string | null;
};

/** ກວດວ່າລາຍການເກົ່າກົດຊ້ອນກັບສິນຄ້າ + rack/location ທີ່ກຳລັງຈະບັນທຶກບໍ່ */
export function lineConflictsSlot(
  line: CountSlotLine,
  itemCode: string,
  rack: string | null,
  location: string | null,
): boolean {
  const ic = normalizeItemCode(itemCode);
  const lic = normalizeItemCode(line.item_code);
  if (!ic || !lic || ic !== lic) return false;
  return (
    normalizeSlotPart(line.rack_code) === normalizeSlotPart(rack) &&
    normalizeSlotPart(line.location_code) === normalizeSlotPart(location)
  );
}

/**
 * ວິທີສະແດງ ຊັ້ນວາງ (rack) ແລະ ບ່ອນເກັບ (location) ໃຫ້ຄົນອ່ານ.
 *
 * ພະນັກງານຢູ່ພື້ນຮູ້ຈັກຊັ້ນດ້ວຍ **ຊື່** ທີ່ຂຽນຕິດຢູ່ຊັ້ນ ("RACK M", "Z02") ບໍ່ແມ່ນ
 * ລະຫັດຂອງລະບົບ ("120213", "120213-Z02") ຊຶ່ງເປັນເລກຍາວທີ່ອ່ານຄືກັນໄປໝົດ ແລະ
 * ຜິດງ່າຍ. ກົດທີ່ໃຊ້ທົ່ວແອັບຈຶ່ງເປັນ **ຊື່ນຳ ລະຫັດຕາມ**.
 *
 * ບ່ອນທີ່ພື້ນທີ່ຈຳກັດ (ຊິບ, ຕາຕະລາງ) ໃຊ້ `nodeName()` ເອົາຊື່ຢ່າງດຽວ ແລ້ວເອົາ
 * ລະຫັດເຕັມ (`nodePath()`) ໄປໄວ້ໃນ `title` — ຍັງກວດລະຫັດໄດ້ ແຕ່ບໍ່ລົກຕາ.
 *
 * ບໍ່ແຕະຖານຂໍ້ມູນ — import ຈາກ client component ໄດ້.
 */

/** ຊື່ນຳ ລະຫັດຕາມ; ບໍ່ມີຊື່ (ຫຼື ຊື່ຊ້ຳລະຫັດ) ກໍ່ລະຫັດຢ່າງດຽວ. */
export function locLabel(code: string, name?: string | null): string {
  const n = name?.trim();
  return n && n !== code ? `${n} · ${code}` : code;
}

/** ລະຫັດ → ຊື່ ຂອງ rack ແລະ location ຂອງສາງໜຶ່ງ. */
export type NameBook = { rack: Map<string, string>; loc: Map<string, string> };

export const EMPTY_NAMES: NameBook = { rack: new Map(), loc: new Map() };

/** ສ້າງ NameBook ຈາກລາຍການ master ທີ່ໜ້າຈໍໂຫຼດມາຢູ່ແລ້ວ. */
export function nameBookOf(
  racks: { code: string; name: string | null }[],
  locations: { code: string; name: string | null }[],
): NameBook {
  const pick = (rows: { code: string; name: string | null }[]) =>
    new Map(
      rows
        .filter((r) => r.name?.trim())
        .map((r) => [r.code, (r.name as string).trim()] as const),
    );
  return { rack: pick(racks), loc: pick(locations) };
}

export type StorageNode = { rack?: string | null; location?: string | null; pallet?: string | null };

/** ເສັ້ນທາງເປັນ **ລະຫັດ** — ໃຊ້ເປັນ key, ເປັນ title ແລະ ບ່ອນທີ່ຕ້ອງທຽບກັບປ້າຍ. */
export function nodePath(n: StorageNode, empty = "ບໍ່ລະບຸ (ສາງລວມ)"): string {
  const parts = [n.rack, n.location].filter(Boolean) as string[];
  if (n.pallet) parts.push(`pallet:${n.pallet}`);
  return parts.length ? parts.join(" / ") : empty;
}

/** ເສັ້ນທາງເປັນ **ຊື່** — ບ່ອນທີ່ບໍ່ມີຊື່ ຕົກກັບໄປໃຊ້ລະຫັດ. */
export function nodeName(n: StorageNode, names: NameBook = EMPTY_NAMES, empty = "ບໍ່ລະບຸ (ສາງລວມ)"): string {
  const parts: string[] = [];
  if (n.rack) parts.push(names.rack.get(n.rack) ?? n.rack);
  if (n.location) parts.push(names.loc.get(n.location) ?? n.location);
  if (n.pallet) parts.push(`pallet:${n.pallet}`);
  return parts.length ? parts.join(" / ") : empty;
}

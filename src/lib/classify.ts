/**
 * ການຈັດປະເພດສິນຄ້າ ABC ແລະ FSN — logic ບໍລິສຸດ ບໍ່ແຕະຖານຂໍ້ມູນ.
 *
 * ດຶງອອກມາຈາກ `lib/coverage.ts` ດ້ວຍສອງເຫດຜົນ:
 *
 *   1. **ທົດສອບໄດ້.** coverage.ts import ຕົວເຊື່ອມຖານຂໍ້ມູນ ຈຶ່ງທົດສອບບໍ່ໄດ້
 *      ໂດຍບໍ່ຕໍ່ DB. ສອງ function ນີ້ເປັນຄະນິດສາດລ້ວນ — ໃສ່ຂໍ້ມູນເຂົ້າ ໄດ້ຄຳຕອບອອກ.
 *   2. **ຈະຖືກໃຊ້ຊ້ຳ.** ການນັບວົນ (cycle count) ແລະ ກົດການວາງເຄື່ອງ ຕ້ອງໃຊ້ ABC
 *      ອັນດຽວກັນນີ້. ຖ້າປະໄວ້ໃນ coverage.ts ຄົນຕໍ່ໄປຈະຄັດລອກສູດ ແລ້ວມັນຈະ
 *      ຄ່ອຍໆຕ່າງກັນ — ຊັ້ນ A ຂອງໜ້າໜຶ່ງບໍ່ຄືຊັ້ນ A ຂອງອີກໜ້າໜຶ່ງ.
 */

export type AbcClass = "A" | "B" | "C" | "none";
export type FsnClass = "F" | "S" | "N";

/** ຂອບເຂດຂອງ ABC: A = ຕົວທີ່ເລີ່ມກ່ອນ 80% ຂອງມູນຄ່າສະສົມ, B = ກ່ອນ 95%, ທີ່ເຫຼືອ C. */
export const ABC_CUT = { a: 0.8, b: 0.95 } as const;

/** ຂອບເຂດຂອງ FSN: F = ຕົວທີ່ເລີ່ມກ່ອນ 70% ຂອງຈຳນວນບິນສະສົມ. */
export const FSN_CUT = { f: 0.7 } as const;

/**
 * ຈັດ A/B/C ຕາມມູນຄ່າຂາຍ.
 *
 * ຄິດ **ພາຍໃນຂອບເຂດທີ່ສົ່ງເຂົ້າມາ** (ສາງ ຫຼື ກຸ່ມສາງ) ບໍ່ແມ່ນທັງບໍລິສັດ —
 * ເພາະການຈັດ slot ແລະ ຄວາມຖີ່ການນັບ ເປັນເລື່ອງຂອງສາງນັ້ນເອງ.
 *
 * ສິນຄ້າທີ່ບໍ່ມີການຂາຍເລີຍ (ມູນຄ່າ ≤ 0) ບໍ່ຖືກຈັດຊັ້ນ — ຄືນ "none".
 * ແກ້ໄຂ array ທີ່ສົ່ງເຂົ້າມາໂດຍກົງ ແລ້ວຄືນ array ດຽວກັນ (ຄືກັບພຶດຕິກຳເດີມ).
 */
export function classifyAbc<T extends { sale_amount: number; abc: AbcClass }>(
  items: T[],
): T[] {
  const selling = items
    .filter((i) => i.sale_amount > 0)
    .sort((a, b) => b.sale_amount - a.sale_amount);
  const total = selling.reduce((s, i) => s + i.sale_amount, 0);
  if (total > 0) {
    // ຕັດສິນຈາກສ່ວນແບ່ງສະສົມ **ກ່ອນ**ຕົວມັນເອງ ບໍ່ແມ່ນລວມຕົວມັນເອງ.
    //
    // ວິທີເກົ່າ (ລວມຕົວເອງ ແລ້ວທຽບ ≤ 0.8) ຈັດຕົວສຸດທ້າຍເປັນ C ສະເໝີ ເພາະສະສົມ
    // ຮອດ 1.00 ພໍດີ. ຜົນທີ່ເຫັນຊັດ: ສິນຄ້າ 3 ຕົວທີ່ຂາຍເທົ່າກັນເປັ໊ະ ຕົວທີສາມກາຍເປັນ C
    // ແລະ ຖ້າມີສິນຄ້າຂາຍພຽງຕົວດຽວ ຕົວນັ້ນກໍ່ເປັນ C ທັງທີ່ມັນຄື 100% ຂອງຍອດຂາຍ.
    //
    // ວິທີມາດຕະຖານແມ່ນ: ຕົວທີ່ **ເລີ່ມ** ຕ່ຳກວ່າ 80% ຍັງເປັນ A (ຕົວທີ່ພາຂ້າມເສັ້ນ
    // 80% ຖືກນັບເຂົ້າ A) — ຄືກັບທີ່ ERP ທົ່ວໄປເຮັດ. ເລື່ອງນີ້ສຳຄັນຂຶ້ນອີກເມື່ອ ABC
    // ຈະຖືກໃຊ້ຕັດສິນຄວາມຖີ່ການນັບ: ຈັດ A ເປັນ C = ນັບໜ້ອຍກວ່າທີ່ຄວນ.
    let before = 0;
    for (const i of selling) {
      const share = before / total;
      before += i.sale_amount;
      i.abc = share < ABC_CUT.a ? "A" : share < ABC_CUT.b ? "B" : "C";
    }
  }
  return items;
}

/**
 * ຈັດ F/S ຕາມຄວາມຖີ່ (ຈຳນວນບິນ).
 *
 * N (ບໍ່ມີການເຄື່ອນໄຫວເລີຍ) ຖືກຕັ້ງໄວ້ກ່ອນໜ້ານີ້ໂດຍຜູ້ເອີ້ນ — function ນີ້
 * ແຕະສະເພາະຕົວທີ່ມີບິນຫຼາຍກວ່າສູນ.
 */
export function classifyFsn<T extends { bills: number; fsn: FsnClass }>(
  items: T[],
): T[] {
  const moving = items.filter((i) => i.bills > 0).sort((a, b) => b.bills - a.bills);
  const total = moving.reduce((s, i) => s + i.bills, 0);
  if (total > 0) {
    // ວິທີດຽວກັບ ABC — ຕັດສິນຈາກສ່ວນແບ່ງກ່ອນຕົວເອງ ບໍ່ດັ່ງນັ້ນຕົວສຸດທ້າຍເປັນ S ສະເໝີ
    let before = 0;
    for (const i of moving) {
      const share = before / total;
      before += i.bills;
      i.fsn = share < FSN_CUT.f ? "F" : "S";
    }
  }
  return items;
}

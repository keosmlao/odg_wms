/**
 * ພະແນກທີ່ໃຊ້ WMS — ໜ້າ "ຈັດການສິດເຂົ້າເຖິງ" ສະແດງສະເພາະຄົນໃນພະແນກເຫຼົ່ານີ້.
 *
 * ບໍລິສັດມີພະນັກງານ ACTIVE ~243 ຄົນ ແຕ່ມີພຽງ 2 ພະແນກທີ່ແຕະ WMS ຈິງ ຈຶ່ງບໍ່ຄວນ
 * ເອົາທັງໝົດມາໃສ່ໜ້ານີ້ — 236 ແຖວ "ບໍ່ມີສິດ" ທີ່ບໍ່ກ່ຽວຂ້ອງເຮັດໃຫ້ຫາຄົນຈິງບໍ່ພົບ.
 *
 * ລະຫັດອີງ public.odg_department (department_code).
 */
export const WMS_DEPARTMENTS: { code: string; label: string }[] = [
  { code: "501", label: "ພະແນກສາງ" },
  { code: "801", label: "ພະແນກໄອທີ" },
];

export const WMS_DEPARTMENT_CODES: string[] = WMS_DEPARTMENTS.map((d) => d.code);

/** ຂໍ້ຄວາມບອກຂອບເຂດ ໃຫ້ UI ໃຊ້ຮ່ວມກັນ. */
export const WMS_DEPARTMENT_LABEL = WMS_DEPARTMENTS.map((d) => d.label).join(" + ");

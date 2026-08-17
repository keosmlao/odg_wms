/**
 * ພະແນກຫຼັກທີ່ໃຊ້ WMS.
 *
 * ໜ້າ "ຈັດການສິດເຂົ້າເຖິງ" ສະແດງພະນັກງານ ACTIVE **ທັງໝົດ** ເພື່ອໃຫ້ມອບສິດໃຫ້ໃຜກໍ່ໄດ້,
 * ລາຍການນີ້ຈຶ່ງບໍ່ແມ່ນຕົວກັ່ນຕອງອີກຕໍ່ໄປ — ໃຊ້ພຽງໝາຍ "ນອກພະແນກ" ໃສ່ຄົນທີ່ຖືສິດ WMS
 * ຢູ່ນອກສອງພະແນກນີ້ ເພື່ອໃຫ້ຜູ້ຈັດການເຫັນຈຸດທີ່ຄວນທົບທວນ.
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

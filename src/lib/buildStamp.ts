/**
 * ຕົວບອກ "ຮຸ່ນ" ຂອງ server ທີ່ກຳລັງແລ່ນຢູ່.
 *
 * ມີໄວ້ເພື່ອຕອບຄຳຖາມດຽວ: **browser ຂອງຄົນໃຊ້ໄດ້ໂຄ້ດໃໝ່ແລ້ວ ຫຼື ຍັງ?**
 * ກ່ອນນີ້ຕອບບໍ່ໄດ້ — ຕ້ອງເດົາເອົາຈາກໜ້າຕາທີ່ປ່ຽນ ຊຶ່ງພາໃຫ້ເສຍເວລາໄລ່ຫາ
 * ວ່າ deploy ບໍ່ຂຶ້ນ ຫຼື cache ຄ້າງ.
 *
 * ຄິດເທື່ອດຽວຕອນ process ເລີ່ມ — ການ deploy ທຸກຄັ້ງຈົບດ້ວຍ systemctl restart
 * ດັ່ງນັ້ນຄ່ານີ້ຈຶ່ງປ່ຽນທຸກ deploy (ຫຼັກການດຽວກັບຮຸ່ນ cache ໃນ app/sw.js/route.ts).
 */
const started = new Date();

/** ເຊັ່ນ "29/08 11:52" — ສັ້ນພໍໃສ່ທ້າຍແຖບຂ້າງ. */
export const BUILD_STAMP = `${String(started.getDate()).padStart(2, "0")}/${String(
  started.getMonth() + 1,
).padStart(2, "0")} ${String(started.getHours()).padStart(2, "0")}:${String(
  started.getMinutes(),
).padStart(2, "0")}`;

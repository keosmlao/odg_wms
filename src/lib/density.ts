/**
 * ຄວາມແໜ້ນຂອງໜ້າຈໍ (density) — ແນວຄິດຢືມມາຈາກ Odoo.
 *
 * ຕາຕະລາງໃນລະບົບນີ້ຕັ້ງ padding ໄວ້ຢູ່ລະດັບ "ສະບາຍຕາ" (py-2.5 ≈ 44px ຕໍ່ແຖວ)
 * ຊຶ່ງເໝາະກັບໜ້າທີ່ເປີດເບິ່ງເທື່ອດຽວ. ແຕ່ຄົນທີ່ນັ່ງເຮັດວຽກນີ້ທັງມື້ຕ້ອງການ
 * **ເຫັນຫຼາຍແຖວໃນໜ້າຈໍດຽວ** ຫຼາຍກວ່າຕ້ອງການບ່ອນຫາຍໃຈ — ນັ້ນຄືເຫດຜົນທີ່
 * ຕາຕະລາງຂອງ Odoo ສູງພຽງ ~28px ຕໍ່ແຖວ.
 *
 * ນີ້ເປັນຄ່າຂອງ **ເຄື່ອງ** ບໍ່ແມ່ນຂອງບັນຊີ (ຄືກັບໂໝດສີ) ແລະ ສະຫຼັບກັບໄປແບບເກົ່າ
 * ໄດ້ທັນທີ ຖ້າໜ້າໃດແໜ້ນເກີນໄປ.
 */
export type Density = "compact" | "cozy";

export const DENSITY_KEY = "wms.density";

/** ຄ່າເລີ່ມຕົ້ນ: ແໜ້ນ. ຄົນໃຊ້ WMS ຄືຄົນທີ່ເປີດໜ້ານີ້ຄ້າງໄວ້ທັງມື້. */
export const DEFAULT_DENSITY: Density = "compact";

/**
 * ແລ່ນກ່ອນ paint ຄັ້ງທຳອິດ (inline ຢູ່ root layout) — ບໍ່ດັ່ງນັ້ນຕາຕະລາງຈະ
 * ກະໂດດຈາກຫ່າງເປັນແໜ້ນໃຫ້ເຫັນທຸກເທື່ອທີ່ໂຫຼດໜ້າ.
 */
export const DENSITY_INIT_SCRIPT = `(function(){try{var d=localStorage.getItem(${JSON.stringify(
  DENSITY_KEY,
)});document.documentElement.setAttribute("data-density",d==="cozy"?"cozy":"compact");}catch(_){document.documentElement.setAttribute("data-density","compact");}})();`;

export function applyDensity(next: Density) {
  document.documentElement.setAttribute("data-density", next);
  try {
    localStorage.setItem(DENSITY_KEY, next);
  } catch {
    /* private mode — ຄ່າຈະບໍ່ຄ້າງຫຼັງ reload */
  }
}

export function readDensity(): Density {
  try {
    return localStorage.getItem(DENSITY_KEY) === "cozy" ? "cozy" : "compact";
  } catch {
    return DEFAULT_DENSITY;
  }
}

import type { PoolClient } from "pg";

/**
 * Reason codes for a SHORT movement — when a receive/return/issue moves less than
 * available (goods damaged, missing, wrong, refused, …). Stored in
 * `odg_wms_move_note` (migration 038).
 *
 * ການບັນທຶກ**ບໍ່ແມ່ນ best-effort ອີກຕໍ່ໄປ**: ເມື່ອກ່ອນ INSERT ຖືກຫຸ້ມດ້ວຍ
 * try/catch ເປົ່າ ແລະ ຕາຕະລາງບໍ່ເຄີຍຖືກສ້າງ — ເຫດຜົນທີ່ຜູ້ໃຊ້ພິມຈຶ່ງຫາຍໄປງຽບໆ
 * ທຸກເທື່ອ ໂດຍບໍ່ມີໃຜຮູ້. ຕອນນີ້ຖ້າບັນທຶກບໍ່ໄດ້ ໃຫ້ error ຂຶ້ນໄປ rollback
 * ການເຄື່ອນຍ້າຍທັງໜ່ວຍ — ດີກວ່າໄດ້ຕົວເລກທີ່ບໍ່ມີເຫດຜົນກຳກັບ.
 */
export const MOVE_REASONS: { code: string; label: string }[] = [
  { code: "damaged", label: "ສິນຄ້າຊຳລຸດ / ເສຍຫາຍ" },
  { code: "missing", label: "ສິນຄ້າຂາດ / ສູນຫາຍ" },
  { code: "wrong", label: "ສົ່ງຜິດ / ບໍ່ກົງລາຍການ" },
  { code: "refused", label: "ປະຕິເສດ / ບໍ່ຮັບ" },
  { code: "partial", label: "ທະຍອຍຮັບ (ຈະຮັບສ່ວນທີ່ເຫຼືອພາຍຫຼັງ)" },
  { code: "other", label: "ອື່ນໆ" },
];
const VALID = new Set(MOVE_REASONS.map((r) => r.code));

export type MoveNote = { item_code: string; reason_code: string; reason_text?: string | null; short_qty?: number | null };

/** ບັນທຶກເຫດຜົນ — ລົ້ມເຫຼວ = throw ໃຫ້ transaction ຂອງຜູ້ເອີ້ນ rollback. */
export async function saveMoveNotes(
  client: PoolClient,
  p: { docNo: string; refDoc: string | null; stage: string; user: string | null; notes: MoveNote[] },
): Promise<void> {
  const valid = p.notes.filter((n) => n.item_code && VALID.has(n.reason_code));
  if (valid.length === 0) return;
  for (const n of valid) {
    await client.query(
      `INSERT INTO public.odg_wms_move_note (doc_no, ref_doc, item_code, reason_code, reason_text, short_qty, stage, user_created, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [p.docNo, p.refDoc, n.item_code, n.reason_code, n.reason_text ?? null, n.short_qty ?? null, p.stage, p.user],
    );
  }
}

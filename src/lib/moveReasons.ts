import type { PoolClient } from "pg";

/**
 * Reason codes for a SHORT movement — when a receive/return/issue moves less than
 * available (goods damaged, missing, wrong, refused, …). Stored in
 * `odg_wms_move_note` (run the DDL below once on the ERP DB):
 *
 *   CREATE TABLE IF NOT EXISTS public.odg_wms_move_note (
 *     roworder    bigserial PRIMARY KEY,
 *     doc_no      varchar(40),   -- the WMS DP doc
 *     ref_doc     varchar(40),   -- the 124 / source doc
 *     item_code   varchar(40),
 *     reason_code varchar(20),
 *     reason_text varchar(200),
 *     short_qty   numeric,
 *     stage       varchar(20),   -- receive | return | issue
 *     user_created varchar(40),
 *     created_at  timestamp DEFAULT now()
 *   );
 *
 * Inserts are best-effort: if the table is missing the movement still succeeds.
 */
export const MOVE_REASONS: { code: string; label: string }[] = [
  { code: "damaged", label: "ສິນຄ້າຊຳລຸດ / ເສຍຫາຍ" },
  { code: "missing", label: "ສິນຄ້າຂາດ / ສູນหาย" },
  { code: "wrong", label: "ສົ່ງຜິດ / ບໍ່ກົງລາຍການ" },
  { code: "refused", label: "ປฏิเสธ / ບໍ່ຮັບ" },
  { code: "partial", label: "ທະຍอยรับ (จะรับส่วนที่เหลือภายหลัง)" },
  { code: "other", label: "ອື່ນໆ" },
];
const VALID = new Set(MOVE_REASONS.map((r) => r.code));

export type MoveNote = { item_code: string; reason_code: string; reason_text?: string | null; short_qty?: number | null };

/** Best-effort insert of short-movement notes; never throws (missing table is OK). */
export async function saveMoveNotes(
  client: PoolClient,
  p: { docNo: string; refDoc: string | null; stage: string; user: string | null; notes: MoveNote[] },
): Promise<void> {
  const valid = p.notes.filter((n) => n.item_code && VALID.has(n.reason_code));
  if (valid.length === 0) return;
  try {
    for (const n of valid) {
      await client.query(
        `INSERT INTO public.odg_wms_move_note (doc_no, ref_doc, item_code, reason_code, reason_text, short_qty, stage, user_created, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [p.docNo, p.refDoc, n.item_code, n.reason_code, n.reason_text ?? null, n.short_qty ?? null, p.stage, p.user],
      );
    }
  } catch {
    // table not created yet — skip silently so the movement still commits.
  }
}

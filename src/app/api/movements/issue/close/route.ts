import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { ISSUE_CLOSE_REASON_CODES } from "@/lib/issueClose";

/**
 * "ປິດງານ" — hide one pending-to-issue bill (sale/req/transfer) out of the
 * `/api/movements/issue/pending` list, with a reason, WITHOUT touching its
 * source document (ic_trans) or posting anything against it. Reversible only
 * by deleting the row from `wms_issue_close` directly (no UI for that — this
 * is meant for the "data doesn't match reality" case, not routine workflow).
 *
 * POST { doc_no, wh_code, type: "req"|"transfer"|"sale", reason_code, reason_text? }
 */
const FLAG_BY_TYPE: Record<string, number> = { req: 122, transfer: 124, sale: 44 };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }

  const doc_no = str(body.doc_no);
  const wh_code = str(body.wh_code);
  const type = str(body.type);
  const reason_code = str(body.reason_code);
  const reason_text = str(body.reason_text) || null;

  if (!doc_no || !wh_code) return NextResponse.json({ error: "ບໍ່ມີເລກທີ່ເອກະສານ ຫຼື ສາງ" }, { status: 400 });
  const trans_flag = FLAG_BY_TYPE[type];
  if (trans_flag === undefined) return NextResponse.json({ error: "ປະເພດເອກະສານບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (!ISSUE_CLOSE_REASON_CODES.has(reason_code)) return NextResponse.json({ error: "ກະລຸນາເລືອກເຫດຜົນ" }, { status: 400 });
  if (reason_code === "other" && !reason_text) return NextResponse.json({ error: "ກະລຸນາລະບຸເຫດຜົນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh_code)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  await query(
    `INSERT INTO public.wms_issue_close (doc_no, wh_code, trans_flag, reason_code, reason_text, user_created, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (doc_no, wh_code) DO UPDATE
       SET trans_flag = EXCLUDED.trans_flag, reason_code = EXCLUDED.reason_code,
           reason_text = EXCLUDED.reason_text, user_created = EXCLUDED.user_created, created_at = now()`,
    [doc_no, wh_code, trans_flag, reason_code, reason_text, session.employee_code ?? null],
  );

  return NextResponse.json({ ok: true });
}

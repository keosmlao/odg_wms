import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ອະນຸມັດ ໃບຂໍໂອນ — the SOURCE warehouse (wh_from, the owner of the goods) reviews
 * a transfer request (124) and approves or rejects it. Only an APPROVED request
 * (ic_trans.status = 1) can be fulfilled by the goods-issue flow.
 *
 * status: 0 = ລໍຖ້າອະນຸມັດ · 1 = ອະນຸມັດ · 2 = ປະຕິເສດ
 *
 * GET            → requests awaiting approval for a source the user owns
 * GET ?doc=<124> → that request's lines + source stock availability
 * POST {doc, action:'approve'|'reject', reason?} → set status
 */
const FLAG = 124;

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ docs: [] });

  const url = new URL(request.url);
  const doc = url.searchParams.get("doc")?.trim() ?? "";

  if (doc) {
    const head = await query<{ wh_from: string | null }>(
      `SELECT wh_from FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1`,
      [doc],
    );
    const src = head[0]?.wh_from ?? "";
    // Lines with source stock availability so the approver can judge.
    const lines = await query<{ item_code: string; item_name: string | null; unit_code: string | null; req_qty: string; available: string }>(
      `WITH req AS (
         SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code, SUM(qty) AS req_qty
         FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = ${FLAG} GROUP BY item_code
       ),
       bal AS (
         SELECT item_code, SUM(qty * calc_flag) AS available
         FROM public.odg_wms_trans_detail
         WHERE wh_code = $2 AND (status = 0 OR status IS NULL) GROUP BY item_code
       )
       SELECT r.item_code, r.item_name, r.unit_code,
              r.req_qty::numeric::text AS req_qty,
              COALESCE(b.available, 0)::numeric::text AS available
       FROM req r LEFT JOIN bal b ON b.item_code = r.item_code
       ORDER BY r.item_code`,
      [doc, src],
    );
    return NextResponse.json({ doc, lines });
  }

  const args: unknown[] = [];
  let whClause = "";
  if (Array.isArray(accessible)) { args.push(accessible); whClause = `AND h.wh_from = ANY($${args.length})`; }
  const docs = await query<{
    doc_no: string; doc_date: string | null; doc_time: string | null; wh_from: string | null; wh_to: string | null;
    wh_from_name: string | null; wh_to_name: string | null; remark: string | null; want_date: string | null;
    creator_code: string | null; line_count: number; req_qty: string;
  }>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time, h.wh_from, h.wh_to,
            wf.name_1 AS wh_from_name, wt.name_1 AS wh_to_name, h.remark, to_char(h.want_date,'YYYY-MM-DD') AS want_date, h.creator_code,
            (SELECT count(*)::int FROM public.ic_trans_detail d WHERE d.doc_no = h.doc_no AND d.trans_flag = ${FLAG}) AS line_count,
            (SELECT COALESCE(SUM(qty),0) FROM public.ic_trans_detail d WHERE d.doc_no = h.doc_no AND d.trans_flag = ${FLAG})::numeric::text AS req_qty
     FROM public.ic_trans h
     JOIN public.ic_warehouse wf ON wf.code = h.wh_from
     LEFT JOIN public.ic_warehouse wt ON wt.code = h.wh_to
     WHERE h.trans_flag = ${FLAG} AND COALESCE(h.status,0) = 0 AND COALESCE(h.is_cancel,0) = 0 ${whClause}
     ORDER BY h.doc_no DESC LIMIT 100`,
    args,
  );
  return NextResponse.json({ docs });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const doc = str(body.doc);
  const action = str(body.action);
  if (!doc || (action !== "approve" && action !== "reject")) return NextResponse.json({ error: "ຄຳສັ່ງບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query<{ wh_from: string | null; status: number | null }>(
      `SELECT wh_from, status FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1`,
      [doc],
    );
    const src = hdr.rows[0]?.wh_from ?? "";
    if (!src) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍໂອນ" }, { status: 404 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(src)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດ ອະນຸມັດ ໃບນີ້ (ບໍ່ແມ່ນສາງຕົ້ນທາງຂອງທ່ານ)" }, { status: 403 });
    }
    if ((hdr.rows[0]?.status ?? 0) !== 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບນີ້ຖືກດຳເນີນການແລ້ວ" }, { status: 409 });
    }
    const newStatus = action === "approve" ? 1 : 2;
    await client.query(`UPDATE public.ic_trans SET status = $2 WHERE doc_no = $1 AND trans_flag = ${FLAG}`, [doc, newStatus]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: doc, status: newStatus });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { nextErpDocNo } from "@/lib/erpPost";
import { MOVE_REASONS } from "@/lib/moveReasons";

const REASON_LABEL = Object.fromEntries(MOVE_REASONS.map((r) => [r.code, r.label]));

/**
 * Create a transfer request (ໃບຂໍໂອນ, ic_trans trans_flag 124, format FR). This is
 * a REQUEST only — calc_flag 0, no stock movement. The destination warehouse
 * (wh_to) asks for goods from a source warehouse (wh_from); the source later
 * fulfils it via the goods-issue flow (which posts the ໃບໂອນ 70+72).
 *
 * GET  → warehouses + item search passthrough is done elsewhere; here POST only.
 */
const FLAG = 124;
const FORMAT = "FR";
const TRANS_TYPE = 3;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }

  const whFrom = str(body.wh_from);   // ສາງຕົ້ນທາງ (ມີສິນຄ້າ)
  const whTo = str(body.wh_to);       // ສາງປາຍທາງ (ຜູ້ຂໍ)
  const locFrom = str(body.location_from);
  const locTo = str(body.location_to);
  const title = str(body.doc_ref) || str(body.remark);
  const remark = str(body.remark);
  const wantDate = str(body.want_date); // ວັນທີ່ຕ້ອງการรับสินค้า (YYYY-MM-DD)
  if (!whFrom || !whTo) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງຕົ້ນທາງ ແລະ ປາຍທາງ" }, { status: 400 });
  if (whFrom === whTo) return NextResponse.json({ error: "ສາງຕົ້ນທາງ ແລະ ປາຍທາງ ຕ້ອງຕ່າງกัน" }, { status: 400 });

  // The requester (destination warehouse) must be accessible to the user.
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(whTo)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດສ້າງໃບຂໍ ສຳລັບສາງປາຍທາງນີ້" }, { status: 403 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຂໍໂອນ" }, { status: 400 });
  }
  const lines: { item_code: string; item_name: string | null; unit_code: string | null; qty: number }[] = [];
  const seen = new Set<string>();
  for (const raw of body.lines as Record<string, unknown>[]) {
    const item_code = str(raw.item_code);
    if (!item_code || seen.has(item_code)) continue;
    seen.add(item_code);
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) return NextResponse.json({ error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code) || null, qty });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຂໍໂອນ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const docNo = await nextErpDocNo(client, FORMAT);
    await client.query(
      `INSERT INTO public.ic_trans
         (trans_type, trans_flag, doc_date, doc_no, doc_format_code, branch_code,
          wh_from, location_from, wh_to, location_to, doc_ref, remark, status,
          doc_time, creator_code, want_date, create_date_time_now)
       VALUES ($1, $2, CURRENT_DATE, $3, $4, '00', $5, $6, $7, $8, $9, $10, 0,
               to_char(now(),'HH24:MI'), $11, $12::date, now())`,
      [TRANS_TYPE, FLAG, docNo, FORMAT, whFrom, locFrom || null, whTo, locTo || null, title || null, remark || null, session.employee_code, wantDate || null],
    );
    let line = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO public.ic_trans_detail
           (trans_type, trans_flag, doc_date, doc_no, item_code, item_name, unit_code,
            qty, calc_flag, wh_code, shelf_code, wh_code_2, shelf_code_2, branch_code,
            line_number, stand_value, divide_value, is_get_price, ref_row, status, doc_time, create_date_time_now)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, '00',
                 $12, 1, 1, 1, -1, 0, to_char(now(),'HH24:MI'), now())`,
        [TRANS_TYPE, FLAG, docNo, l.item_code, l.item_name, l.unit_code, l.qty, whFrom, locFrom || null, whTo, locTo || null, line++],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo, lines: lines.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * Cancel (void) a ໃບຂໍໂອນ (124) — only while UNTOUCHED: nothing issued into the
 * in-transit warehouse and not yet pulled into a pick draft. Deletes the ic_trans
 * header + detail. Once fulfilment has started it must be unwound via the
 * receive/return + issue-delete flows instead.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const doc = new URL(request.url).searchParams.get("doc")?.trim() ?? "";
  if (!doc) return NextResponse.json({ error: "ບໍ່ມີເລກທີ່ໃບຂໍໂອນ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query<{ wh_to: string | null }>(
      `SELECT wh_to FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1`,
      [doc],
    );
    const whTo = hdr.rows[0]?.wh_to ?? "";
    if (!whTo) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍໂອນ" }, { status: 404 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(whTo)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດຍົກເລີກໃບนี้" }, { status: 403 });
    }
    // Block if fulfilment already started (any WMS movement or pick draft on this ref).
    const used = await client.query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM public.odg_wms_trans_detail WHERE doc_ref = $1 AND trans_flag = 72)
             + (SELECT count(*) FROM public.wms_product_out WHERE ref_doc_no = $1))::text AS n`,
      [doc],
    );
    if ((Number.parseInt(used.rows[0]?.n ?? "0", 10) || 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ຍົກເລີກບໍ່ໄດ້ — ໃບนี้ເລີ່ມຈ່າຍ/ດຶງไปแล้ว" }, { status: 409 });
    }
    await client.query(`DELETE FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = ${FLAG}`, [doc]);
    await client.query(`DELETE FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG}`, [doc]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: doc });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * Edit a ໃບຂໍໂອນ (124) — only while UNTOUCHED (nothing issued/pulled). Updates the
 * source warehouse, want_date, remark and replaces the line items. The doc_no and
 * requester (wh_to) are immutable.
 */
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const doc = str(body.doc);
  const whFrom = str(body.wh_from);
  const wantDate = str(body.want_date);
  const title = str(body.doc_ref) || str(body.remark);
  if (!doc) return NextResponse.json({ error: "ບໍ່ມີເລກທີ່ໃບຂໍໂອນ" }, { status: 400 });
  if (!whFrom) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງຕົ້ນທາງ" }, { status: 400 });
  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການ" }, { status: 400 });

  const lines: { item_code: string; item_name: string | null; unit_code: string | null; qty: number }[] = [];
  const seen = new Set<string>();
  for (const raw of body.lines as Record<string, unknown>[]) {
    const item_code = str(raw.item_code);
    if (!item_code || seen.has(item_code)) continue;
    seen.add(item_code);
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) return NextResponse.json({ error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code) || null, qty });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query<{ wh_to: string | null }>(
      `SELECT wh_to FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1`,
      [doc],
    );
    const whTo = hdr.rows[0]?.wh_to ?? "";
    if (!whTo) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍໂອນ" }, { status: 404 }); }
    if (whFrom === whTo) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ສາງຕົ້ນທາງ ແລະ ປາຍທາງ ຕ້ອງຕ່າງกัน" }, { status: 400 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(whTo)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດແກ້ໄຂໃບนี้" }, { status: 403 });
    }
    const used = await client.query<{ n: string }>(
      `SELECT ((SELECT count(*) FROM public.odg_wms_trans_detail WHERE doc_ref = $1 AND trans_flag = 72)
             + (SELECT count(*) FROM public.wms_product_out WHERE ref_doc_no = $1))::text AS n`,
      [doc],
    );
    if ((Number.parseInt(used.rows[0]?.n ?? "0", 10) || 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ແກ້ໄຂບໍ່ໄດ້ — ໃບนี้ເລີ່ມຈ່າຍ/ດຶງไปแล้ว" }, { status: 409 });
    }
    // Editing returns the request to "awaiting approval" (status 0).
    await client.query(
      `UPDATE public.ic_trans SET wh_from = $2, want_date = $3::date, doc_ref = $4, remark = $4, status = 0 WHERE doc_no = $1 AND trans_flag = ${FLAG}`,
      [doc, whFrom, wantDate || null, title || null],
    );
    await client.query(`DELETE FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = ${FLAG}`, [doc]);
    let line = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO public.ic_trans_detail
           (trans_type, trans_flag, doc_date, doc_no, item_code, item_name, unit_code,
            qty, calc_flag, wh_code, shelf_code, wh_code_2, shelf_code_2, branch_code,
            line_number, stand_value, divide_value, is_get_price, ref_row, status, doc_time, create_date_time_now)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, 0, $8, NULL, $9, NULL, '00',
                 $10, 1, 1, 1, -1, 0, to_char(now(),'HH24:MI'), now())`,
        [TRANS_TYPE, FLAG, doc, l.item_code, l.item_name, l.unit_code, l.qty, whFrom, whTo, line++],
      );
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: doc, lines: lines.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

// Transfer requests (124) created by the user's warehouses (wh_to = requester).
const PAGE = 20;
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ docs: [], has_more: false, page: 0 });

  const url = new URL(request.url);

  // Detail mode: the request's line items (requested vs already issued vs remaining).
  const doc = url.searchParams.get("doc")?.trim() ?? "";
  if (doc) {
    // issued = goods placed INTO the in-transit warehouse (9903); in_transit =
    // what is still parked there awaiting receive; received = landed at the dest.
    const lines = await query<{ item_code: string; item_name: string | null; unit_code: string | null; req_qty: string; issued: string; in_transit: string; received: string; remaining: string }>(
      `WITH h AS (
         SELECT wh_from, wh_to FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1
       ),
       req AS (
         SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code, SUM(qty) AS req_qty
         FROM public.ic_trans_detail WHERE doc_no = $1 AND trans_flag = ${FLAG} GROUP BY item_code
       ),
       mv AS (
         SELECT d.item_code,
                COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = '9903'), 0) AS issued,
                COALESCE(SUM(d.qty * d.calc_flag) FILTER (WHERE d.wh_code = '9903'), 0) AS in_transit,
                COALESCE(SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = (SELECT wh_to FROM h)), 0) AS received
         FROM public.odg_wms_trans_detail d
         WHERE d.doc_ref = $1 AND d.trans_flag = 72 GROUP BY d.item_code
       )
       SELECT r.item_code, r.item_name, r.unit_code,
              r.req_qty::numeric::text AS req_qty,
              COALESCE(m.issued, 0)::numeric::text AS issued,
              COALESCE(m.in_transit, 0)::numeric::text AS in_transit,
              COALESCE(m.received, 0)::numeric::text AS received,
              (r.req_qty - COALESCE(m.issued, 0))::numeric::text AS remaining
       FROM req r LEFT JOIN mv m ON m.item_code = r.item_code
       ORDER BY r.item_code`,
      [doc],
    );
    // Short-movement reasons for this request (table may not exist → degrade).
    const notes: Record<string, string> = {};
    try {
      const nr = await query<{ item_code: string; reason_code: string | null }>(
        `SELECT DISTINCT ON (item_code) item_code, reason_code FROM public.odg_wms_move_note WHERE ref_doc = $1 ORDER BY item_code, created_at DESC`,
        [doc],
      );
      for (const n of nr) notes[n.item_code] = REASON_LABEL[n.reason_code ?? ""] ?? (n.reason_code ?? "");
    } catch { /* table not created yet */ }
    return NextResponse.json({ doc, lines, notes });
  }

  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from")?.trim() || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = url.searchParams.get("to")?.trim() || today;
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);

  const args: unknown[] = [from, to];
  let whClause = "";
  const whParam = url.searchParams.get("wh")?.trim();
  if (whParam && (accessible === null || accessible.includes(whParam))) {
    args.push(whParam); whClause = `AND h.wh_to = $${args.length}`;
  } else if (Array.isArray(accessible)) {
    args.push(accessible); whClause = `AND h.wh_to = ANY($${args.length})`;
  }
  let qClause = "";
  const q = url.searchParams.get("q")?.trim();
  if (q) { args.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`); qClause = `AND h.doc_no ILIKE $${args.length} ESCAPE '\\'`; }
  args.push(PAGE + 1, page * PAGE);

  const docs = await query<{
    doc_no: string; doc_date: string | null; doc_time: string | null; wh_from: string | null; wh_to: string | null;
    wh_from_name: string | null; wh_to_name: string | null; remark: string | null; status: number | null;
    creator_code: string | null; want_date: string | null; line_count: number; pulled: number;
    req_qty: string; to_transit: string; in_transit: string; received: string;
  }>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time, h.wh_from, h.wh_to,
            wf.name_1 AS wh_from_name, wt.name_1 AS wh_to_name, h.remark, h.status, h.creator_code,
            to_char(h.want_date,'YYYY-MM-DD') AS want_date,
            (SELECT count(*)::int FROM public.ic_trans_detail d WHERE d.doc_no = h.doc_no AND d.trans_flag = ${FLAG}) AS line_count,
            (SELECT count(*)::int FROM public.wms_product_out o WHERE o.ref_doc_no = h.doc_no) AS pulled,
            (SELECT COALESCE(SUM(qty),0) FROM public.ic_trans_detail d WHERE d.doc_no = h.doc_no AND d.trans_flag = ${FLAG})::numeric::text AS req_qty,
            COALESCE(m.to_transit,0)::numeric::text AS to_transit,
            COALESCE(m.in_transit,0)::numeric::text AS in_transit,
            COALESCE(m.received,0)::numeric::text AS received
     FROM public.ic_trans h
     LEFT JOIN public.ic_warehouse wf ON wf.code = h.wh_from
     LEFT JOIN public.ic_warehouse wt ON wt.code = h.wh_to
     LEFT JOIN LATERAL (
       SELECT SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = '9903') AS to_transit,
              SUM(d.qty * d.calc_flag) FILTER (WHERE d.wh_code = '9903') AS in_transit,
              SUM(d.qty) FILTER (WHERE d.calc_flag = 1 AND d.wh_code = h.wh_to) AS received
       FROM public.odg_wms_trans_detail d WHERE d.doc_ref = h.doc_no AND d.trans_flag = 72
     ) m ON TRUE
     WHERE h.trans_flag = ${FLAG} AND h.doc_date BETWEEN $1 AND $2 ${whClause} ${qClause}
     ORDER BY h.doc_no DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  const hasMore = docs.length > PAGE;
  // Preview the next FR doc_no (the real one is allocated under lock at save).
  const nx = await query<{ doc_no: string }>(
    `SELECT '${FORMAT}' || to_char(CURRENT_DATE,'YYMM') ||
            lpad((COALESCE(MAX(substring(doc_no from char_length('${FORMAT}')+5)::int), 0) + 1)::text, 4, '0') AS doc_no
     FROM public.ic_trans
     WHERE doc_format_code = '${FORMAT}'
       AND doc_no LIKE '${FORMAT}' || to_char(CURRENT_DATE,'YYMM') || '%'
       AND substring(doc_no from char_length('${FORMAT}')+5) ~ '^[0-9]+$'`,
  );
  return NextResponse.json({ docs: docs.slice(0, PAGE), has_more: hasMore, page, from, to, next_doc_no: nx[0]?.doc_no ?? "" });
}

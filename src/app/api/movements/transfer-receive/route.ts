import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { IN_TRANSIT_WH } from "@/lib/erpPost";
import { moveFromTransit, type TransitLine } from "@/lib/transferMove";

/**
 * ຮັບໂອນ — the destination warehouse pulls a 124 transfer out of the in-transit
 * warehouse (9903) into its own stock, by ACTUAL quantity. Anything left in
 * 9903 (received < issued) stays pending for both sides.
 *
 * GET                → transfers with goods waiting in 9903 for a dest the user owns
 * GET ?doc=<124>     → that transfer's lines (in-transit / received) + serials in 9903
 * POST {doc, location_to, lines:[{item_code, qty, serials}]} → receive
 */
const REQ_FLAG = 124;

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ docs: [] });

  const url = new URL(request.url);
  const doc = url.searchParams.get("doc")?.trim() ?? "";

  // History: completed receives (DP docs out of 9903 into a dest the user owns).
  if (url.searchParams.get("history")) {
    const args: unknown[] = [IN_TRANSIT_WH];
    let whClause = "";
    if (Array.isArray(accessible)) { args.push(accessible); whClause = `AND t.wh_code = ANY($${args.length})`; }
    const hist = await query<{ doc_no: string; doc_date: string | null; doc_time: string | null; doc_ref: string | null; wh_code: string | null; wh_name: string | null; items: number; qty: string }>(
      `SELECT t.doc_no, to_char(t.doc_date,'YYYY-MM-DD') AS doc_date, t.doc_time, t.doc_ref, t.wh_code, w.name_1 AS wh_name,
              agg.items, agg.qty::numeric::text AS qty
       FROM public.odg_wms_trans t
       JOIN public.ic_warehouse w ON w.code = t.wh_code
       JOIN public.ic_trans r ON r.doc_no = t.doc_ref AND r.trans_flag = ${REQ_FLAG} AND r.wh_to = t.wh_code
       JOIN LATERAL (
         SELECT count(DISTINCT item_code) AS items, COALESCE(SUM(qty) FILTER (WHERE calc_flag = 1),0) AS qty
         FROM public.odg_wms_trans_detail d WHERE d.doc_no = t.doc_no
       ) agg ON TRUE
       WHERE t.doc_no LIKE 'DP%'
         AND EXISTS (SELECT 1 FROM public.odg_wms_trans_detail d WHERE d.doc_no = t.doc_no AND d.calc_flag = -1 AND d.wh_code = $1)
         ${whClause}
       ORDER BY t.doc_no DESC LIMIT 50`,
      args,
    );
    return NextResponse.json({ history: hist });
  }

  if (doc) {
    // The 124 header (source/dest) + per-item in-transit balance + serials in 9903.
    const head = await query<{ wh_from: string | null; wh_to: string | null; wh_from_name: string | null; wh_to_name: string | null }>(
      `SELECT h.wh_from, h.wh_to, wf.name_1 AS wh_from_name, wt.name_1 AS wh_to_name
       FROM public.ic_trans h
       LEFT JOIN public.ic_warehouse wf ON wf.code = h.wh_from
       LEFT JOIN public.ic_warehouse wt ON wt.code = h.wh_to
       WHERE h.doc_no = $1 AND h.trans_flag = ${REQ_FLAG} LIMIT 1`,
      [doc],
    );
    const lines = await query<{ item_code: string; item_name: string | null; unit_code: string | null; in_transit: string; received: string; serialized: boolean }>(
      `SELECT t.item_code,
              MAX(t.item_name) AS item_name,
              MAX(t.unit_code) AS unit_code,
              COALESCE(SUM(t.qty * t.calc_flag) FILTER (WHERE t.wh_code = $2), 0)::numeric::text AS in_transit,
              COALESCE(SUM(t.qty) FILTER (WHERE t.calc_flag = 1 AND t.wh_code = $3), 0)::numeric::text AS received,
              EXISTS (SELECT 1 FROM public.sn_inventory s
                      WHERE s.item_code = t.item_code AND s.wh_code = $2 AND s.location = $1 AND COALESCE(s.status,0)=0) AS serialized
       FROM public.odg_wms_trans_detail t
       WHERE t.doc_ref = $1 AND t.trans_flag = 72 AND (t.status = 0 OR t.status IS NULL)
         AND t.item_code NOT LIKE '97%'
       GROUP BY t.item_code
       HAVING COALESCE(SUM(t.qty * t.calc_flag) FILTER (WHERE t.wh_code = $2), 0) > 0
       ORDER BY t.item_code`,
      [doc, IN_TRANSIT_WH, head[0]?.wh_to ?? ""],
    );
    // Serials currently parked in 9903 for this ref (to scan against on receive).
    const serials = await query<{ item_code: string; sn: string | null; isn: string | null; id: string }>(
      `SELECT item_code, sn, isn, COALESCE(NULLIF(sn,''), isn) AS id
       FROM public.sn_inventory
       WHERE wh_code = $1 AND location = $2 AND COALESCE(status,0)=0
       ORDER BY item_code, id`,
      [IN_TRANSIT_WH, doc],
    );
    const dest = head[0]?.wh_to ?? "";
    const items = lines.map((l) => l.item_code);
    // Putaway suggestions: all existing locations (datalist).
    const locRows = await query<{ location: string }>(
      `SELECT DISTINCT NULLIF(TRIM(shelf_code1), '') AS location
       FROM public.odg_wms_trans_detail
       WHERE wh_code = $1 AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL
       ORDER BY location LIMIT 300`,
      [dest],
    );
    // ① location ທີ່ມີສິນຄ້າດຽວກັນຢູ່ແລ້ວ (รวมกอง) — ของ items ในใบนี้ ที่ยังมี stock
    const sameLocs = items.length > 0 ? await query<{ location: string; item_code: string; qty: string }>(
      `SELECT NULLIF(TRIM(shelf_code1), '') AS location, item_code, SUM(qty * calc_flag)::numeric::text AS qty
       FROM public.odg_wms_trans_detail
       WHERE wh_code = $1 AND item_code = ANY($2) AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL
         AND (status = 0 OR status IS NULL)
       GROUP BY 1, item_code HAVING SUM(qty * calc_flag) > 0.0001
       ORDER BY SUM(qty * calc_flag) DESC LIMIT 30`,
      [dest, items],
    ) : [];
    // ② location ວ່າง (เคยใช้ แต่ตอนนี้ยอด 0)
    const emptyLocs = await query<{ location: string }>(
      `SELECT location FROM (
         SELECT NULLIF(TRIM(shelf_code1), '') AS location, SUM(qty * calc_flag) AS bal
         FROM public.odg_wms_trans_detail
         WHERE wh_code = $1 AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL AND (status = 0 OR status IS NULL)
         GROUP BY 1
       ) x WHERE bal <= 0.0001 ORDER BY location LIMIT 30`,
      [dest],
    );
    return NextResponse.json({
      doc, header: head[0] ?? null, lines, serials,
      locations: locRows.map((r) => r.location),
      sameLocs, emptyLocs: emptyLocs.map((r) => r.location),
    });
  }

  // List transfers that still have goods in 9903 for a dest the user can receive.
  const args: unknown[] = [IN_TRANSIT_WH];
  let whClause = "";
  if (Array.isArray(accessible)) { args.push(accessible); whClause = `AND h.wh_to = ANY($${args.length})`; }
  const docs = await query<{
    doc_no: string; doc_date: string | null; wh_from: string | null; wh_to: string | null;
    wh_from_name: string | null; wh_to_name: string | null; items: number; in_transit: string;
  }>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.wh_from, h.wh_to,
            wf.name_1 AS wh_from_name, wt.name_1 AS wh_to_name,
            agg.items, agg.in_transit::numeric::text AS in_transit
     FROM public.ic_trans h
     JOIN public.ic_warehouse wt ON wt.code = h.wh_to
     LEFT JOIN public.ic_warehouse wf ON wf.code = h.wh_from
     JOIN (
       SELECT doc_ref,
              count(DISTINCT item_code) FILTER (WHERE bal > 0) AS items,
              SUM(bal) FILTER (WHERE bal > 0) AS in_transit
       FROM (
         SELECT doc_ref, item_code, SUM(qty * calc_flag) AS bal
         FROM public.odg_wms_trans_detail
         WHERE wh_code = $1 AND trans_flag = 72 AND (status = 0 OR status IS NULL)
         GROUP BY doc_ref, item_code
       ) b
       GROUP BY doc_ref
     ) agg ON agg.doc_ref = h.doc_no
     WHERE h.trans_flag = ${REQ_FLAG} AND agg.in_transit > 0 ${whClause}
     ORDER BY h.doc_no DESC
     LIMIT 100`,
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
  if (!doc) return NextResponse.json({ error: "ບໍ່ມີເລກທີ່ໃບຂໍໂອນ" }, { status: 400 });
  const locTo = str(body.location_to) || null;
  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຮັບ" }, { status: 400 });

  const lines: TransitLine[] = [];
  for (const raw of body.lines as Record<string, unknown>[]) {
    const item_code = str(raw.item_code);
    const qty = num(raw.qty);
    if (!item_code || qty === null || qty <= 0) continue;
    const serials = Array.isArray(raw.serials) ? (raw.serials as unknown[]).map(str).filter(Boolean) : [];
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code) || null, qty, serials, location: str(raw.location) || null });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຮັບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const head = await client.query<{ wh_to: string | null }>(
      `SELECT wh_to FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${REQ_FLAG} LIMIT 1`,
      [doc],
    );
    const whTo = head.rows[0]?.wh_to ?? "";
    if (!whTo) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍໂອນ" }, { status: 404 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(whTo)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດຮັບເຂົ້າสาງปลายทางนี้" }, { status: 403 });
    }
    const notes = Array.isArray(body.notes)
      ? (body.notes as Record<string, unknown>[]).map((n) => ({ item_code: str(n.item_code), reason_code: str(n.reason_code), short_qty: num(n.short_qty) })).filter((n) => n.item_code && n.reason_code)
      : [];
    const res = await moveFromTransit(client, { refDoc: doc, whTo, locTo, user: session.employee_code ?? null, stage: "receive", lines, notes });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

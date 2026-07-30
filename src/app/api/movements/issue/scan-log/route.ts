import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { appendScanLog, type ScanLogEvent } from "@/lib/pickScanLog";

/**
 * Audit trail of the goods-issue confirm step (ຢືນຢັນຈ່າຍ).
 *
 * POST — append what the operator just did on the confirm screen (scans incl.
 *        rejects, un-scans, location re-points). The client batches these, so a
 *        failure here must never surface: it is telemetry, not the transaction.
 *        Body: { doc_no, ref_doc?, wh?, events:[ScanLogEvent] }
 *
 * GET  — read the trail back. ?doc=<OUT…> for a pick slip still in progress, or
 *        ?issue=<DP…> for one that has already been confirmed (the pick slip
 *        rows are gone by then, but the log keeps the issue doc stamped on it).
 */
const MAX_ROWS = 500;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: { doc_no?: unknown; ref_doc?: unknown; wh?: unknown; events?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ ok: true, written: 0 }); }

  const docNo = typeof body.doc_no === "string" ? body.doc_no.trim() : "";
  const wh = typeof body.wh === "string" ? body.wh.trim() : "";
  if (!docNo || !Array.isArray(body.events)) return NextResponse.json({ ok: true, written: 0 });

  const accessible = accessibleWarehouses(session);
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const written = await appendScanLog({
    docNo,
    refDoc: typeof body.ref_doc === "string" ? body.ref_doc : null,
    wh: wh || null,
    // The logged actor is the session, never a client-supplied name.
    user: session.employee_code ?? null,
    events: body.events as ScanLogEvent[],
  });
  return NextResponse.json({ ok: true, written });
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const url = new URL(request.url);
  const doc = (url.searchParams.get("doc") ?? "").trim();
  const issue = (url.searchParams.get("issue") ?? "").trim();
  if (!doc && !issue) return NextResponse.json({ events: [] });

  const args: unknown[] = [doc || issue];
  const filters = [doc ? "l.doc_no = $1" : "l.issue_doc = $1"];
  // Warehouse scoping: rows written before wh_code was known stay visible to
  // anyone who can already see the doc they belong to.
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible)) {
    if (accessible.length === 0) return NextResponse.json({ events: [] });
    args.push(accessible);
    filters.push(`(l.wh_code IS NULL OR l.wh_code = '' OR l.wh_code = ANY($${args.length}))`);
  }

  try {
    const events = await query(
      `SELECT l.roworder, l.doc_no, l.ref_doc, l.issue_doc, l.wh_code, l.event, l.result,
              l.item_code, l.scan_input, l.sn, l.isn, l.rack, l.location, l.pallet,
              l.from_node, l.to_node, l.qty::text AS qty, l.note, l.user_created,
              to_char(l.created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
       FROM public.odg_wms_pick_scan_log l
       WHERE ${filters.join(" AND ")}
       ORDER BY l.roworder
       LIMIT ${MAX_ROWS}`,
      args,
    );
    return NextResponse.json({ events });
  } catch {
    // pre-migration: the table does not exist yet — behave as "no history".
    return NextResponse.json({ events: [], unavailable: true });
  }
}

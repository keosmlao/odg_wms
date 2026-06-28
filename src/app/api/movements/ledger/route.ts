import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Unified movement ledger / audit trail over odg_wms_trans_detail.
 *
 * One row per document (doc_no + warehouse), aggregating its lines into a net
 * in/out summary, the operator and time. Operation is derived from the doc_no
 * prefix (ADJ/DP/PMV/SNMV — WMS-created) or, for numeric ERP-synced docs, from
 * the net quantity sign. No header join, so it is independent of the differing
 * header trans_flag enumeration.
 *
 * GET (list): ?wh=&from=&to=&type=&q=&page=
 * GET (lines): ?doc=<doc_no>&wh=<code>  → the individual lines of one document.
 */
const PAGE = 40;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const accessible = accessibleWarehouses(session);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // ---- lines mode: one document's detail rows -------------------------------
  const doc = url.searchParams.get("doc")?.trim() ?? "";
  if (doc) {
    const dwh = url.searchParams.get("wh")?.trim() ?? "";
    const lines = await query<{
      item_code: string; item_name: string | null; qty: string; unit_code: string | null;
      calc_flag: number; rack: string | null; location: string | null; pallet: string | null;
    }>(
      `SELECT item_code, item_name,
              qty::numeric::text AS qty, unit_code, calc_flag,
              NULLIF(TRIM(shelf_code), '')  AS rack,
              NULLIF(TRIM(shelf_code1), '') AS location,
              NULLIF(TRIM(pallet), '')      AS pallet
       FROM public.odg_wms_trans_detail
       WHERE doc_no = $1 ${dwh ? "AND wh_code = $2" : ""}
       ORDER BY roworder`,
      dwh ? [doc, dwh] : [doc],
    );
    return NextResponse.json({ doc, lines });
  }

  // ---- list mode ------------------------------------------------------------
  const today = new Date().toISOString().slice(0, 10);
  const dFrom = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const from = url.searchParams.get("from")?.trim() || dFrom;
  const to = url.searchParams.get("to")?.trim() || today;
  const type = url.searchParams.get("type")?.trim() ?? ""; // in|out|move|adj|pallet|sn
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);

  const params: unknown[] = [from, to];
  let whereWh = "";
  if (wh) { params.push(wh); whereWh = `AND wh_code = $${params.length}`; }
  else if (Array.isArray(accessible)) {
    if (accessible.length === 0) return NextResponse.json({ rows: [], page, has_more: false });
    params.push(accessible); whereWh = `AND wh_code = ANY($${params.length})`;
  }

  // Optional free-text: restrict to documents that contain a matching line.
  let whereDoc = "";
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    const p = `$${params.length}`;
    whereDoc = `AND doc_no IN (
      SELECT doc_no FROM public.odg_wms_trans_detail
      WHERE doc_date BETWEEN $1 AND $2 ${whereWh}
        AND (doc_no ILIKE ${p} ESCAPE '\\' OR item_code ILIKE ${p} ESCAPE '\\' OR item_name ILIKE ${p} ESCAPE '\\')
    )`;
  }

  // type → HAVING (net sign) or doc_no prefix.
  const hav  = type === "in" ? "HAVING SUM(qty * calc_flag) > 0.0001"
            : type === "out" ? "HAVING SUM(qty * calc_flag) < -0.0001"
            : type === "move" ? "HAVING abs(SUM(qty * calc_flag)) <= 0.0001"
            : "";
  const prefix = type === "adj" ? "AND doc_no ILIKE 'ADJ%'"
              : type === "pallet" ? "AND (doc_no ILIKE 'PMV%' OR doc_no ILIKE 'DP%')"
              : type === "sn" ? "AND doc_no ILIKE 'SNMV%'"
              : "";

  const selectCore =
    `SELECT doc_no, wh_code,
            to_char(MAX(doc_date), 'YYYY-MM-DD') AS doc_date,
            MAX(doc_time) AS doc_time,
            MAX(user_created) AS user_created,
            MAX(NULLIF(TRIM(doc_ref), '')) AS doc_ref,
            count(*)::int AS lines,
            COALESCE(SUM(qty) FILTER (WHERE calc_flag > 0), 0)::numeric::text AS qty_in,
            COALESCE(SUM(qty) FILTER (WHERE calc_flag < 0), 0)::numeric::text AS qty_out,
            SUM(qty * calc_flag)::numeric::text AS net
     FROM public.odg_wms_trans_detail
     WHERE doc_date BETWEEN $1 AND $2 ${whereWh} ${prefix} ${whereDoc}
     GROUP BY doc_no, wh_code
     ${hav}
     ORDER BY MAX(doc_date) DESC, MAX(doc_time) DESC NULLS LAST, doc_no DESC`;

  type LedgerRow = {
    doc_no: string; wh_code: string; doc_date: string; doc_time: string | null;
    user_created: string | null; doc_ref: string | null; lines: number;
    qty_in: string | null; qty_out: string | null; net: string;
  };

  // CSV export: all matching documents (capped), no pagination.
  if (url.searchParams.get("format") === "csv") {
    const csvRows = await query<LedgerRow>(`${selectCore} LIMIT 10000`, params);
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["doc_date", "doc_time", "doc_no", "doc_ref", "wh_code", "qty_in", "qty_out", "net", "lines", "user"];
    const body = csvRows.map((r) =>
      [r.doc_date, r.doc_time ?? "", r.doc_no, r.doc_ref ?? "", r.wh_code, r.qty_in ?? "0", r.qty_out ?? "0", r.net, r.lines, r.user_created ?? ""].map(esc).join(","),
    );
    const csv = "﻿" + [header.join(","), ...body].join("\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ledger_${from}_${to}.csv"`,
      },
    });
  }

  params.push(PAGE + 1, page * PAGE);
  const rows = await query<LedgerRow>(`${selectCore} LIMIT $${params.length - 1} OFFSET $${params.length}`, params);

  const hasMore = rows.length > PAGE;
  return NextResponse.json({ rows: rows.slice(0, PAGE), page, has_more: hasMore, from, to });
}

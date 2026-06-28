import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { type IssueLine, executeIssue } from "@/lib/issueCore";

/**
 * Direct goods-issue (single-screen flow): pick + scan SN + issue in one shot.
 * Builds IssueLine[] from the request and finalizes via executeIssue (WMS −1 +
 * serial ledger + ERP 56 / 70+72). No pending draft. Each line carries its
 * rack/location/pallet node + the scanned serials.
 *
 * POST { wh, source_type: 'req'|'transfer'|'sale', ref_doc, lines:[{ item_code,
 *        item_name, unit_code, qty, rack, location, pallet, serials[] }] }
 */
const VALID_SRC = new Set(["req", "transfer", "sale"]);

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }

  const wh = str(body.wh);
  const sourceType = str(body.source_type);
  const refDoc = str(body.ref_doc) || null;
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!VALID_SRC.has(sourceType)) return NextResponse.json({ error: "ປະເພດເອກະສານບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າเຖິງສາງນີ້" }, { status: 403 });

  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });
  const lines: IssueLine[] = [];
  for (const raw of body.lines as Record<string, unknown>[]) {
    const item_code = str(raw.item_code);
    const qty = num(raw.qty);
    if (!item_code || qty === null || qty <= 0) continue;
    const serials = Array.isArray(raw.serials) ? (raw.serials as unknown[]).map(str).filter(Boolean) : [];
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code) || "",
      qty,
      serials,
      rack: str(raw.rack),
      location: str(raw.location),
      pallet: str(raw.pallet),
    });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await executeIssue(client, {
      wh,
      docRef: refDoc,
      sourceType,
      location: null,
      user: session.employee_code ?? null,
      lines,
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: res.issueCode, erp: res.erpDoc, serials: res.serials });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

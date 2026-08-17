import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * POST — record one batch of hand-posted stock-card movements as a single doc
 * (STC<YYMMDD>-<seq5>), so a mistake can be traced and reversed as a unit.
 *
 * Body: { wh, remark?, lines: [{ item_code, item_name, unit_code, calc_flag,
 *         qty, rack_code?, location_code?, remark? }] }
 *
 * NO over-issue check is performed, and that is deliberate: the opening balance
 * only exists at warehouse level while entries are posted per bin, so "does this
 * bin hold enough" has no answer the ledger could trust. The card is allowed to
 * go negative and the report shows it in red — a wrong number the operator can
 * SEE is safer than a blocked entry that quietly hides the discrepancy.
 */
type LineIn = {
  item_code?: unknown; item_name?: unknown; unit_code?: unknown;
  calc_flag?: unknown; qty?: unknown; rack_code?: unknown; location_code?: unknown; remark?: unknown;
};

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: { wh?: unknown; remark?: unknown; lines?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }

  const wh = str(body.wh);
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ບັນທຶກ" }, { status: 400 });
  }

  const lines: { item_code: string; item_name: string | null; unit_code: string | null; calc_flag: number; qty: number; rack_code: string | null; location_code: string | null; remark: string | null }[] = [];
  for (const raw of body.lines as LineIn[]) {
    const item_code = str(raw.item_code);
    if (!item_code) return NextResponse.json({ error: "ມີລາຍການທີ່ບໍ່ມີລະຫັດສິນຄ້າ" }, { status: 400 });
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) return NextResponse.json({ error: `ຈຳນວນຂອງ ${item_code} ຕ້ອງຫຼາຍກວ່າ 0` }, { status: 400 });
    const calc_flag = num(raw.calc_flag);
    if (calc_flag !== 1 && calc_flag !== -1) return NextResponse.json({ error: `ປະເພດຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ (ຕ້ອງເປັນ ຂາເຂົ້າ ຫຼື ຂາອອກ)` }, { status: 400 });
    // A location without its rack would be unreachable in the rack → location
    // drill-down, so reject the half-specified case rather than store an orphan.
    const rack_code = str(raw.rack_code) || null;
    const location_code = str(raw.location_code) || null;
    if (location_code && !rack_code) return NextResponse.json({ error: `${item_code}: ລະບຸ location ແລ້ວຕ້ອງລະບຸ rack ນຳ` }, { status: 400 });
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code) || null,
      calc_flag,
      qty,
      rack_code,
      location_code,
      remark: str(raw.remark) || null,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Bins must belong to THIS warehouse — a rack code pasted from another
    // warehouse would silently create a bin that the drill-down never shows.
    const rackCodes = [...new Set(lines.map((l) => l.rack_code).filter((v): v is string => !!v))];
    if (rackCodes.length > 0) {
      const ok = await client.query<{ code: string }>(
        `SELECT code FROM public.odg_wms_location WHERE wh_code = $1 AND code = ANY($2)`,
        [wh, rackCodes],
      );
      const found = new Set(ok.rows.map((r) => r.code));
      const bad = rackCodes.filter((c) => !found.has(c));
      if (bad.length > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `rack ບໍ່ຢູ່ໃນສາງນີ້: ${bad.join(", ")}` }, { status: 400 });
      }
    }
    const locCodes = [...new Set(lines.map((l) => l.location_code).filter((v): v is string => !!v))];
    if (locCodes.length > 0) {
      const ok = await client.query<{ code: string; location_id: string | null }>(
        `SELECT code, location_id FROM public.odg_wms_location1 WHERE wh_code = $1 AND code = ANY($2)`,
        [wh, locCodes],
      );
      const byCode = new Map(ok.rows.map((r) => [r.code, r.location_id]));
      for (const l of lines) {
        if (!l.location_code) continue;
        if (!byCode.has(l.location_code)) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: `location ບໍ່ຢູ່ໃນສາງນີ້: ${l.location_code}` }, { status: 400 });
        }
        if (byCode.get(l.location_code) !== l.rack_code) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: `location ${l.location_code} ບໍ່ໄດ້ຢູ່ໃນ rack ${l.rack_code}` }, { status: 400 });
        }
      }
    }

    const docNo = (
      await client.query<{ doc_no: string }>(
        `SELECT 'STC' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
                lpad(nextval('public.odg_wms_stock_card_doc_seq')::text, 5, '0') AS doc_no`,
      )
    ).rows[0].doc_no;

    await client.query(
      `INSERT INTO public.odg_wms_stock_card_doc (doc_no, wh_code, doc_date, doc_time, remark, line_count, user_created)
       VALUES ($1, $2, CURRENT_DATE, to_char(now(), 'HH24:MI'), $3, $4, $5)`,
      [docNo, wh, str(body.remark) || null, lines.length, session.employee_code],
    );

    for (const l of lines) {
      await client.query(
        `INSERT INTO public.odg_wms_stock_card_entry
           (doc_no, wh_code, rack_code, location_code, item_code, item_name, unit_code, calc_flag, qty, remark, user_created)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [docNo, wh, l.rack_code, l.location_code, l.item_code, l.item_name, l.unit_code, l.calc_flag, l.qty, l.remark, session.employee_code],
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

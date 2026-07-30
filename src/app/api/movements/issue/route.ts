import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";

/**
 * Stage 1 of the goods issue (ຈ່າຍສິນຄ້າອອກສາງ): create a PENDING draft in
 * `wms_product_out` (+ _detail + _serial_detail) — the picked plan with its
 * allocated serials. Stock is NOT deducted and serials are NOT flipped here;
 * that happens at scan-confirm (stage 2, /api/movements/issue/draft/[doc]/confirm
 * → executeIssue). doc_no = OUT<YYMMDD>-<seq5>.
 */
const SRC_FLAG: Record<string, number> = { req: 122, transfer: 124, sale: 44 };

type LineInput = {
  item_code?: unknown;
  item_name?: unknown;
  unit_code?: unknown;
  qty?: unknown;
  serials?: unknown;
  rack?: unknown;
  location?: unknown;
  pallet?: unknown;
};
type Body = {
  wh_code?: unknown;
  rack?: unknown;
  location?: unknown;
  pallet?: unknown;
  doc_ref?: unknown;
  source_type?: unknown; // req (122) | transfer (124) | sale (44)
  customer_code?: unknown;
  remark?: unknown;
  lines?: unknown;
};

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

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  const rack = str(body.rack);
  const location = str(body.location);
  const pallet = str(body.pallet);
  const docRef = str(body.doc_ref);
  const sourceType = str(body.source_type); // req | transfer | sale
  const customer = str(body.customer_code);
  const remark = str(body.remark);

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });
  }

  const seen = new Set<string>();
  const lines: { item_code: string; item_name: string | null; unit_code: string; qty: number; serials: string[]; rack: string; location: string; pallet: string }[] = [];
  for (const raw of body.lines as LineInput[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    const lineRack = raw.rack !== undefined ? str(raw.rack) : rack;
    const lineLocation = raw.location !== undefined ? str(raw.location) : location;
    const linePallet = raw.pallet !== undefined ? str(raw.pallet) : pallet;
    const key = `${item_code}@${lineRack}/${lineLocation}/${linePallet}`;
    if (seen.has(key)) {
      return NextResponse.json({ error: `ສິນຄ້າ ${item_code} ຊ້ຳກັນຢູ່ບ່ອນຈັດເກັບດຽວກັນ` }, { status: 400 });
    }
    seen.add(key);
    const serials = Array.isArray(raw.serials)
      ? Array.from(new Set((raw.serials as unknown[]).map((s) => str(s)).filter(Boolean)))
      : [];
    const qty = serials.length > 0 ? serials.length : num(raw.qty);
    if (qty === null || qty <= 0) {
      return NextResponse.json({ error: `ຈຳນວນຈ່າຍຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    }
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code), qty, serials, rack: lineRack, location: lineLocation, pallet: linePallet });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Per-warehouse policy:
    //  · sn_issue off      → issue by qty only; drop serials entirely.
    //  · sn_issue on but
    //    sn_issue_pick off → pick slip picks location + qty; serials are OPTIONAL
    //                        here and get scanned at confirm instead.
    //  · both on (default) → the pick slip must pre-select every serial.
    const snOn = await warehouseSnEnabled(wh, "issue", client);
    const pickRequiresSn = snOn && (await warehouseSnEnabled(wh, "issue_pick", client));
    if (!snOn) for (const l of lines) l.serials = [];

    // Pre-validate (same rules as finalize) so an invalid plan can't be saved:
    // serialized items need serials, qty ≤ node balance, serials in stock here.
    const snRes = await client.query<{ item_code: string }>(
      `SELECT DISTINCT item_code FROM public.sn_inventory WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)`,
      [wh, lines.map((l) => l.item_code)],
    );
    const hasSerials = new Set(snRes.rows.map((r) => r.item_code));
    for (const line of lines) {
      if (pickRequiresSn && hasSerials.has(line.item_code) && line.serials.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${line.item_code} ມີ serial — ຕ້ອງເລືອກ/ຍິງ serial ກ່ອນສ້າງໃບ pick` }, { status: 400 });
      }
      // NOTE: no `status` filter — status=1 marks the outbound (−1) leg of an
      // internal bin relocation (trans_flag 77), not a void. Filtering it out
      // would leave a moved-out bin showing its old balance and let a pick be
      // saved against stock that is no longer there. Same rule as the balance page.
      const balRes = await client.query<{ before: string }>(
        `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS before
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1
           AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  = $2
           AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
           AND COALESCE(NULLIF(TRIM(t.pallet), ''), '')      = $4
           AND t.item_code = $5`,
        [wh, line.rack, line.location, line.pallet, line.item_code],
      );
      const before = Number.parseFloat(balRes.rows[0]?.before ?? "0") || 0;
      if (line.qty > before + 1e-6) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${line.item_code}: ຈ່າຍ ${line.qty} ເກີນຄົງເຫຼືອ ${before}` }, { status: 400 });
      }
    }

    // Create the pending draft.
    const outDoc = (
      await client.query<{ doc_no: string }>(
        `SELECT 'OUT' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('public.wms_product_out_roworder_seq')::text, 5, '0') AS doc_no`,
      )
    ).rows[0].doc_no;
    await client.query(
      `INSERT INTO public.wms_product_out
         (doc_no, doc_date, doc_time, status, warehouse_code, branch_code, customer_code, ref_doc_no, doc_type, creator_code, remark, create_date_time_now)
       VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), 0, $2, '00', $3, $4, $5, $6, $7, now())`,
      [outDoc, wh, customer || null, docRef || null, SRC_FLAG[sourceType] ?? 0, session.employee_code, remark || null],
    );
    for (const line of lines) {
      // shelf_code packs the full node `rack|location|pallet` (the draft table
      // only has shelf_code + box_code); box_code keeps the readable location.
      const node = `${line.rack}|${line.location}|${line.pallet}`;
      await client.query(
        `INSERT INTO public.wms_product_out_detail
           (doc_no, doc_date, item_code, item_name, unit_code, qty, shelf_code, box_code, create_date_time_now)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, now())`,
        [outDoc, line.item_code, line.item_name, line.unit_code || null, line.qty, node, line.location || null],
      );
      for (const sn of line.serials) {
        await client.query(
          `INSERT INTO public.wms_product_out_serial_detail (ref_out_doc, ref_out_date, item_code, serial_number, create_date_time_now)
           VALUES ($1, CURRENT_DATE, $2, $3, now())`,
          [outDoc, line.item_code, sn],
        );
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      pending_code: outDoc,
      lines: lines.length,
      serials: lines.reduce((s, l) => s + l.serials.length, 0),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

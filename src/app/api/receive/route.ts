import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/** WMS goods-receipt against a PO. Writes WMS tables only (path A — no ERP post). */
const RECEIVE_TRANS_FLAG = 1; // receive (calc_flag +1)
/**
 * ISN year-code: A = 2025, B = 2026, C = 2027, … (one letter per year).
 * Serialized items (ic_inventory.is_isn = 1) get an ISN-generation request
 * queued into import_gen_isn(_detail); the ERP's own gen process allocates the
 * actual ISN numbers (we never invent them).
 */
function isnYearCode(year: number): string {
  const idx = year - 2025;
  return idx >= 0 && idx < 26 ? String.fromCharCode(65 + idx) : "A";
}

type LineInput = {
  item_code?: unknown;
  item_name?: unknown;
  unit_code?: unknown;
  qty?: unknown;
  rack?: unknown;
  location?: unknown;
  pallet?: unknown;
};
type Body = {
  wh_code?: unknown;
  po_no?: unknown;
  doc_type?: unknown; // po | transfer | sales_return | issue_return
  supplier_code?: unknown;
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
  const poNo = str(body.po_no);
  const docType = str(body.doc_type) || "po"; // serials are generated for PO only
  const supplier = str(body.supplier_code);
  const remark = str(body.remark);
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!poNo) return NextResponse.json({ error: "ບໍ່ມີເລກເອກະສານ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຮັບ" }, { status: 400 });
  }

  const lines: {
    item_code: string;
    item_name: string | null;
    unit_code: string;
    qty: number;
    rack: string;
    location: string;
    pallet: string;
  }[] = [];
  for (const raw of body.lines as LineInput[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) {
      return NextResponse.json({ error: `ຈຳນວນຮັບຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    }
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code),
      qty,
      rack: str(raw.rack),
      location: str(raw.location),
      pallet: str(raw.pallet),
    });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຮັບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate qty ≤ remaining. odg_po_remain only covers POs; transfer/return
    // docs aren't there, so the client already capped qty to the source remaining
    // (from /api/receive/pending) — skip the PO-only DB check for those.
    if (docType === "po") {
      for (const line of lines) {
        const r = await client.query<{ remaining: string }>(
          `SELECT (COALESCE(MAX(p.qty_balance), 0) - COALESCE((
              SELECT SUM(d.qty)
              FROM public.wms_product_receive h
              JOIN public.wms_product_receive_detail d ON d.doc_no = h.doc_no
              WHERE h.ref_doc_no = $1 AND d.item_code = $2 AND (h.status = 0 OR h.status IS NULL)
            ), 0))::numeric::text AS remaining
           FROM public.odg_po_remain p
           WHERE p.doc_no = $1 AND p.item_code = $2`,
          [poNo, line.item_code],
        );
        const remaining = Number.parseFloat(r.rows[0]?.remaining ?? "0") || 0;
        if (line.qty > remaining + 1e-6) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: `ສິນຄ້າ ${line.item_code}: ຮັບ ${line.qty} ເກີນຄ້າງ ${remaining}` },
            { status: 400 },
          );
        }
      }
    }

    // Generate receive doc_no: RC<YYMMDD>-<seq5>
    const codeRes = await client.query<{ doc_no: string }>(
      `SELECT 'RC' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
              lpad(nextval('public.wms_product_receive_roworder_seq')::text, 5, '0') AS doc_no`,
    );
    const docNo = codeRes.rows[0].doc_no;

    // WMS movement header (odg_wms_trans) — one per receive; pairs with the
    // odg_wms_trans_detail rows below.
    await client.query(
      `INSERT INTO public.odg_wms_trans
         (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
      [RECEIVE_TRANS_FLAG, docNo, poNo, wh, session.employee_code],
    );

    for (const line of lines) {
      // 1) WMS location stock (+1) → balance updates
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name,
            qty, unit_code, shelf_code, shelf_code1, wh_code, user_created,
            status, calc_flag, doc_time, pallet)
         VALUES
           ($1, CURRENT_DATE, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            0, 1, to_char(now(), 'HH24:MI'), $12)`,
        [
          RECEIVE_TRANS_FLAG,
          docNo,
          poNo,
          line.item_code,
          line.item_name,
          line.qty,
          line.unit_code || null,
          line.rack || null,
          line.location || null,
          wh,
          session.employee_code,
          line.pallet || null,
        ],
      );

      // 2) WMS receive detail line
      await client.query(
        `INSERT INTO public.wms_product_receive_detail
           (doc_no, doc_date, doc_time, item_code, item_name, unit_code, qty,
            box_code, shelf_code, create_date_time_now)
         VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, $6, $7, now())`,
        [docNo, line.item_code, line.item_name, line.unit_code || null, line.qty, line.pallet || null, line.location || line.rack || null],
      );
    }

    // 3) WMS receive header + PO ref
    await client.query(
      `INSERT INTO public.wms_product_receive
         (doc_no, doc_date, doc_time, status, warehouse_code, supplier_code,
          remark, creator_code, ref_doc_no, create_datetime, create_date_time_now)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), 0, $2, $3, $4, $5, $6, now(), now())`,
      [docNo, wh, supplier || null, remark || null, session.employee_code, poNo],
    );
    await client.query(
      `INSERT INTO public.wms_product_receive_ref (doc_no, ref_doc_no, line_order, create_date_time_now)
       VALUES ($1, $2, 1, now())`,
      [docNo, poNo],
    );

    // 4) ISN generation (Path B): for PURCHASE ORDERS only, WMS allocates real
    // ISN for serialized items (is_isn = 1) and records them in the serial ledger
    // sn_trans / sn_trans_detail / sn_inventory (the same place the ERP's
    // goods-receipt-with-serial writes, trans_flag = 81). ISN =
    // <item_category(3)><year(1)><7-digit running number>; the number continues
    // the global per-(category, year) sequence so it never reuses one.
    //
    // Transfer / sales-return / issue-return items already have serials in the
    // system, so we do NOT generate here ("ໃຊ້ຕົວທີ່ມີຢູ່"); missing serials are
    // surfaced to the operator without blocking the receipt.
    const itemCodes = lines.map((l) => l.item_code);
    const isnRes = await client.query<{ code: string; item_category: string | null }>(
      `SELECT code, item_category FROM public.ic_inventory WHERE code = ANY($1) AND is_isn = 1`,
      [itemCodes],
    );
    const catByCode = new Map(isnRes.rows.map((r) => [r.code, (r.item_category ?? "").trim()]));
    const isnLines = lines.filter((l) => (catByCode.get(l.item_code) ?? "") !== "" && Math.round(l.qty) > 0);
    const serialItemsNoGen = docType !== "po" ? isnLines.length : 0;
    const yearCode = isnYearCode(new Date().getFullYear());
    let genItems = 0;
    let genQty = 0;
    if (docType === "po" && isnLines.length > 0) {
      const totalUnits = isnLines.reduce((s, l) => s + Math.round(l.qty), 0);
      // Serial-ledger header (one per receive; trans_flag 81 = goods receipt).
      await client.query(
        `INSERT INTO public.sn_trans
           (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_def, doc_format_code, wh_code)
         VALUES (81, $1, CURRENT_DATE, $2, 0, $3, $4, 'RC', $5)`,
        [docNo, session.employee_code, totalUnits, poNo, wh],
      );
      for (const l of isnLines) {
        const qty = Math.round(l.qty);
        const prefix = `${catByCode.get(l.item_code)}${yearCode}`;
        const mx = await client.query<{ maxseq: string }>(
          `SELECT GREATEST(
             COALESCE((SELECT MAX(CASE WHEN substring(sn  from 5) ~ '^[0-9]+$' THEN substring(sn  from 5)::bigint ELSE 0 END) FROM public.sn_trans_detail WHERE sn  LIKE $1), 0),
             COALESCE((SELECT MAX(CASE WHEN substring(isn from 5) ~ '^[0-9]+$' THEN substring(isn from 5)::bigint ELSE 0 END) FROM public.odg_mapping_isn  WHERE isn LIKE $1), 0),
             COALESCE((SELECT MAX(CASE WHEN substring(isn from 5) ~ '^[0-9]+$' THEN substring(isn from 5)::bigint ELSE 0 END) FROM public.sn_inventory     WHERE isn LIKE $1), 0)
           )::text AS maxseq`,
          [`${prefix}%`],
        );
        await client.query(
          `INSERT INTO public.sn_trans_detail
             (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, unit_cost,
              warehouse, item_name, doc_ref, calc_flag, rack, location, pallet)
           SELECT 81, $1, CURRENT_DATE, $2, $3, $4 || lpad(($5::bigint + g)::text, 7, '0'), 1, $6,
                  $7, $8, $9, 1, $10, $11, $12
           FROM generate_series(1, $13) g`,
          [docNo, session.employee_code, l.item_code, prefix, mx.rows[0].maxseq, l.unit_code || null,
           wh, l.item_name, poNo, l.rack || null, l.location || null, l.pallet || null, qty],
        );
        // Serial stock (sn_inventory) — same ISN, so it shows in /serials (odg_sn_balance).
        await client.query(
          `INSERT INTO public.sn_inventory
             (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
           SELECT v.s, v.s, 1, 0, $1, $2, $3, $4, $5, $6, $7, $8
           FROM (SELECT $9 || lpad(($10::bigint + g)::text, 7, '0') AS s FROM generate_series(1, $11) g) v`,
          [l.item_code, l.item_name, l.unit_code || null, wh, l.rack || null, l.location || null, l.pallet || null, session.employee_code, prefix, mx.rows[0].maxseq, qty],
        );
        genItems += 1;
        genQty += qty;
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      receive_code: docNo,
      doc_type: docType,
      received: lines.length,
      gen_isn: genQty > 0 ? { items: genItems, qty: genQty } : null,
      // Serialized items received via transfer/return — serials were NOT generated
      // (they should already exist); operator should verify by scanning.
      serial_existing_items: serialItemsNoGen,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

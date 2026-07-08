import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { genDocNo, writeCountSerials, DOC_TYPE, RECEIVE_STATUS } from "@/lib/receive";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";

/**
 * Count sheets (ໃບກວດນັບ) — a draft goods-receipt built from a packing list,
 * stored on wms_product_receive with doc_type='count', status=9 (no stock yet).
 * Serials (ISN) are generated + reserved here at save time in
 * wms_product_receive_serial_detail; they commit to the ledger at WMS-receipt.
 *
 *   GET                 → list open count sheets (status=9), scoped
 *   POST {po_no,pack_no,wh_code,lines[...]} → create one
 */
type SerialIn = { serial_number?: unknown };
type LineIn = { item_code?: unknown; item_name?: unknown; unit_code?: unknown; qty?: unknown; serials?: unknown };
type Body = { po_no?: unknown; pack_no?: unknown; wh_code?: unknown; supplier_code?: unknown; remark?: unknown; lines?: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ sheets: [] });
  const scoped = Array.isArray(accessible);

  const sheets = await query(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no, h.remark, h.creator_code, e.fullname_lo AS creator_name,
            r.ref_doc_no AS pack_no,
            COALESCE(agg.line_count,0) AS line_count, COALESCE(agg.total_qty,0)::text AS total_qty,
            COALESCE(sn.sn_count,0) AS sn_count
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     LEFT JOIN public.wms_product_receive_ref r ON r.doc_no = h.doc_no AND r.line_order = 1
     LEFT JOIN (SELECT doc_no, count(*)::int AS line_count, SUM(qty) AS total_qty
                FROM public.wms_product_receive_detail GROUP BY doc_no) agg ON agg.doc_no = h.doc_no
     LEFT JOIN (SELECT ref_rec_doc, count(*)::int AS sn_count
                FROM public.wms_product_receive_serial_detail WHERE COALESCE(ignore_sync,0) <> 2 GROUP BY ref_rec_doc) sn ON sn.ref_rec_doc = h.doc_no
     WHERE h.doc_type = $1 AND h.status = $2
       ${scoped ? "AND h.warehouse_code = ANY($3)" : ""}
     ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC`,
    scoped ? [DOC_TYPE.count, RECEIVE_STATUS.draft, accessible] : [DOC_TYPE.count, RECEIVE_STATUS.draft],
  );
  return NextResponse.json({ sheets });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const po = str(body.po_no);
  const pack = str(body.pack_no);
  const wh = str(body.wh_code);
  const supplier = str(body.supplier_code);
  const remark = str(body.remark);
  if (!po) return NextResponse.json({ error: "ບໍ່ມີເລກ PO" }, { status: 400 });
  if (!wh) return NextResponse.json({ error: "ບໍ່ມີສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການກວດນັບ" }, { status: 400 });
  }

  // Block duplicate: a PO must not have more than one OPEN count sheet per warehouse.
  const dup = await query<{ doc_no: string }>(
    `SELECT doc_no FROM public.wms_product_receive
     WHERE doc_type = $1 AND status = $2 AND ref_doc_no = $3 AND warehouse_code = $4
     ORDER BY doc_no DESC LIMIT 1`,
    [DOC_TYPE.count, RECEIVE_STATUS.draft, po, wh],
  );
  if (dup[0]) {
    return NextResponse.json(
      { error: `ໃບສັ່ງຊື້ ${po} ມີໃບກວດນັບຄ້າງຢູ່ແລ້ວ: ${dup[0].doc_no}`, existing_count_no: dup[0].doc_no },
      { status: 409 },
    );
  }

  type CleanLine = { item_code: string; item_name: string | null; unit_code: string; qty: number; serials: { serial_number: string }[] };
  const lines: CleanLine[] = [];
  for (const raw of body.lines as LineIn[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) {
      return NextResponse.json({ error: `ຈຳນວນກວດນັບຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    }
    const serials: CleanLine["serials"] = [];
    if (Array.isArray(raw.serials)) {
      for (const s of raw.serials as SerialIn[]) {
        const sn = str(s.serial_number);
        if (sn) serials.push({ serial_number: sn }); // only manual (non-empty) ones
      }
    }
    if (serials.length > qty + 1e-6) {
      return NextResponse.json({ error: `${item_code}: ໃສ່ SN (${serials.length}) ເກີນຈຳນວນ (${qty})` }, { status: 400 });
    }
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code), qty, serials });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການກວດນັບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const docNo = await genDocNo(client, "CK");

    await client.query(
      `INSERT INTO public.wms_product_receive
         (doc_no, doc_date, doc_time, status, doc_type, warehouse_code, supplier_code,
          remark, creator_code, ref_doc_no, create_datetime, create_date_time_now)
       VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, $6, $7, $8, now(), now())`,
      [docNo, RECEIVE_STATUS.draft, DOC_TYPE.count, wh, supplier || null, remark || null, session.employee_code, po],
    );
    if (pack) {
      await client.query(
        `INSERT INTO public.wms_product_receive_ref (doc_no, ref_doc_no, line_order, create_date_time_now)
         VALUES ($1, $2, 1, now())`,
        [docNo, pack],
      );
    }

    for (const line of lines) {
      await client.query(
        `INSERT INTO public.wms_product_receive_detail
           (doc_no, doc_date, doc_time, item_code, item_name, unit_code, qty, create_date_time_now)
         VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, now())`,
        [docNo, line.item_code, line.item_name, line.unit_code || null, line.qty],
      );
    }
    // Generate + reserve ISN now (at count-sheet save). Reuses any held SN from
    // earlier incomplete receipts of this PO before generating new numbers.
    // Skipped when this warehouse's RECEIVE menu has SN off.
    const snReceiveOn = await warehouseSnEnabled(wh, "receive", client);
    const sn = snReceiveOn
      ? await writeCountSerials(client, docNo, lines.map((l) => ({ item_code: l.item_code, qty: l.qty, serials: l.serials })), po)
      : { generated: 0, manual: 0, reused: 0, serializedNoCategory: 0 };

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, count_code: docNo, lines: lines.length, gen_isn: sn.generated, reused_sn: sn.reused, manual_sn: sn.manual });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

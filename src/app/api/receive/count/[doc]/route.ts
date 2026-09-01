import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { DOC_TYPE, RECEIVE_STATUS, writeCountSerials } from "@/lib/receive";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";
import { needsIsnSql } from "@/lib/isnScope";

/**
 * A single count sheet (ໃບກວດນັບ, draft on wms_product_receive status=9).
 *   GET    → header + lines + reserved serials
 *   PUT    → replace counted lines + serials (re-reserve ISN, while draft)
 *   DELETE → discard the draft (+ its reserved serials)
 */
type SerialIn = { serial_number?: unknown };
type LineIn = { item_code?: unknown; item_name?: unknown; unit_code?: unknown; qty?: unknown; serials?: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

async function loadHeader(docNo: string) {
  const rows = await query<{ doc_no: string; wh_code: string | null; status: number | null; doc_type: number | null; po_no: string | null }>(
    `SELECT doc_no, warehouse_code AS wh_code, status, doc_type, ref_doc_no AS po_no FROM public.wms_product_receive WHERE doc_no = $1 LIMIT 1`,
    [docNo],
  );
  return rows[0] ?? null;
}

/** The sheet's PO list (falls back to the header's single ref_doc_no). */
async function loadPos(docNo: string, fallbackPo?: string | null): Promise<string[]> {
  const rows = await query<{ po_no: string }>(
    `SELECT po_no FROM public.wms_product_receive_po WHERE doc_no = $1 ORDER BY line_order, roworder`,
    [docNo],
  );
  const list = rows.map((r) => r.po_no).filter(Boolean);
  if (list.length > 0) return list;
  return fallbackPo ? [fallbackPo] : [];
}

export async function GET(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();

  const header = (await query(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time, h.status,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no, r.ref_doc_no AS pack_no, h.remark
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.wms_product_receive_ref r ON r.doc_no = h.doc_no AND r.line_order = 1
     WHERE h.doc_no = $1 AND h.doc_type = $2`,
    [docNo, DOC_TYPE.count],
  ))[0] as { wh_code: string | null; po_no: string | null } | undefined;
  if (!header) return NextResponse.json({ error: "ບໍ່ພົບໃບກວດນັບ" }, { status: 404 });

  // Full PO list (with supplier) for this sheet.
  const pos = await query<{ po_no: string; supplier_code: string | null; cust_name: string | null }>(
    `SELECT rp.po_no, rp.supplier_code,
            (SELECT p.cust_name FROM public.odg_po_remain p WHERE p.doc_no = rp.po_no LIMIT 1) AS cust_name
     FROM public.wms_product_receive_po rp WHERE rp.doc_no = $1 ORDER BY rp.line_order, rp.roworder`,
    [docNo],
  );
  const poList = pos.length > 0 ? pos : (header.po_no ? [{ po_no: header.po_no, supplier_code: null, cust_name: null }] : []);

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (header.wh_code === null || !accessible.includes(header.wh_code))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [lines, serials] = await Promise.all([
    query(
      `SELECT d.item_code, d.item_name, d.unit_code, d.qty::text AS qty,
              ${needsIsnSql("inv")} AS is_isn,
              ph.pallet::text AS pallet, ph.stack::text AS stack
       FROM public.wms_product_receive_detail d
       LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
       ${phDimensionLateralJoin("inv")}
       WHERE d.doc_no = $1 ORDER BY d.roworder`,
      [docNo],
    ),
    query(
      // Exclude cancelled serials (ignore_sync=2) left from an earlier partial receipt.
      `SELECT item_code, serial_number FROM public.wms_product_receive_serial_detail
       WHERE ref_rec_doc = $1 AND COALESCE(ignore_sync,0) <> 2 ORDER BY roworder`,
      [docNo],
    ),
  ]);

  // Putaway suggestions for this warehouse:
  //  sameLocs  = locations already holding one of this sheet's items (ລວມກອງ)
  //  emptyLocs = known locations whose net balance is ≤ 0 (ວ່າງ)
  const itemCodes = (lines as { item_code: string }[]).map((l) => l.item_code);
  const wh = (header as { wh_code: string | null }).wh_code;
  const [sameLocs, emptyLocs] = wh
    ? await Promise.all([
        itemCodes.length
          ? query<{ location: string; item_code: string; qty: string }>(
              `SELECT NULLIF(TRIM(shelf_code1), '') AS location, item_code, SUM(qty * calc_flag)::numeric::text AS qty
               FROM public.odg_wms_trans_detail
               WHERE wh_code = $1 AND item_code = ANY($2) AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL
                 AND (status = 0 OR status IS NULL)
               GROUP BY 1, item_code HAVING SUM(qty * calc_flag) > 0.0001
               ORDER BY SUM(qty * calc_flag) DESC LIMIT 30`,
              [wh, itemCodes],
            )
          : Promise.resolve([]),
        query<{ location: string }>(
          `SELECT location FROM (
             SELECT NULLIF(TRIM(shelf_code1), '') AS location, SUM(qty * calc_flag) AS bal
             FROM public.odg_wms_trans_detail
             WHERE wh_code = $1 AND NULLIF(TRIM(shelf_code1), '') IS NOT NULL AND (status = 0 OR status IS NULL)
             GROUP BY 1
           ) x WHERE bal <= 0.0001 ORDER BY location LIMIT 30`,
          [wh],
        ),
      ])
    : [[], []];
  return NextResponse.json({ header, pos: poList, lines, serials, sameLocs, emptyLocs: (emptyLocs as { location: string }[]).map((r) => r.location) });
}

export async function PUT(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();

  const header = await loadHeader(docNo);
  if (!header || header.doc_type !== DOC_TYPE.count) return NextResponse.json({ error: "ບໍ່ພົບໃບກວດນັບ" }, { status: 404 });
  if (header.status !== RECEIVE_STATUS.draft) return NextResponse.json({ error: "ໃບກວດນັບນີ້ຮັບເຂົ້າແລ້ວ ແກ້ໄຂບໍ່ໄດ້" }, { status: 409 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (header.wh_code === null || !accessible.includes(header.wh_code))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  let body: { remark?: unknown; lines?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການກວດນັບ" }, { status: 400 });

  type CleanLine = { item_code: string; item_name: string | null; unit_code: string; qty: number; serials: { serial_number: string }[] };
  const lines: CleanLine[] = [];
  for (const raw of body.lines as LineIn[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) return NextResponse.json({ error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    const serials: CleanLine["serials"] = [];
    if (Array.isArray(raw.serials)) {
      for (const s of raw.serials as SerialIn[]) {
        const sn = str(s.serial_number);
        if (sn) serials.push({ serial_number: sn });
      }
    }
    if (serials.length > qty + 1e-6) return NextResponse.json({ error: `${item_code}: SN ເກີນຈຳນວນ` }, { status: 400 });
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code), qty, serials });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການກວດນັບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE public.wms_product_receive SET remark = $2 WHERE doc_no = $1`, [docNo, str(body.remark) || null]);
    await client.query(`DELETE FROM public.wms_product_receive_detail WHERE doc_no = $1`, [docNo]);
    // Keep reused (held-origin) serials — they carry already-printed labels;
    // writeCountSerials accounts for them. Keep cancelled serials (ignore_sync=2)
    // too so their ISN number is never regenerated. Only drop the fresh ones.
    await client.query(`DELETE FROM public.wms_product_receive_serial_detail WHERE ref_rec_doc = $1 AND COALESCE(is_lock_record,0) = 0 AND COALESCE(ignore_sync,0) <> 2`, [docNo]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO public.wms_product_receive_detail (doc_no, doc_date, doc_time, item_code, item_name, unit_code, qty, create_date_time_now)
         VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, now())`,
        [docNo, line.item_code, line.item_name, line.unit_code || null, line.qty],
      );
    }
    // Re-generate + reserve ISN for the edited counts (reusing held SN of the
    // sheet's PO list). Skipped when this warehouse's RECEIVE menu has SN off.
    if (await warehouseSnEnabled(header.wh_code ?? "", "receive", client)) {
      const poNos = await loadPos(docNo, header.po_no);
      await writeCountSerials(client, docNo, lines.map((l) => ({ item_code: l.item_code, qty: l.qty, serials: l.serials })), poNos);
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();

  const header = await loadHeader(docNo);
  if (!header || header.doc_type !== DOC_TYPE.count) return NextResponse.json({ error: "ບໍ່ພົບໃບກວດນັບ" }, { status: 404 });
  if (header.status !== RECEIVE_STATUS.draft) return NextResponse.json({ error: "ໃບກວດນັບນີ້ຮັບເຂົ້າແລ້ວ ລົບບໍ່ໄດ້" }, { status: 409 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (header.wh_code === null || !accessible.includes(header.wh_code))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Reused (held-origin) serials carry already-printed labels — don't destroy
    // them. Release them back to the held pool on a surviving sibling count
    // sheet that shares any of this sheet's POs; then drop only the fresh.
    const poNos = await loadPos(docNo, header.po_no);
    await client.query(
      `UPDATE public.wms_product_receive_serial_detail sd
         SET ref_rec_doc = COALESCE((
               SELECT h2.doc_no FROM public.wms_product_receive h2
               JOIN public.wms_product_receive_po rp2 ON rp2.doc_no = h2.doc_no
               WHERE rp2.po_no = ANY($2) AND h2.doc_type = $3 AND h2.doc_no <> $1
               ORDER BY h2.doc_no DESC LIMIT 1), sd.ref_rec_doc),
             ignore_sync = 1, is_lock_record = 0, last_update_date_time_now = now()
       WHERE sd.ref_rec_doc = $1 AND COALESCE(sd.is_lock_record,0) = 1`,
      [docNo, poNos, DOC_TYPE.count],
    );
    await client.query(`DELETE FROM public.wms_product_receive_serial_detail WHERE ref_rec_doc = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive_ref WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive_po WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_receive WHERE doc_no = $1`, [docNo]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, deleted: docNo });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ລົບບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

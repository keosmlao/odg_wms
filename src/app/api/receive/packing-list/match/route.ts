import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { matchPackingLines, type MatchInput } from "@/lib/packingMatch";

/**
 * ແນະນຳການຈັບຄູ່ + ຈັດສັນ PO ໃຫ້ລາຍການໃນໃບ packing.
 *
 *   POST { wh, doc_no?, supplier_code?, pos?: string[], lines?: [{id,text,qty,item_code?}] }
 *
 * ບໍ່ສົ່ງ `lines` ມາ ແຕ່ສົ່ງ `doc_no` → ດຶງລາຍການຈາກໃບ packing ນັ້ນເອງ.
 * ຄືນ: ຕໍ່ແຖວ — ສິນຄ້າ SML ທີ່ແນະນຳ (+ ຕົວເລືອກອື່ນ), ແຜນຈັດສັນເຂົ້າ PO
 * (ເກີນຄ້າງຮັບຂອງ PO ໜຶ່ງ → ໄຫຼໄປ PO ຕໍ່ໄປ) ແລະ ຈຳນວນທີ່ບໍ່ມີ PO ຮອງຮັບ.
 *
 * ເປັນ **ຄຳແນະນຳຢ່າງດຽວ** — ບໍ່ໄດ້ຂຽນຫຍັງລົງຖານຂໍ້ມູນ.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: {
    wh?: unknown; doc_no?: unknown; supplier_code?: unknown; pos?: unknown; lines?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let wh = String(body.wh ?? "").trim();
  const docNo = String(body.doc_no ?? "").trim();
  let supplier = String(body.supplier_code ?? "").trim() || null;
  const poFilter = Array.isArray(body.pos)
    ? body.pos.map((p) => String(p ?? "").trim().toUpperCase()).filter(Boolean)
    : undefined;

  const client = await pool.connect();
  try {
    let lines: MatchInput[] = [];

    if (Array.isArray(body.lines) && body.lines.length > 0) {
      lines = (body.lines as Record<string, unknown>[]).map((l, i) => ({
        id: String(l.id ?? i + 1),
        text: String(l.text ?? "").trim(),
        qty: Number.parseFloat(String(l.qty ?? "")) || 0,
        item_code: typeof l.item_code === "string" ? l.item_code.trim() : null,
        supplier_item_code: typeof l.supplier_item_code === "string" ? l.supplier_item_code.trim() : null,
      })).filter((l) => l.text || l.item_code || l.supplier_item_code);
    } else if (docNo) {
      // ດຶງລາຍການຈາກໃບ packing ທີ່ນຳເຂົ້າໄວ້
      const hdr = await client.query<{ wh_code: string; supplier_code: string | null }>(
        `SELECT wh_code, supplier_code FROM public.wms_packing_list WHERE doc_no = $1`,
        [docNo],
      );
      if (!hdr.rows[0]) return NextResponse.json({ error: "ບໍ່ພົບໃບ packing ນີ້" }, { status: 404 });
      wh = wh || hdr.rows[0].wh_code;
      supplier = supplier ?? hdr.rows[0].supplier_code;
      const det = await client.query<{ roworder: string; src_text: string | null; raw_item_code: string | null; item_name: string | null; item_code: string | null; qty: string }>(
        `SELECT roworder, src_text, raw_item_code, item_name, item_code, qty::text AS qty
           FROM public.wms_packing_list_detail WHERE doc_no = $1 ORDER BY line_order, roworder`,
        [docNo],
      );
      lines = det.rows.map((d) => ({
        id: d.roworder,
        text: d.src_text || d.item_name || "",
        qty: Number.parseFloat(d.qty) || 0,
        item_code: d.item_code,
        // raw_item_code = ລະຫັດຕາມໄຟລ໌ = ລະຫັດຂອງຜູ້ສະໜອງ
        supplier_item_code: d.raw_item_code,
      }));
    }

    if (!wh) return NextResponse.json({ error: "ບໍ່ມີສາງ" }, { status: 400 });
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(wh)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການທີ່ຈະຈັບຄູ່" }, { status: 400 });

    const result = await matchPackingLines(client, wh, lines, { supplierCode: supplier, poFilter });

    // ສະຫຼຸບຕໍ່ PO ເພື່ອສະແດງກ່ອນສ້າງໃບກວດນັບ
    const poTotals = new Map<string, { po_no: string; lines: number; qty: number }>();
    for (const l of result.lines) {
      for (const a of l.allocations) {
        const e = poTotals.get(a.po_no) ?? { po_no: a.po_no, lines: 0, qty: 0 };
        e.lines++;
        e.qty += a.qty;
        poTotals.set(a.po_no, e);
      }
    }

    return NextResponse.json({
      wh,
      lines: result.lines,
      pool_size: result.pool_size,
      po_summary: Array.from(poTotals.values()).sort((a, b) => a.po_no.localeCompare(b.po_no)),
      unresolved: result.lines.filter((l) => !l.item_code).length,
      needs_review: result.lines.filter((l) => l.item_code && !l.confident).length,
      over: result.lines.filter((l) => l.unallocated > 0).length,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

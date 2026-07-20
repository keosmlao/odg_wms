import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Pending lines to receive into a warehouse, for several source-document types:
 *
 *   po            ໃບສັ່ງຊື້            trans_flag 6  → odg_po_remain (qty_balance)
 *   transfer      ໃບໂອນສິນຄ້າ        trans_flag 72 → ic_trans (received at wh_to)
 *   sales_return  ໃບຮັບคืนจากการขาย   trans_flag 48 → ic_trans_detail (wh_code, calc_flag +1)
 *   issue_return  ໃບຮັບคืนจากการເບີກ  trans_flag 58 → ic_trans_detail (wh_code, calc_flag +1)
 *
 * For every type the WMS amount already received (wms_product_receive_detail by
 * ref_doc_no = source doc) is subtracted, so a line never double-receives:
 *   remaining = source_qty − Σ(WMS received)
 *
 * Query: ?wh=<code>&type=po|transfer|sales_return|issue_return&q=&limit=&fresh=1
 */
type PoRow = {
  po_no: string;
  cust_code: string | null;
  cust_name: string | null;
  wh_code: string;
  wh_name: string | null;
  doc_date: string | null;
  send_date: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  barcode: string | null;
  ordered: string;
  erp_balance: string;
  is_isn: boolean;
};

declare global {
  // eslint-disable-next-line no-var
  var __poRemainCache: Map<string, { rows: PoRow[]; ts: number }> | undefined;
}
const cache = (globalThis.__poRemainCache ??= new Map());
const TTL_MS = 5 * 60_000;

const RETURN_FLAG: Record<string, number> = { sales_return: 48, issue_return: 58 };

async function getPoRemain(wh: string, fresh: boolean): Promise<PoRow[]> {
  const hit = cache.get(wh);
  if (!fresh && hit && Date.now() - hit.ts < TTL_MS) return hit.rows;
  const rows = await query<PoRow>(
    `SELECT p.doc_no AS po_no, p.cust_code, p.cust_name,
            w.code AS wh_code, p.warehouse AS wh_name,
            to_char(p.doc_date,'YYYY-MM-DD')  AS doc_date,
            to_char(p.send_date,'YYYY-MM-DD') AS send_date,
            p.item_code, p.item_name, p.unit_code, p.barcode,
            p.qty::text AS ordered, p.qty_balance::text AS erp_balance,
            COALESCE(i.is_isn,0) = 1 AS is_isn
     FROM public.odg_po_remain p
     JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
     LEFT JOIN public.ic_inventory i ON i.code = p.item_code
     WHERE p.qty_balance > 0 AND w.code = $1
       AND p.item_code NOT LIKE '97%'`,
    [wh],
  );
  cache.set(wh, { rows, ts: Date.now() });
  return rows;
}

/** Transfer (72): items arriving at wh_to. */
function getTransfer(wh: string): Promise<PoRow[]> {
  return query<PoRow>(
    `SELECT t.doc_no AS po_no, t.cust_code, NULL AS cust_name,
            t.wh_to AS wh_code, w.name_1 AS wh_name,
            to_char(t.doc_date,'YYYY-MM-DD') AS doc_date, NULL AS send_date,
            d.item_code, d.item_name, d.unit_code, d.barcode,
            abs(d.qty)::text AS ordered, abs(d.qty)::text AS erp_balance,
            COALESCE(i.is_isn,0) = 1 AS is_isn
     FROM public.ic_trans t
     JOIN public.ic_trans_detail d ON d.doc_no = t.doc_no AND d.trans_flag = 72
     LEFT JOIN public.ic_warehouse w ON w.code = t.wh_to
     LEFT JOIN public.ic_inventory i ON i.code = d.item_code
     WHERE t.trans_flag = 72 AND t.wh_to = $1
       AND t.doc_date >= CURRENT_DATE - INTERVAL '90 days'
       AND abs(d.qty) > 0
       AND d.item_code NOT LIKE '97%'
     ORDER BY t.doc_date DESC
     LIMIT 2000`,
    [wh],
  );
}

/** Sales/issue return (48/58): items returned into wh_code (calc_flag +1). */
function getReturn(wh: string, flag: number): Promise<PoRow[]> {
  return query<PoRow>(
    `SELECT t.doc_no AS po_no, t.cust_code, NULL AS cust_name,
            d.wh_code AS wh_code, w.name_1 AS wh_name,
            to_char(t.doc_date,'YYYY-MM-DD') AS doc_date, NULL AS send_date,
            d.item_code, d.item_name, d.unit_code, d.barcode,
            abs(d.qty)::text AS ordered, abs(d.qty)::text AS erp_balance,
            COALESCE(i.is_isn,0) = 1 AS is_isn
     FROM public.ic_trans_detail d
     JOIN public.ic_trans t ON t.doc_no = d.doc_no AND t.trans_flag = $2
     LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
     LEFT JOIN public.ic_inventory i ON i.code = d.item_code
     WHERE d.trans_flag = $2 AND d.wh_code = $1 AND COALESCE(d.calc_flag,0) >= 0
       AND t.doc_date >= CURRENT_DATE - INTERVAL '90 days'
       AND abs(d.qty) > 0
       AND d.item_code NOT LIKE '97%'
     ORDER BY t.doc_date DESC
     LIMIT 2000`,
    [wh, flag],
  );
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ lines: [] });
  }

  const url = new URL(request.url);
  const wh = (url.searchParams.get("wh") ?? "").trim();
  const type = (url.searchParams.get("type") ?? "po").trim();
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const fresh = url.searchParams.get("fresh") === "1";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "300", 10) || 300, 1), 1000);

  if (!wh) return NextResponse.json({ lines: [], needWarehouse: true });
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // Source lines by document type + WMS receipts (subtracted) in parallel.
  const sourceP =
    type === "transfer" ? getTransfer(wh)
    : type in RETURN_FLAG ? getReturn(wh, RETURN_FLAG[type])
    : getPoRemain(wh, fresh);

  const [srcRows, rcv] = await Promise.all([
    sourceP,
    query<{ po_no: string; item_code: string; received: string }>(
      // Attribute each received line to its own PO (multi-PO receipts set
      // d.ref_doc_no per line); fall back to the header PO for legacy receipts.
      `SELECT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), h.ref_doc_no) AS po_no, d.item_code, SUM(d.qty)::text AS received
       FROM public.wms_product_receive h
       JOIN public.wms_product_receive_detail d ON d.doc_no = h.doc_no
       WHERE h.warehouse_code = $1 AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), h.ref_doc_no) IS NOT NULL AND (h.status = 0 OR h.status IS NULL)
       GROUP BY COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), h.ref_doc_no), d.item_code`,
      [wh],
    ),
  ]);

  const receivedBy = new Map<string, number>();
  for (const r of rcv) receivedBy.set(`${r.po_no} ${r.item_code}`, Number.parseFloat(r.received) || 0);

  const lines = [];
  for (const p of srcRows) {
    const received = receivedBy.get(`${p.po_no} ${p.item_code}`) ?? 0;
    const remaining = (Number.parseFloat(p.erp_balance) || 0) - received;
    if (remaining <= 0) continue;
    if (q) {
      const hay = `${p.po_no} ${p.item_code} ${p.item_name ?? ""} ${p.cust_name ?? ""} ${p.cust_code ?? ""}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    lines.push({
      po_no: p.po_no,
      cust_code: p.cust_code,
      cust_name: p.cust_name,
      wh_code: p.wh_code,
      wh_name: p.wh_name,
      doc_date: p.doc_date,
      send_date: p.send_date,
      item_code: p.item_code,
      item_name: p.item_name,
      unit_code: p.unit_code,
      barcode: p.barcode,
      ordered: p.ordered,
      erp_balance: p.erp_balance,
      wms_received: String(received),
      remaining: String(remaining),
      is_isn: p.is_isn,
    });
    if (lines.length >= limit) break;
  }

  return NextResponse.json({ type, lines });
}

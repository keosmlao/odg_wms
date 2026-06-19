import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Resolve receive lines for a PO, to build a count sheet (ໃບກວດນັບ).
 *
 *   ?po=<PO>            → PO summary + the PO's own pending lines (odg_po_remain)
 *                        + optional PACK candidates (packing-list reference)
 *   ?po=<PO>&pack=<PACK> → the lines from a specific packing list instead
 *
 * remaining = odg_po_remain.qty_balance − WMS received (posted, status 0).
 */
type PackCandidate = { pack_no: string; pack_date: string | null; line_count: number; total_qty: string };
type PackLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  pack_qty: string;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  foot: string | null;
  stack: string | null;
};
type PoLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  foot: string | null;
  stack: string | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const po = (url.searchParams.get("po") ?? "").trim();
  const pack = (url.searchParams.get("pack") ?? "").trim();
  const wh = (url.searchParams.get("wh") ?? "").trim();
  if (!po) return NextResponse.json({ error: "ບໍ່ມີເລກ PO" }, { status: 400 });

  const accessible = accessibleWarehouses(session);

  // PO summary scoped to the requested warehouse (a PO can span warehouses).
  const poRows = await query<{ wh_code: string; wh_name: string | null; cust_code: string | null; cust_name: string | null }>(
    `SELECT w.code AS wh_code, w.name_1 AS wh_name, p.cust_code, p.cust_name
     FROM public.odg_po_remain p
     JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
     WHERE p.doc_no = $1${wh ? " AND w.code = $2" : ""}
     LIMIT 1`,
    wh ? [po, wh] : [po],
  );
  const poInfo = poRows[0] ?? null;
  if (!poInfo) return NextResponse.json({ error: "ບໍ່ພົບ PO ນີ້ໃນລາຍການຄ້າງຮັບ" }, { status: 404 });
  if (Array.isArray(accessible) && !accessible.includes(poInfo.wh_code)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງຂອງ PO ນີ້" }, { status: 403 });
  }

  if (!pack) {
    // Pull the PO's own pending lines directly (default source) + PACK candidates.
    const [poLines, candidates, existing] = await Promise.all([
      query<PoLine>(
        `SELECT p.item_code,
                COALESCE(NULLIF(p.item_name,''), inv.name_1) AS item_name,
                p.unit_code,
                p.qty::text AS ordered,
                (p.qty_balance - COALESCE((
                   SELECT SUM(rd.qty) FROM public.wms_product_receive rh
                   JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                   WHERE rh.ref_doc_no = $1 AND rd.item_code = p.item_code AND (rh.status = 0 OR rh.status IS NULL)${wh ? " AND rh.warehouse_code = $2" : ""}
                 ), 0))::text AS remaining,
                COALESCE(inv.is_isn,0) = 1 AS is_isn,
                dm.foot::text AS foot, dm.stack::text AS stack
         FROM public.odg_po_remain p
         JOIN public.ic_warehouse w ON w.name_1 = p.warehouse${wh ? " AND w.code = $2" : ""}
         LEFT JOIN public.ic_inventory inv ON inv.code = p.item_code
         LEFT JOIN (SELECT DISTINCT ON (ic_code) ic_code, (NULLIF(width,0)::numeric*NULLIF(length,0)::numeric/10000) foot, NULLIF(stack,0)::numeric stack FROM public.odg_wms_product_dimension ORDER BY ic_code, roworder) dm ON dm.ic_code = p.item_code
         WHERE p.doc_no = $1 AND p.qty_balance > 0
         ORDER BY p.item_code`,
        wh ? [po, wh] : [po],
      ),
      query<PackCandidate>(
        `SELECT d.doc_no AS pack_no,
                to_char(MIN(h.doc_date),'YYYY-MM-DD') AS pack_date,
                count(*)::int AS line_count,
                SUM(d.qty)::text AS total_qty
         FROM public.odg_packing_list_detail d
         LEFT JOIN public.odg_packing_list h ON h.doc_no = d.doc_no
         WHERE d.bill_no = $1
         GROUP BY d.doc_no
         ORDER BY MIN(h.doc_date) DESC NULLS LAST, d.doc_no DESC`,
        [po],
      ),
      // Existing OPEN count sheet for this PO (+warehouse) — to warn of duplicates.
      query<{ doc_no: string }>(
        `SELECT doc_no FROM public.wms_product_receive
         WHERE doc_type = 2 AND status = 9 AND ref_doc_no = $1${wh ? " AND warehouse_code = $2" : ""}
         ORDER BY doc_no DESC LIMIT 1`,
        wh ? [po, wh] : [po],
      ),
    ]);
    return NextResponse.json({ po: poInfo, lines: poLines, packs: candidates, existing_count: existing[0]?.doc_no ?? null });
  }

  // Lines for the chosen packing list, joined to remaining + is_isn.
  const lines = await query<PackLine>(
    `SELECT d.item_code,
            COALESCE(NULLIF(d.item_name,''), inv.name_1) AS item_name,
            d.unit_code,
            d.qty::text AS pack_qty,
            COALESCE(rem.ordered, 0)::text  AS ordered,
            COALESCE(rem.balance, 0)::text  AS remaining,
            COALESCE(inv.is_isn, 0) = 1     AS is_isn,
            dm.foot::text AS foot, dm.stack::text AS stack
     FROM public.odg_packing_list_detail d
     LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
     LEFT JOIN (SELECT DISTINCT ON (ic_code) ic_code, (NULLIF(width,0)::numeric*NULLIF(length,0)::numeric/10000) foot, NULLIF(stack,0)::numeric stack FROM public.odg_wms_product_dimension ORDER BY ic_code, roworder) dm ON dm.ic_code = d.item_code
     LEFT JOIN LATERAL (
       SELECT MAX(p.qty)::numeric AS ordered,
              (MAX(p.qty_balance) - COALESCE((
                 SELECT SUM(rd.qty) FROM public.wms_product_receive rh
                 JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                 WHERE rh.ref_doc_no = $1 AND rd.item_code = d.item_code AND (rh.status = 0 OR rh.status IS NULL)
              ), 0))::numeric AS balance
       FROM public.odg_po_remain p
       WHERE p.doc_no = $1 AND p.item_code = d.item_code
     ) rem ON true
     WHERE d.doc_no = $2 AND d.bill_no = $1
     ORDER BY d.roworder`,
    [po, pack],
  );
  return NextResponse.json({ po: poInfo, pack, lines });
}

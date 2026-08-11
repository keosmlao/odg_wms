import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { phDimensionLateralJoin } from "@/lib/ph-dimension";
import { needsIsnSql } from "@/lib/isnScope";

/**
 * Resolve receive lines for one or more POs, to build a count sheet (ໃບກວດນັບ).
 * A count sheet is ONE warehouse but may reference MANY POs.
 *
 *   ?po=<PO>[&po=<PO2>...][&wh=<WH>]
 *        → warehouse + PO summaries + pending lines, MERGED per item across the
 *          POs (each merged line lists its source POs for allocation).
 *   ?po=<PO>&pack=<PACK>[&wh=<WH>]  (single PO only)
 *        → the lines from a specific packing list instead.
 *
 * remaining (per PO+item) = odg_po_remain.qty_balance − Σ WMS received (posted).
 * WMS received is attributed by the receipt line's own ref_doc_no when set
 * (multi-PO receipts), else the receipt header ref_doc_no (legacy single-PO).
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
  pallet: string | null;
  stack: string | null;
};
/** One (PO, item) pending row before merging. */
type PoItemRow = {
  po_no: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  pallet: string | null;
  stack: string | null;
};
/** A merged line across POs, with its per-PO sources. */
type MergedLine = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  ordered: string;
  remaining: string;
  is_isn: boolean;
  pallet: string | null;
  stack: string | null;
  sources: { po_no: string; ordered: string; remaining: string }[];
};

/** Subtract-WMS-received expression, attributing by line ref_doc_no then header. */
const RECEIVED_FILTER = `COALESCE(NULLIF(TRIM(rd.ref_doc_no), ''), rh.ref_doc_no)`;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const pos = Array.from(
    new Set(url.searchParams.getAll("po").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean)),
  );
  const pack = (url.searchParams.get("pack") ?? "").trim();
  let wh = (url.searchParams.get("wh") ?? "").trim();
  if (pos.length === 0) return NextResponse.json({ error: "ບໍ່ມີເລກ PO" }, { status: 400 });

  const accessible = accessibleWarehouses(session);

  // Resolve the sheet's warehouse. If not given, derive it from the first PO.
  // A PO can appear in several warehouses; a count sheet is pinned to one.
  if (!wh) {
    const whRow = await query<{ wh_code: string }>(
      `SELECT w.code AS wh_code FROM public.odg_po_remain p
       JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
       WHERE p.doc_no = $1 LIMIT 1`,
      [pos[0]],
    );
    wh = whRow[0]?.wh_code ?? "";
  }
  if (!wh) return NextResponse.json({ error: "ບໍ່ພົບສາງຂອງ PO ນີ້ໃນລາຍການຄ້າງຮັບ" }, { status: 404 });
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const whRow = await query<{ wh_name: string | null }>(
    `SELECT name_1 AS wh_name FROM public.ic_warehouse WHERE code = $1 LIMIT 1`,
    [wh],
  );
  const whInfo = { wh_code: wh, wh_name: whRow[0]?.wh_name ?? null };

  // Per-PO summary (supplier), restricted to this warehouse.
  const poSummaries = await query<{ po_no: string; cust_code: string | null; cust_name: string | null }>(
    `SELECT DISTINCT p.doc_no AS po_no, p.cust_code, p.cust_name
     FROM public.odg_po_remain p
     JOIN public.ic_warehouse w ON w.name_1 = p.warehouse AND w.code = $2
     WHERE p.doc_no = ANY($1)`,
    [pos, wh],
  );
  const found = new Set(poSummaries.map((p) => p.po_no));
  const errors = pos.filter((p) => !found.has(p)).map((po_no) => ({ po_no, error: "ບໍ່ພົບ PO ນີ້ໃນສາງທີ່ເລືອກ" }));

  // Existing OPEN count sheets referencing any of these POs (warn of duplicates).
  const existingCounts = await query<{ po_no: string; doc_no: string }>(
    `SELECT DISTINCT rp.po_no, h.doc_no
     FROM public.wms_product_receive h
     JOIN public.wms_product_receive_po rp ON rp.doc_no = h.doc_no
     WHERE h.doc_type = 2 AND h.status = 9 AND h.warehouse_code = $2 AND rp.po_no = ANY($1)`,
    [pos, wh],
  );

  // Single-PO + pack: keep the classic packing-list override.
  if (pack && pos.length === 1) {
    const po = pos[0];
    const lines = await query<PackLine>(
      `SELECT d.item_code,
              COALESCE(NULLIF(d.item_name,''), inv.name_1) AS item_name,
              d.unit_code,
              d.qty::text AS pack_qty,
              COALESCE(rem.ordered, 0)::text  AS ordered,
              COALESCE(rem.balance, 0)::text  AS remaining,
              ${needsIsnSql("inv")}           AS is_isn,
              ph.pallet::text AS pallet, ph.stack::text AS stack
       FROM public.odg_packing_list_detail d
       LEFT JOIN public.ic_inventory inv ON inv.code = d.item_code
       ${phDimensionLateralJoin("inv")}
       LEFT JOIN LATERAL (
         SELECT MAX(p.qty)::numeric AS ordered,
                (MAX(p.qty_balance) - COALESCE((
                   SELECT SUM(rd.qty) FROM public.wms_product_receive rh
                   JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                   WHERE ${RECEIVED_FILTER} = $1 AND rd.item_code = d.item_code AND (rh.status = 0 OR rh.status IS NULL)
                ), 0))::numeric AS balance
         FROM public.odg_po_remain p
         WHERE p.doc_no = $1 AND p.item_code = d.item_code
       ) rem ON true
       WHERE d.doc_no = $2 AND d.bill_no = $1
         AND d.item_code NOT LIKE '97%'
       ORDER BY d.roworder`,
      [po, pack],
    );
    const merged: MergedLine[] = lines.map((l) => ({
      item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code,
      ordered: l.ordered, remaining: l.remaining, is_isn: l.is_isn, pallet: l.pallet, stack: l.stack,
      sources: [{ po_no: po, ordered: l.ordered, remaining: l.remaining }],
    }));
    return NextResponse.json({ wh: whInfo, pos: poSummaries, pack, lines: merged, existing_counts: existingCounts, errors });
  }

  // Default: pending lines for all POs, then merge per item.
  const [rows, candidates] = await Promise.all([
    query<PoItemRow>(
      `SELECT p.doc_no AS po_no, p.item_code,
              COALESCE(NULLIF(p.item_name,''), inv.name_1) AS item_name,
              p.unit_code,
              p.qty::text AS ordered,
              (p.qty_balance - COALESCE((
                 SELECT SUM(rd.qty) FROM public.wms_product_receive rh
                 JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                 WHERE ${RECEIVED_FILTER} = p.doc_no AND rd.item_code = p.item_code
                   AND (rh.status = 0 OR rh.status IS NULL) AND rh.warehouse_code = $2
               ), 0))::text AS remaining,
              ${needsIsnSql("inv")} AS is_isn,
              ph.pallet::text AS pallet, ph.stack::text AS stack
       FROM public.odg_po_remain p
       JOIN public.ic_warehouse w ON w.name_1 = p.warehouse AND w.code = $2
       LEFT JOIN public.ic_inventory inv ON inv.code = p.item_code
       ${phDimensionLateralJoin("inv")}
       WHERE p.doc_no = ANY($1) AND p.qty_balance > 0
         AND p.item_code NOT LIKE '97%'
       ORDER BY p.item_code, p.doc_no`,
      [pos, wh],
    ),
    // PACK candidates only make sense for a single PO.
    pos.length === 1
      ? query<PackCandidate>(
          `SELECT d.doc_no AS pack_no,
                  to_char(MIN(h.doc_date),'YYYY-MM-DD') AS pack_date,
                  count(*)::int AS line_count,
                  SUM(d.qty)::text AS total_qty
           FROM public.odg_packing_list_detail d
           LEFT JOIN public.odg_packing_list h ON h.doc_no = d.doc_no
           WHERE d.bill_no = $1
           GROUP BY d.doc_no
           ORDER BY MIN(h.doc_date) DESC NULLS LAST, d.doc_no DESC`,
          [pos[0]],
        )
      : Promise.resolve([] as PackCandidate[]),
  ]);

  // Merge (PO, item) rows into one line per item, keeping remaining>0 sources.
  const byItem = new Map<string, MergedLine>();
  for (const r of rows) {
    const rem = Number.parseFloat(r.remaining) || 0;
    if (rem <= 0) continue; // this PO's line is already fully received
    let m = byItem.get(r.item_code);
    if (!m) {
      m = {
        item_code: r.item_code, item_name: r.item_name, unit_code: r.unit_code,
        ordered: "0", remaining: "0", is_isn: r.is_isn, pallet: r.pallet, stack: r.stack, sources: [],
      };
      byItem.set(r.item_code, m);
    }
    m.ordered = String((Number.parseFloat(m.ordered) || 0) + (Number.parseFloat(r.ordered) || 0));
    m.remaining = String((Number.parseFloat(m.remaining) || 0) + rem);
    m.is_isn = m.is_isn || r.is_isn;
    if (!m.pallet && r.pallet) m.pallet = r.pallet;
    if (!m.stack && r.stack) m.stack = r.stack;
    m.sources.push({ po_no: r.po_no, ordered: r.ordered, remaining: String(rem) });
  }
  const merged = Array.from(byItem.values());

  return NextResponse.json({
    wh: whInfo,
    pos: poSummaries,
    lines: merged,
    packs: pos.length === 1 ? candidates : undefined,
    existing_counts: existingCounts,
    errors,
  });
}

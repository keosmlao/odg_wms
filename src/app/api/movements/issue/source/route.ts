import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { minStockLevels } from "@/lib/minStock";

/**
 * One source document's issuable lines, read from `ic_trans_detail` (header in
 * `ic_trans`), for the goods-issue flow. For each item line it returns:
 *   - remaining = (qty − cancel_qty) summed for the item, minus what WMS already
 *     issued for this source doc (odg_wms_trans_detail, doc_ref = doc, flag 72)
 *     and minus what is already parked on an unconfirmed pick slip.
 *   - issued_qty / pending_qty = the two deductions above, returned separately so
 *     the UI can explain WHY the default allocation is smaller than the ordered
 *     qty (an open pick slip silently eating the balance is otherwise invisible).
 *   - is_isn (serialized?)
 *   - min_stock = ຂັ້ນຕ່ຳ/ຂັ້ນສູງ + ຄົງເຫຼືອລວມທັງສາງ (null ເມື່ອສາງບໍ່ໄດ້ເປີດຄຸມ ຫຼື
 *     ສິນຄ້າບໍ່ໄດ້ຕັ້ງຄ່າ) — ໃຫ້ UI ເຕືອນເມື່ອຈຳນວນທີ່ຈະຈ່າຍພາຍອດລົງຕ່ຳກວ່າຂັ້ນຕ່ຳ
 *   - locations: the WMS (rack, location, pallet) nodes in this warehouse that
 *     currently hold the item, with their balance — where the operator picks
 *     what to deduct.
 *
 * Query: ?doc=<doc_no>&type=req|transfer|sale&wh=<code>
 * Returns: { doc:{ doc_no, doc_date, cust_code, cust_name, remark },
 *            pending_docs:[{ doc_no, doc_date, qty, remark }], lines:[...] }
 */
const FLAG_BY_TYPE: Record<string, number> = { req: 122, transfer: 124, sale: 44 };
const ISSUE_STOCK_FLAG = 72;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const doc = url.searchParams.get("doc")?.trim() ?? "";
  const type = url.searchParams.get("type")?.trim() ?? "req";
  const wh = url.searchParams.get("wh")?.trim() ?? "";

  const flag = FLAG_BY_TYPE[type];
  if (flag === undefined) return NextResponse.json({ error: "ປະເພດເອກະສານບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (!doc || !wh) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const headerRows = await query<{
    doc_no: string;
    doc_date: string | null;
    cust_code: string | null;
    cust_name: string | null;
    remark: string | null;
  }>(
    `SELECT h.doc_no, to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
            h.cust_code, cu.name_1 AS cust_name, h.remark
     FROM public.ic_trans h
     LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
     WHERE h.doc_no = $1 AND h.trans_flag = $2`,
    [doc, flag],
  );
  if (headerRows.length === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບເອກະສານ" }, { status: 404 });
  }

  // Per-item source qty (netted of cancellations), minus WMS already issued.
  const lineRows = await query<{
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    is_isn: number | null;
    src_qty: string;
    issued_qty: string;
    pending_qty: string;
    remaining: string;
  }>(
    `WITH src AS (
       SELECT d.item_code,
              MAX(d.item_name) AS item_name,
              MAX(d.unit_code) AS unit_code,
              SUM(GREATEST(d.qty - COALESCE(d.cancel_qty, 0), 0)) AS src_qty
       FROM public.ic_trans_detail d
       WHERE d.doc_no = $1 AND d.trans_flag = $2 AND d.wh_code = $3
         AND (d.status = 0 OR d.status IS NULL)
         AND d.item_code NOT LIKE '97%'  -- ສິນຄ້າ/ບໍລິການ ໝວດ 97 ບໍ່ຈ່າຍອອກສາງ
       GROUP BY d.item_code
     ),
     issued AS (
       -- ນັບສະເພາະຂາອອກຈາກຕົ້ນທາງ (calc_flag −1, ບໍ່ນັບຂາ +1 ເຂົ້າສາງກາງ 9903)
       -- ບໍ່ດັ່ງນັ້ນ ໃບໂອນ (124) ຈະຖືກນັບ 2 ເທື່ອ → remaining ຕິດລົບ → ລາຍການຫາຍ
       SELECT w.item_code, SUM(w.qty) AS wms_qty
       FROM public.odg_wms_trans_detail w
       WHERE w.doc_ref = $1 AND w.trans_flag = ${ISSUE_STOCK_FLAG}
         AND (w.status = 0 OR w.status IS NULL)
         AND w.calc_flag = -1 AND w.wh_code <> '9903'
       GROUP BY w.item_code
     ),
     -- ໃບສັ່ງຈ່າຍ (pick) ທີ່ສ້າງແລ້ວ ລໍຖ້າຢືນຢັນ (status 0) — ຫັກອອກຈາກຄ້າງ
     -- ໃບຖ້ຽວ (1 ໃບ ຫຼາຍບິນ) ເກັບບິນຕົ້ນທາງໄວ້ລະດັບແຖວ → ໃຊ້ d.ref_doc_no ກ່ອນ.
     pending AS (
       SELECT d.item_code, SUM(d.qty) AS pend_qty
       FROM public.wms_product_out o
       JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
       WHERE COALESCE(o.status, 0) = 0
         AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) = $1
       GROUP BY d.item_code
     )
     SELECT s.item_code, s.item_name, s.unit_code,
            -- "serialized" only when the item is is_isn AND actually has in-stock
            -- serials in this warehouse (the is_isn flag alone is too broad — many
            -- flagged items never carry serials, and must be issued by qty).
            (CASE WHEN COALESCE(inv.is_isn, 0) = 1 AND EXISTS (
               SELECT 1 FROM public.sn_inventory si
               WHERE si.item_code = s.item_code AND si.wh_code = $3 AND COALESCE(si.status, 0) = 0
             ) THEN 1 ELSE 0 END) AS is_isn,
            s.src_qty::numeric::text AS src_qty,
            COALESCE(i.wms_qty, 0)::numeric::text AS issued_qty,
            COALESCE(pd.pend_qty, 0)::numeric::text AS pending_qty,
            (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0))::numeric::text AS remaining
     FROM src s
     LEFT JOIN issued i ON i.item_code = s.item_code
     LEFT JOIN pending pd ON pd.item_code = s.item_code
     LEFT JOIN public.ic_inventory inv ON inv.code = s.item_code
     WHERE (s.src_qty - COALESCE(i.wms_qty, 0) - COALESCE(pd.pend_qty, 0)) > 0.0001
     ORDER BY s.item_code`,
    [doc, flag, wh],
  );

  // WMS stock locations for these items in the warehouse (where to deduct from).
  const itemCodes = lineRows.map((l) => l.item_code);
  const locRows = itemCodes.length
    ? await query<{
        item_code: string;
        rack: string;
        location: string;
        pallet: string;
        qty: string;
        first_in: string | null;
      }>(
        // FIFO: oldest stock first. first_in = earliest inbound (calc_flag>0)
        // date at the node, so the UI can suggest/default to the oldest location.
        //
        // NOTE: do NOT filter on `status` — same rule as the balance page. In
        // odg_wms_trans_detail status=1 is not "void": it marks the outbound (−1)
        // leg of an internal bin relocation (trans_flag 77 writes +1 status=0 into
        // the destination bin and −1 status=1 out of the source bin), plus a few
        // status=1 sales legs. Filtering it out keeps the +1 destination legs but
        // drops the −1 source legs, so a bin the goods were moved OUT of still
        // shows its old balance and gets suggested as a pick location.
        `SELECT t.item_code,
                COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
                SUM(t.qty * t.calc_flag)::text AS qty,
                to_char(MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0), 'YYYY-MM-DD') AS first_in
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1
           AND t.item_code = ANY($2)
         GROUP BY t.item_code, rack, location, pallet
         HAVING SUM(t.qty * t.calc_flag) > 0.0001
         ORDER BY t.item_code, MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) ASC NULLS LAST, SUM(t.qty * t.calc_flag) DESC`,
        [wh, itemCodes],
      )
    : [];

  // In-stock serials per node. A node can carry WMS balance with NO serial rows
  // (balance and sn_inventory drift apart), and when the warehouse requires ISN
  // on the pick slip such a node cannot be picked from at all — so the client
  // needs the count to keep the FIFO default off those nodes.
  const serialItems = lineRows.filter((l) => (l.is_isn ?? 0) === 1).map((l) => l.item_code);
  const snRows = serialItems.length
    ? await query<{ item_code: string; rack: string; location: string; pallet: string; sn_qty: string }>(
        `SELECT i.item_code,
                COALESCE(NULLIF(TRIM(i.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(i.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(i.pallet), ''), '')   AS pallet,
                count(*)::text AS sn_qty
         FROM public.sn_inventory i
         WHERE i.wh_code = $1 AND i.item_code = ANY($2) AND COALESCE(i.status, 0) = 0
         GROUP BY i.item_code, rack, location, pallet`,
        [wh, serialItems],
      )
    : [];
  const snByNode = new Map<string, number>();
  for (const r of snRows) {
    snByNode.set(`${r.item_code}|${r.rack}|${r.location}|${r.pallet}`, Number.parseInt(r.sn_qty, 10) || 0);
  }
  const serialSet = new Set(serialItems);

  const locByItem = new Map<string, { rack: string; location: string; pallet: string; qty: string; first_in: string | null; sn_qty: number | null }[]>();
  for (const r of locRows) {
    const arr = locByItem.get(r.item_code);
    const entry = {
      rack: r.rack,
      location: r.location,
      pallet: r.pallet,
      qty: r.qty,
      first_in: r.first_in,
      // null = item is not serialized here, so serial coverage is irrelevant.
      sn_qty: serialSet.has(r.item_code) ? snByNode.get(`${r.item_code}|${r.rack}|${r.location}|${r.pallet}`) ?? 0 : null,
    };
    if (arr) arr.push(entry);
    else locByItem.set(r.item_code, [entry]);
  }

  // Open (status 0) pick slips already raised against this source doc. Their qty
  // is subtracted from `remaining` above, so the UI must be able to name them —
  // otherwise a forgotten pick slip just looks like "the system defaulted a wrong
  // (too small) quantity".
  const pendingDocs = await query<{ doc_no: string; doc_date: string | null; qty: string; remark: string | null }>(
    // doc_no has no unique constraint on wms_product_out, so every non-grouped
    // column has to be aggregated.
    `SELECT o.doc_no,
            to_char(MIN(o.doc_date), 'YYYY-MM-DD') AS doc_date,
            SUM(d.qty)::numeric::text AS qty,
            MAX(o.remark) AS remark
     FROM public.wms_product_out o
     JOIN public.wms_product_out_detail d ON d.doc_no = o.doc_no
     WHERE COALESCE(o.status, 0) = 0
       AND COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no) = $1
     GROUP BY o.doc_no
     ORDER BY o.doc_no`,
    [doc],
  );

  // stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ຂອງສາງນີ້ — ໃຫ້ໜ້າຈ່າຍເຕືອນກ່ອນຈ່າຍລົງຕ່ຳກວ່າຂັ້ນຕ່ຳ.
  // Map ຫວ່າງ ເມື່ອສາງບໍ່ໄດ້ເປີດຄຸມ (ບໍ່ມີການເຕືອນ).
  const levels = await minStockLevels(wh, itemCodes);

  const lines = lineRows.map((l) => {
    const lv = levels.get(l.item_code);
    return {
      item_code: l.item_code,
      item_name: l.item_name,
      unit_code: l.unit_code,
      is_isn: l.is_isn,
      src_qty: l.src_qty,
      issued_qty: l.issued_qty,
      pending_qty: l.pending_qty,
      remaining: l.remaining,
      locations: locByItem.get(l.item_code) ?? [],
      // wh_qty = ຄົງເຫຼືອລວມທັງສາງ (ບໍ່ແມ່ນຂອງ bin ໃດ bin ໜຶ່ງ)
      min_stock: lv ? { min_qty: lv.min_qty, max_qty: lv.max_qty, wh_qty: lv.on_hand } : null,
    };
  });

  return NextResponse.json({ doc: headerRows[0], pending_docs: pendingDocs, lines });
}

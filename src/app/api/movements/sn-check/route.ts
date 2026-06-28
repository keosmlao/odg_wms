import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * SN ↔ stock reconciliation for serialized items (ic_inventory.is_isn = 1).
 *
 * Scope: only items genuinely serial-tracked (have ≥1 row in sn_inventory for
 * the warehouse) — the is_isn flag alone is too broad.
 *
 * GET  ?wh=<code>           → every (rack, location, pallet, item) node where the
 *   WMS stock balance (Σ odg_wms_trans_detail.qty·calc_flag) differs from the
 *   in-stock serial count (sn_inventory.status = 0) at that node.
 * GET  ?wh=<code>&item=<c>  → detail for one item: WMS stock distribution
 *   (location → qty) and every in-stock serial with its location, so the
 *   operator can see which ISN sit where (and which are off the WMS location).
 *
 * POST { wh_code, item_code }  → reconcile by RELOCATING the item's serials in
 *   sn_inventory so they sit at the same locations/counts as the WMS stock
 *   (WMS location is the source of truth). Serials already at a target location
 *   stay; only the surplus/mis-located ones move. Stock is never changed.
 */

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

type MismatchRow = {
  rack: string;
  location: string;
  pallet: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  stock_qty: string;
  sn_count: number;
  diff: string;
  pallet_rack: string | null;
  pallet_location: string | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const item = url.searchParams.get("item")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? ""; // item code/name filter (server-side)
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // Detail mode: WMS stock distribution vs serial locations for one item, so the
  // operator can see, per location, the WMS qty and exactly which ISN/SN sit
  // there — and which serials are at a location WMS doesn't have.
  if (item) {
    const [wmsRows, snRows] = await Promise.all([
      query<{ rack: string; location: string; pallet: string; qty: string }>(
        `SELECT COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
                SUM(t.qty * t.calc_flag)::numeric::text       AS qty
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1 AND t.item_code = $2
         GROUP BY 1, 2, 3
         HAVING SUM(t.qty * t.calc_flag) <> 0
         ORDER BY 1, 2, 3`,
        [wh, item],
      ),
      query<{
        roworder: number;
        sn: string | null;
        isn: string | null;
        rack: string;
        location: string;
        pallet: string;
        pallet_rack: string | null;
        pallet_location: string | null;
        pallet_missing: boolean;
      }>(
        // Hierarchy: the serial sits on a pallet, and the pallet's real location
        // is defined in odg_wms_pallet (code → rack/location). pallet_* is where
        // the pallet (hence the serial) should be; pallet_missing = the serial's
        // pallet code isn't registered in odg_wms_pallet.
        `SELECT s.roworder, s.sn, s.isn,
                COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet,
                p.rack     AS pallet_rack,
                p.location AS pallet_location,
                (p.code IS NULL AND COALESCE(NULLIF(TRIM(s.pallet), ''), '') <> '') AS pallet_missing
         FROM public.sn_inventory s
         LEFT JOIN public.odg_wms_pallet p
           ON p.wh_code = s.wh_code AND p.code = NULLIF(TRIM(s.pallet), '')
         WHERE s.wh_code = $1 AND s.item_code = $2 AND COALESCE(s.status, 0) = 0
         ORDER BY s.pallet, s.location, s.sn`,
        [wh, item],
      ),
    ]);
    return NextResponse.json({ wms: wmsRows, serials: snRows });
  }

  const rows = await query<MismatchRow>(
    `WITH sn_items AS (
       -- Only items that are genuinely serial-tracked: they have at least one
       -- serial record in this warehouse. (is_isn alone is too broad — many
       -- flagged items never actually carry serials.) Optional code/name filter.
       SELECT DISTINCT si.item_code
       FROM public.sn_inventory si
       LEFT JOIN public.ic_inventory ici ON ici.code = si.item_code
       WHERE si.wh_code = $1${q ? " AND (si.item_code ILIKE $2 ESCAPE '\\' OR ici.name_1 ILIKE $2 ESCAPE '\\')" : ""}
     ),
     stock AS (
       SELECT COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
              COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
              COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
              t.item_code,
              SUM(t.qty * t.calc_flag) AS qty
       FROM public.odg_wms_trans_detail t
       WHERE t.wh_code = $1
         AND t.item_code IN (SELECT item_code FROM sn_items)
       GROUP BY 1, 2, 3, 4
     ),
     sn AS (
       SELECT COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
              COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
              COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet,
              s.item_code,
              count(*) AS cnt
       FROM public.sn_inventory s
       WHERE COALESCE(s.status, 0) = 0 AND s.wh_code = $1
         AND s.item_code IN (SELECT item_code FROM sn_items)
       GROUP BY 1, 2, 3, 4
     ),
     merged AS (
       SELECT COALESCE(st.rack, sn.rack)         AS rack,
              COALESCE(st.location, sn.location) AS location,
              COALESCE(st.pallet, sn.pallet)     AS pallet,
              COALESCE(st.item_code, sn.item_code) AS item_code,
              COALESCE(st.qty, 0)  AS stock_qty,
              COALESCE(sn.cnt, 0)  AS sn_count
       FROM stock st
       FULL OUTER JOIN sn
         ON st.rack = sn.rack AND st.location = sn.location
        AND st.pallet = sn.pallet AND st.item_code = sn.item_code
     )
     SELECT m.rack, m.location, m.pallet, m.item_code,
            inv.name_1 AS item_name, inv.unit_standard AS unit_code,
            m.stock_qty::numeric::text AS stock_qty,
            m.sn_count::int AS sn_count,
            (m.sn_count - m.stock_qty)::numeric::text AS diff,
            pp.rack     AS pallet_rack,
            pp.location AS pallet_location
     FROM merged m
     LEFT JOIN public.ic_inventory inv ON inv.code = m.item_code
     LEFT JOIN public.odg_wms_pallet pp ON pp.wh_code = $1 AND pp.code = NULLIF(m.pallet, '')
     WHERE m.stock_qty <> m.sn_count
     ORDER BY abs(m.sn_count - m.stock_qty) DESC, m.item_code
     LIMIT 1000`,
    q ? [wh, `%${escapeLike(q)}%`] : [wh],
  );

  // Per-item totals for the flagged items: SML (ERP balance from the SmartBiz
  // function) vs WMS (odg_wms_trans_detail total) vs SN (in-stock serial count).
  // SML is warehouse-level (the ERP doesn't track location), so it's shown per
  // item, not per location.
  const flaggedItems = Array.from(new Set(rows.map((r) => r.item_code)));
  let items: { item_code: string; sml: string; wms_total: string; sn_total: number }[] = [];
  if (flaggedItems.length > 0) {
    const [smlRows, wmsRows, snRows] = await Promise.all([
      query<{ ic_code: string; balance_qty: string }>(
        `SELECT ic_code, balance_qty
         FROM public.sml_ic_function_stock_balance_warehouse('2099-12-31'::date, $1, $2)`,
        [flaggedItems.join(","), wh],
      ).catch(() => [] as { ic_code: string; balance_qty: string }[]),
      query<{ item_code: string; wms: string }>(
        `SELECT item_code, SUM(qty * calc_flag)::numeric::text AS wms
         FROM public.odg_wms_trans_detail
         WHERE wh_code = $1 AND item_code = ANY($2)
         GROUP BY item_code`,
        [wh, flaggedItems],
      ),
      query<{ item_code: string; sn: number }>(
        `SELECT item_code, count(*)::int AS sn
         FROM public.sn_inventory
         WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)
         GROUP BY item_code`,
        [wh, flaggedItems],
      ),
    ]);
    const smlBy = new Map(smlRows.map((r) => [r.ic_code, r.balance_qty]));
    const wmsBy = new Map(wmsRows.map((r) => [r.item_code, r.wms]));
    const snBy = new Map(snRows.map((r) => [r.item_code, r.sn]));
    items = flaggedItems.map((code) => ({
      item_code: code,
      sml: smlBy.get(code) ?? "0",
      wms_total: wmsBy.get(code) ?? "0",
      sn_total: snBy.get(code) ?? 0,
    }));
  }

  const totalDiff = rows.reduce((n, r) => n + Math.abs(Number.parseFloat(r.diff) || 0), 0);
  return NextResponse.json({ rows, items, count: rows.length, total_diff: totalDiff });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  const itemCode = str(body.item_code);
  if (!wh || !itemCode) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const norm = (r: string | null, l: string | null, p: string | null) =>
    `${(r ?? "").trim()}${(l ?? "").trim()}${(p ?? "").trim()}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Optional manual plan: move exactly the chosen serials to the chosen
    // locations; otherwise distribute automatically to match the WMS counts.
    const rawAssign = Array.isArray(body.assignments)
      ? (body.assignments as Array<Record<string, unknown>>)
      : null;
    type Move = {
      roworder: number; sn: string | null; isn: string | null;
      oldRack: string; oldLocation: string; oldPallet: string;
      rack: string; location: string; pallet: string;
    };
    const moves: Move[] = [];
    let serialsCount = 0;
    let unfilled = 0;
    let surplus = 0;

    if (rawAssign && rawAssign.length > 0) {
      const ids = rawAssign.map((a) => Number(a.id)).filter((n) => Number.isFinite(n));
      const rows = await client.query<{ roworder: number; sn: string | null; isn: string | null; rack: string; location: string; pallet: string }>(
        `SELECT s.roworder, s.sn, s.isn,
                COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
                COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet
         FROM public.sn_inventory s
         WHERE s.roworder = ANY($1) AND s.item_code = $2 AND s.wh_code = $3 AND COALESCE(s.status, 0) = 0`,
        [ids, itemCode, wh],
      );
      serialsCount = rows.rows.length;
      if (serialsCount === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "ບໍ່ພົບ serial ທີ່ເລືອກ" }, { status: 400 });
      }
      const byId = new Map(rows.rows.map((r) => [r.roworder, r]));
      for (const a of rawAssign) {
        const s = byId.get(Number(a.id));
        if (!s) continue;
        const nr = str(a.rack), nl = str(a.location), np = str(a.pallet);
        if (norm(s.rack, s.location, s.pallet) === norm(nr, nl, np)) continue;
        moves.push({ roworder: s.roworder, sn: s.sn, isn: s.isn, oldRack: s.rack, oldLocation: s.location, oldPallet: s.pallet, rack: nr, location: nl, pallet: np });
      }
    } else {
    // WMS stock distribution for the item = the target locations the serials
    // should sit at (location is taken from WMS stock — the source of truth).
    const wmsRes = await client.query<{ rack: string; location: string; pallet: string; qty: string }>(
      `SELECT COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
              COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
              COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
              SUM(t.qty * t.calc_flag)::numeric::text       AS qty
       FROM public.odg_wms_trans_detail t
       WHERE t.wh_code = $1 AND t.item_code = $2
       GROUP BY 1, 2, 3
       HAVING SUM(t.qty * t.calc_flag) > 0.0001`,
      [wh, itemCode],
    );
    const targets = wmsRes.rows.map((r) => ({
      rack: r.rack,
      location: r.location,
      pallet: r.pallet,
      need: Math.round(Number.parseFloat(r.qty) || 0),
    }));

    // In-stock serials with their currently-recorded location. Keyed by roworder
    // because serial-tracked items may carry only an ISN (sn column is NULL), so
    // we can't match/UPDATE rows by sn.
    const snRes = await client.query<{ roworder: number; sn: string | null; isn: string | null; rack: string; location: string; pallet: string }>(
      `SELECT s.roworder, s.sn, s.isn,
              COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
              COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
              COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet
       FROM public.sn_inventory s
       WHERE s.wh_code = $1 AND s.item_code = $2 AND COALESCE(s.status, 0) = 0
       ORDER BY s.roworder`,
      [wh, itemCode],
    );
    const serials = snRes.rows.map((s) => ({ ...s, assigned: false }));
    serialsCount = serials.length;

    if (serials.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ສິນຄ້ານີ້ບໍ່ມີ serial ໃນສາງ — ປັບບໍ່ໄດ້" }, { status: 400 });
    }

    // 1) Keep serials already sitting at a target location (no move needed).
    for (const t of targets) {
      const tk = norm(t.rack, t.location, t.pallet);
      for (const s of serials) {
        if (t.need <= 0) break;
        if (!s.assigned && norm(s.rack, s.location, s.pallet) === tk) {
          s.assigned = true;
          t.need -= 1;
        }
      }
    }

    // 2) Fill the remaining deficits from the free (mis-located) serials — these move.
    const free = serials.filter((s) => !s.assigned);
    let fi = 0;
    for (const t of targets) {
      while (t.need > 0 && fi < free.length) {
        const s = free[fi++];
        s.assigned = true;
        t.need -= 1;
        moves.push({
          roworder: s.roworder, sn: s.sn, isn: s.isn,
          oldRack: s.rack, oldLocation: s.location, oldPallet: s.pallet,
          rack: t.rack, location: t.location, pallet: t.pallet,
        });
      }
    }
      unfilled = targets.reduce((n, t) => n + Math.max(0, t.need), 0);
      surplus = free.length - moves.length;
    }

    let docNo: string | null = null;
    if (moves.length > 0) {
      const info = await client.query<{ name_1: string | null }>(
        `SELECT name_1 FROM public.ic_inventory WHERE code = $1`,
        [itemCode],
      );
      const itemName = info.rows[0]?.name_1 ?? null;

      // Serial-ledger transfer doc (trans_flag 72 = ໂອນ): one header + a net-zero
      // pair of detail rows per serial (out of old location, into new location).
      const docRes = await client.query<{ doc_no: string }>(
        `SELECT 'SNMV' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
                lpad(nextval('public.sn_trans_roworder_seq')::text, 5, '0') AS doc_no`,
      );
      docNo = docRes.rows[0].doc_no;

      await client.query(
        `INSERT INTO public.sn_trans
           (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_format_code, wh_code)
         VALUES (72, $1, CURRENT_DATE, $2, 0, $3, 'SNMV', $4)`,
        [docNo, session.employee_code, moves.length, wh],
      );

      for (const m of moves) {
        // Ledger serial id: prefer sn, fall back to isn (ISN-only items).
        const snId = m.sn ?? m.isn;
        // out of the old location (-1)
        await client.query(
          `INSERT INTO public.sn_trans_detail
             (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse,
              item_name, doc_ref, calc_flag, rack, location, pallet, isn)
           VALUES (72, $1, CURRENT_DATE, $2, $3, $4, 1, $5, $6, 'sn-relocate', -1, $7, $8, $9, $10)`,
          [docNo, session.employee_code, itemCode, snId, wh, itemName, m.oldRack || null, m.oldLocation || null, m.oldPallet || null, m.isn],
        );
        // into the new (WMS) location (+1)
        await client.query(
          `INSERT INTO public.sn_trans_detail
             (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse,
              item_name, doc_ref, calc_flag, rack, location, pallet, isn)
           VALUES (72, $1, CURRENT_DATE, $2, $3, $4, 1, $5, $6, 'sn-relocate', 1, $7, $8, $9, $10)`,
          [docNo, session.employee_code, itemCode, snId, wh, itemName, m.rack || null, m.location || null, m.pallet || null, m.isn],
        );
        // move the serial stock record itself — keyed by roworder (sn may be NULL).
        await client.query(
          `UPDATE public.sn_inventory
             SET rack = $1, location = $2, pallet = $3, user_mapping = $4
           WHERE roworder = $5`,
          [m.rack || null, m.location || null, m.pallet || null, session.employee_code, m.roworder],
        );
      }
    }

    await client.query("COMMIT");

    return NextResponse.json({
      ok: true,
      doc_no: docNo, // SNMV… serial-transfer doc in sn_trans / sn_trans_detail
      moved: moves.length,
      serials: serialsCount,
      unfilled, // locations still short of serials (WMS qty > serial count)
      surplus, // serials with nowhere to go (serial count > WMS qty)
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * DELETE ?doc=SNMV…  → undo a serial-relocation document: put each serial back
 * to its original location (the calc_flag -1 rows) and remove the sn_trans /
 * sn_trans_detail records.
 */
export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const doc = new URL(request.url).searchParams.get("doc")?.trim() ?? "";
  if (!doc) return NextResponse.json({ error: "ບໍ່ມີເລກເອກະສານ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query<{ wh_code: string | null }>(
      `SELECT wh_code FROM public.sn_trans WHERE doc_no = $1 AND doc_format_code = 'SNMV'`,
      [doc],
    );
    if (hdr.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບໃບຍ້າຍ SN ນີ້" }, { status: 404 });
    }
    const wh = hdr.rows[0].wh_code ?? "";
    if (!wh) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບนี้ບໍ່ມີຂໍ້ມູນສາງ — undo ບໍ່ໄດ້" }, { status: 400 });
    }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && wh && !accessible.includes(wh)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }

    // The -1 rows carry each serial's ORIGINAL location → restore it.
    const fromRows = await client.query<{ item_code: string | null; sn: string | null; isn: string | null; rack: string | null; location: string | null; pallet: string | null }>(
      `SELECT item_code, sn, isn, rack, location, pallet
       FROM public.sn_trans_detail WHERE doc_no = $1 AND calc_flag < 0`,
      [doc],
    );
    let restored = 0;
    for (const r of fromRows.rows) {
      const useIsn = !!r.isn;
      const idVal = useIsn ? r.isn : r.sn;
      if (!r.item_code || !idVal) continue;
      const res = await client.query(
        `UPDATE public.sn_inventory
           SET rack = $1, location = $2, pallet = $3, user_mapping = $4
         WHERE wh_code = $5 AND item_code = $6 AND ${useIsn ? "isn" : "sn"} = $7 AND COALESCE(status, 0) = 0`,
        [r.rack, r.location, r.pallet, session.employee_code, wh, r.item_code, idVal],
      );
      restored += res.rowCount ?? 0;
    }

    await client.query(`DELETE FROM public.sn_trans_detail WHERE doc_no = $1`, [doc]);
    await client.query(`DELETE FROM public.sn_trans WHERE doc_no = $1 AND doc_format_code = 'SNMV'`, [doc]);

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: doc, restored });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

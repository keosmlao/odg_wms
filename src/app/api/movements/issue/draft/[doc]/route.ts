import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { type IssueLine, executeIssue } from "@/lib/issueCore";
import { saveMoveNotes } from "@/lib/moveReasons";
import { appendScanLog, stampIssueDoc } from "@/lib/pickScanLog";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";
import { getSnDualBrands } from "@/lib/snDualBrand";

const SRC_TYPE: Record<number, string> = { 122: "req", 124: "transfer", 44: "sale" };

type DraftHeader = { doc_no: string; warehouse_code: string | null; ref_doc_no: string | null; doc_type: number | null; status: number | null };
type DetailRow = {
  roworder: number; item_code: string; item_name: string | null; unit_code: string | null;
  qty: string; shelf_code: string | null; box_code: string | null;
  /** ບິນຕົ້ນທາງຂອງແຖວ — ມີສະເພາະໃບທີ່ດຶງມາຈາກໃບຈັດຖ້ຽວ (1 ໃບ ຫຼາຍບິນ).
   *  NULL = ໃບແບບເກົ່າ (1 ໃບ 1 ບິນ) → ໃຊ້ header.ref_doc_no. */
  ref_doc_no: string | null;
};

function parseNode(shelf: string | null): { rack: string; location: string; pallet: string } {
  const [rack = "", location = "", pallet = ""] = (shelf ?? "").split("|");
  return { rack, location, pallet };
}
/** shelf_code packs the whole node; box_code keeps the readable location. */
function packNode(n: { rack: string; location: string; pallet: string }): string {
  return `${n.rack}|${n.location}|${n.pallet}`;
}

async function loadDraft(docNo: string) {
  const hdr = await query<DraftHeader>(
    `SELECT doc_no, warehouse_code, ref_doc_no, doc_type, status FROM public.wms_product_out WHERE doc_no = $1 LIMIT 1`,
    [docNo],
  );
  if (hdr.length === 0) return null;
  const lines = await query<DetailRow>(
    `SELECT roworder, item_code, item_name, unit_code, qty::text AS qty, shelf_code, box_code, ref_doc_no
     FROM public.wms_product_out_detail WHERE doc_no = $1 ORDER BY roworder`,
    [docNo],
  );
  const serials = await query<{ item_code: string; serial_number: string }>(
    `SELECT item_code, serial_number FROM public.wms_product_out_serial_detail WHERE ref_out_doc = $1 ORDER BY serial_number`,
    [docNo],
  );
  return { header: hdr[0], lines, serials };
}

/**
 * GET — draft detail for the confirm/scan screen. Per line it returns the planned
 * node, the pre-allocated serials, `loc_options` (every bin in this warehouse that
 * still holds the item — the operator may re-point the line to the bin they could
 * actually reach) and `units` (every scannable unit of the item in the warehouse,
 * each tagged with its node so the client can narrow them to the chosen bin).
 */
export async function GET(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;
  const draft = await loadDraft(decodeURIComponent(doc).trim());
  if (!draft) return NextResponse.json({ error: "ບໍ່ພົບໃບ pending" }, { status: 404 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && draft.header.warehouse_code && !accessible.includes(draft.header.warehouse_code)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }
  const serialsByItem: Record<string, string[]> = {};
  for (const s of draft.serials) (serialsByItem[s.item_code] ??= []).push(s.serial_number);

  // In-stock serials of the doc's items in this warehouse — valid targets to scan
  // (incl. substitutes not in the pending plan). Filtered per line by node below.
  const wh = draft.header.warehouse_code ?? "";
  const items = Array.from(new Set(draft.lines.map((l) => l.item_code)));
  // A unit can be scanned by EITHER its factory serial (sn) or this company's
  // own serial (isn) — expose both as separately-scannable ids, not just one.
  const avail = items.length > 0
    ? await query<{ item_code: string; sn: string | null; isn: string | null; rack: string; location: string; pallet: string }>(
        `SELECT item_code, NULLIF(TRIM(sn), '') AS sn, NULLIF(TRIM(isn), '') AS isn,
                COALESCE(NULLIF(TRIM(rack), ''), '') AS rack,
                COALESCE(NULLIF(TRIM(location), ''), '') AS location,
                COALESCE(NULLIF(TRIM(pallet), ''), '') AS pallet
         FROM public.sn_inventory
         WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)
           AND (NULLIF(TRIM(sn), '') IS NOT NULL OR NULLIF(TRIM(isn), '') IS NOT NULL)`,
        [wh, items],
      )
    : [];

  // Whether an item needs its SN scanned at confirm is decided by the ACTUAL
  // serial-tracked stock (items that have scannable units in sn_inventory),
  // gated by the warehouse's issue-SN policy — NOT by whatever the pick slip
  // happened to pre-select. This lets a location-only pick (sn_issue_pick off)
  // still be forced to scan the serial here.
  const snIssueOn = await warehouseSnEnabled(wh, "issue");
  const trackedItems = new Set(avail.map((a) => a.item_code));

  // Every node in this warehouse that still holds each item, so the confirm screen
  // can RE-POINT a line to where the goods were actually taken from (the planned
  // bin may be blocked/unreachable when the forklift gets there).
  //   · no `status` filter — status=1 is the outbound leg of a bin relocation, not
  //     a void; excluding it leaves emptied bins looking full (same as the balance page).
  //   · FIFO order, matching how the pick screen suggests locations.
  const locRows = items.length > 0
    ? await query<{ item_code: string; rack: string; location: string; pallet: string; qty: string }>(
        `SELECT t.item_code,
                COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet,
                SUM(t.qty * t.calc_flag)::text AS qty
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1 AND t.item_code = ANY($2)
         GROUP BY t.item_code, rack, location, pallet
         HAVING SUM(t.qty * t.calc_flag) > 0.0001
         ORDER BY t.item_code, MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) ASC NULLS LAST, SUM(t.qty * t.calc_flag) DESC`,
        [wh, items],
      )
    : [];
  const snCountByNode = new Map<string, number>();
  for (const a of avail) {
    const k = `${a.item_code}|${a.rack}|${a.location}|${a.pallet}`;
    snCountByNode.set(k, (snCountByNode.get(k) ?? 0) + 1);
  }

  // Items whose brand requires BOTH sn and isn (SAMSUNG etc.) — so the confirm
  // screen can flag a scanned unit that is missing one of the two.
  const dualBrands = await getSnDualBrands();
  const dualItems = new Set<string>();
  if (dualBrands.length > 0 && items.length > 0) {
    const br = await query<{ code: string }>(
      `SELECT code FROM public.ic_inventory WHERE code = ANY($1) AND item_brand = ANY($2)`,
      [items, dualBrands],
    );
    for (const r of br) dualItems.add(r.code);
  }

  return NextResponse.json({
    header: draft.header,
    source_type: SRC_TYPE[draft.header.doc_type ?? 0] ?? "",
    lines: draft.lines.map((l) => {
      const node = parseNode(l.shelf_code);
      // ALL scannable units of the item in this warehouse, each tagged with its
      // node — the client narrows them to whichever location the line currently
      // points at, so re-pointing a line also re-points its valid serials.
      const units = avail
        .filter((a) => a.item_code === l.item_code)
        .map((a) => ({ sn: a.sn, isn: a.isn, rack: a.rack, location: a.location, pallet: a.pallet }));
      const loc_options = locRows
        .filter((o) => o.item_code === l.item_code)
        .map((o) => ({
          rack: o.rack,
          location: o.location,
          pallet: o.pallet,
          qty: o.qty,
          sn_qty: snCountByNode.get(`${o.item_code}|${o.rack}|${o.location}|${o.pallet}`) ?? 0,
        }));
      const serial_required = snIssueOn && trackedItems.has(l.item_code);
      // ref_doc_no = ບິນຕົ້ນທາງຂອງແຖວ (ໃບຖ້ຽວ: 1 ໃບ ຫຼາຍບິນ) — ໃຫ້ໜ້າຢືນຢັນສະແດງໄດ້
      return { roworder: l.roworder, item_code: l.item_code, item_name: l.item_name, unit_code: l.unit_code, qty: l.qty, ...node, ref_doc_no: l.ref_doc_no, serials: serialsByItem[l.item_code] ?? [], units, loc_options, serial_required, dual_required: dualItems.has(l.item_code) };
    }),
  });
}

/** DELETE — cancel a pending draft (remove its rows). */
export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query<{ warehouse_code: string | null; status: number | null }>(
      `SELECT warehouse_code, status FROM public.wms_product_out WHERE doc_no = $1 LIMIT 1`,
      [docNo],
    );
    if (hdr.rows.length === 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບ pending" }, { status: 404 }); }
    if ((hdr.rows[0].status ?? 0) !== 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບนี้ບໍ່ແມ່ນ pending (ອາจຢືນຢັນแล้ว)" }, { status: 400 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && hdr.rows[0].warehouse_code && !accessible.includes(hdr.rows[0].warehouse_code)) {
      await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    await client.query(`DELETE FROM public.wms_product_out_serial_detail WHERE ref_out_doc = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_out_detail WHERE doc_no = $1`, [docNo]);
    await client.query(`DELETE FROM public.wms_product_out WHERE doc_no = $1`, [docNo]);
    // ໃບທີ່ດຶງມາຈາກໃບຈັດຖ້ຽວ — ຕັດການຜູກກັບຖ້ຽວອອກນຳ ບໍ່ດັ່ງນັ້ນຖ້ຽວຈະຄ້າງ
    // ນັບວ່າ "ມີໃບ pick ແລ້ວ" ທັງທີ່ໃບຖືກລົບໄປແລ້ວ.
    await client.query(`DELETE FROM public.wms_pick_trip WHERE doc_no = $1`, [docNo]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/** PATCH — edit a pending pick before confirm: remove one item from it. If it was
 *  the last item, the whole draft is cancelled. Only while status 0. */
export async function PATCH(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();
  let body: { remove_item?: unknown };
  try { body = (await request.json()) as { remove_item?: unknown }; } catch { body = {}; }
  const removeItem = typeof body.remove_item === "string" ? body.remove_item.trim() : "";
  if (!removeItem) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ລົບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = (await client.query<{ warehouse_code: string | null; status: number | null }>(
      `SELECT warehouse_code, status FROM public.wms_product_out WHERE doc_no = $1 FOR UPDATE`, [docNo],
    )).rows[0];
    if (!hdr) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບ pick" }, { status: 404 }); }
    if ((hdr.status ?? 0) !== 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບนี้ ຢືນຢັນไปแล้ว" }, { status: 400 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && hdr.warehouse_code && !accessible.includes(hdr.warehouse_code)) {
      await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າเຖິງສาງนี้" }, { status: 403 });
    }
    await client.query(`DELETE FROM public.wms_product_out_serial_detail WHERE ref_out_doc = $1 AND item_code = $2`, [docNo, removeItem]);
    await client.query(`DELETE FROM public.wms_product_out_detail WHERE doc_no = $1 AND item_code = $2`, [docNo, removeItem]);
    const left = (await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.wms_product_out_detail WHERE doc_no = $1`, [docNo])).rows[0];
    const emptied = (Number.parseInt(left?.n ?? "0", 10) || 0) === 0;
    if (emptied) {
      await client.query(`DELETE FROM public.wms_product_out WHERE doc_no = $1`, [docNo]);
      await client.query(`DELETE FROM public.wms_pick_trip WHERE doc_no = $1`, [docNo]);
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo, emptied });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * POST — confirm by scan → finalize the issue (WMS + serial + ERP) and mark posted.
 *
 * Body may carry `moves`: [{ roworder, rack, location, pallet }] — the picker took
 * the goods from a different bin than the slip planned (blocked aisle, pallet
 * buried, …). Those lines are re-pointed on `wms_product_out_detail` FIRST, so the
 * saved pick slip, the stock deduction and any un-issued remainder all record the
 * bin the goods actually came from.
 */
export async function POST(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  const { doc } = await ctx.params;
  const docNo = decodeURIComponent(doc).trim();

  let body: { scanned?: unknown; notes?: unknown; moves?: unknown };
  try { body = (await request.json()) as { scanned?: unknown; notes?: unknown; moves?: unknown }; } catch { body = {}; }
  const scanned = new Set(
    Array.isArray(body.scanned) ? (body.scanned as unknown[]).map((s) => String(s).trim().toUpperCase()).filter(Boolean) : [],
  );
  // Location overrides, keyed by the detail row's primary key.
  const moves: { roworder: number; rack: string; location: string; pallet: string }[] = [];
  if (Array.isArray(body.moves)) {
    for (const m of body.moves as Record<string, unknown>[]) {
      const roworder = Number.parseInt(String(m.roworder ?? ""), 10);
      if (!Number.isFinite(roworder)) continue;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      moves.push({ roworder, rack: str(m.rack), location: str(m.location), pallet: str(m.pallet) });
    }
  }
  // Short-pick reasons per item (forklift couldn't find the full qty).
  const reasonByItem = new Map<string, string>();
  if (Array.isArray(body.notes)) {
    for (const n of body.notes as Record<string, unknown>[]) {
      const ic = typeof n.item_code === "string" ? n.item_code.trim() : "";
      const rc = typeof n.reason_code === "string" ? n.reason_code.trim() : "";
      if (ic && rc) reasonByItem.set(ic, rc);
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = (
      await client.query<DraftHeader>(
        `SELECT doc_no, warehouse_code, ref_doc_no, doc_type, status FROM public.wms_product_out WHERE doc_no = $1 FOR UPDATE`,
        [docNo],
      )
    ).rows[0];
    if (!hdr) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບ pending" }, { status: 404 }); }
    if ((hdr.status ?? 0) !== 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບนี้ ຢືນຢັນไปแล้ว" }, { status: 400 }); }
    const wh = hdr.warehouse_code ?? "";
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && (!wh || !accessible.includes(wh))) {
      await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }

    // Re-point moved lines BEFORE anything reads the detail, so the pick slip on
    // record, the stock deduction and the un-issued remainder all agree on the bin
    // the goods actually came from. `roworder` is the detail table's primary key;
    // scoping the UPDATE by doc_no too keeps a stale/forged roworder harmless.
    let movedRows = 0;
    for (const m of moves) {
      const res = await client.query(
        `UPDATE public.wms_product_out_detail
            SET shelf_code = $3, box_code = $4, last_update_datetime = now()
          WHERE doc_no = $1 AND roworder = $2 AND shelf_code IS DISTINCT FROM $3`,
        [docNo, m.roworder, packNode(m), m.location || null],
      );
      movedRows += res.rowCount ?? 0;
    }

    const detail = (
      await client.query<DetailRow>(
        `SELECT roworder, item_code, item_name, unit_code, qty::text AS qty, shelf_code, box_code, ref_doc_no FROM public.wms_product_out_detail WHERE doc_no = $1 ORDER BY roworder`,
        [docNo],
      )
    ).rows;
    /** ບິນຕົ້ນທາງຂອງແຖວ: ໃບຖ້ຽວເກັບໄວ້ລະດັບແຖວ, ໃບເກົ່າໃຊ້ ref ຂອງ header. */
    const billOf = (d: DetailRow) => (d.ref_doc_no?.trim() || hdr.ref_doc_no || "");
    // A move can collapse two split rows of one item onto the same bin. The
    // deduction would still be right, but the remainder-collapse below keys on
    // (ບິນ, item) and would lose a node — reject it with a clear message instead.
    // ໃບຖ້ຽວ: ສິນຄ້າດຽວກັນ ບ່ອນດຽວກັນ ແຕ່ຄົນລະບິນ = ຄົນລະແຖວ ຈຶ່ງບໍ່ຖືວ່າຊ້ຳ.
    const nodeSeen = new Set<string>();
    for (const d of detail) {
      const k = `${billOf(d)}@${d.item_code}@${d.shelf_code ?? ""}`;
      if (nodeSeen.has(k)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${d.item_code}: ມີ 2 ແຖວຢູ່ບ່ອນຈັດເກັບດຽວກັນ — ກະລຸນາເລືອກ location ຕ່າງກັນ` }, { status: 400 });
      }
      nodeSeen.add(k);
    }
    // Items that must be issued by serial = those actually serial-tracked in this
    // warehouse (have scannable units in sn_inventory), gated by the issue-SN
    // policy — NOT the pick's pre-selected serials. So a location-only pick
    // (sn_issue_pick off) is still forced to scan the SN here at confirm.
    const snIssueOn = await warehouseSnEnabled(wh, "issue", client);
    const docItemCodes = Array.from(new Set(detail.map((d) => d.item_code)));
    const serialItems = new Set<string>();
    if (snIssueOn && docItemCodes.length > 0) {
      const tracked = await client.query<{ item_code: string }>(
        `SELECT DISTINCT item_code FROM public.sn_inventory
         WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)
           AND (NULLIF(TRIM(sn), '') IS NOT NULL OR NULLIF(TRIM(isn), '') IS NOT NULL)`,
        [wh, docItemCodes],
      );
      for (const r of tracked.rows) serialItems.add(r.item_code);
    }

    // Resolve the ACTUAL scanned serials against in-stock (substitute allowed):
    // each scanned serial must be a real in-stock serial of one of the doc's items.
    // A unit may be scanned by EITHER its factory serial (sn) or this company's
    // own serial (isn) — match whichever the caller supplied, not just one column.
    const scannedArr = [...scanned];
    const scannedRows = scannedArr.length > 0
      ? (await client.query<{ item_code: string; sn: string | null; isn: string | null }>(
          `SELECT item_code, NULLIF(TRIM(sn), '') AS sn, NULLIF(TRIM(isn), '') AS isn
           FROM public.sn_inventory
           WHERE wh_code = $1 AND COALESCE(status, 0) = 0
             AND (upper(TRIM(sn)) = ANY($2) OR upper(TRIM(isn)) = ANY($2))`,
          [wh, scannedArr],
        )).rows
      : [];
    // Map each scanned string (uppercased) to its item + the raw (original-case)
    // id that matched, so downstream matching against sn_inventory stays exact.
    const validById = new Map<string, string>();
    const rawById = new Map<string, string>();
    for (const row of scannedRows) {
      if (row.sn && scanned.has(row.sn.toUpperCase())) { validById.set(row.sn.toUpperCase(), row.item_code); rawById.set(row.sn.toUpperCase(), row.sn); }
      if (row.isn && scanned.has(row.isn.toUpperCase())) { validById.set(row.isn.toUpperCase(), row.item_code); rawById.set(row.isn.toUpperCase(), row.isn); }
    }
    const docItems = new Set(detail.map((d) => d.item_code));
    const badScan = scannedArr.filter((s) => !validById.has(s) || !docItems.has(validById.get(s)!));
    if (badScan.length > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `ISN ບໍ່ຖືກຕ້ອງ / ບໍ່ມີໃນ stock ຫຼື ບໍ່ແມ່ນຂອງໃບนี้: ${badScan.join(", ")}` }, { status: 400 });
    }
    // Group actual scanned serials per item.
    const scannedByItem: Record<string, string[]> = {};
    for (const s of scannedArr) {
      const item = validById.get(s);
      if (item) (scannedByItem[item] ??= []).push(rawById.get(s) ?? s);
    }

    // Each serial item must be scanned exactly to its planned qty.
    const plannedByItem: Record<string, number> = {};
    for (const d of detail) plannedByItem[d.item_code] = (plannedByItem[d.item_code] ?? 0) + (Number.parseFloat(d.qty) || 0);
    const shortNotes: { item_code: string; reason_code: string; short_qty: number }[] = [];
    for (const item of serialItems) {
      const got = scannedByItem[item]?.length ?? 0;
      const need = Math.round(plannedByItem[item] ?? 0);
      if (got > need) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${item}: ຍິງ ${got} ເກີນ ${need}` }, { status: 400 });
      }
      if (got < need) {
        // Short pick allowed ONLY with a reason (ของหาย/ชำรุด/ฯลฯ).
        const reason = reasonByItem.get(item);
        if (!reason) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: `ສິນຄ້າ ${item}: ຍິງ ${got} / ${need} — ບໍ່ຄົບ ຕ້ອງເລືອກເຫດผล` }, { status: 400 });
        }
        shortNotes.push({ item_code: item, reason_code: reason, short_qty: need - got });
      }
    }

    // Issued per item (captured BEFORE line-building splices scannedByItem):
    // serial item → scanned count; non-serial → full planned qty.
    const issuedByItem: Record<string, number> = {};
    for (const item of new Set(detail.map((d) => d.item_code))) {
      issuedByItem[item] = serialItems.has(item) ? (scannedByItem[item]?.length ?? 0) : Math.round(plannedByItem[item] ?? 0);
    }

    // Build issue lines from the ACTUAL scanned serials (substitute = the physical truth).
    // ແຕ່ລະແຖວຖືກຜູກກັບ "ບິນຕົ້ນທາງ" ຂອງມັນ (ໃບຖ້ຽວ = ຫຼາຍບິນໃນໃບດຽວ).
    const lineByBill = new Map<string, IssueLine[]>();
    const lines: IssueLine[] = detail.map((d) => {
      const node = parseNode(d.shelf_code);
      const qty = Number.parseFloat(d.qty) || 0;
      const line: IssueLine = serialItems.has(d.item_code)
        ? (() => {
            const take = (scannedByItem[d.item_code] ??= []).splice(0, Math.round(qty));
            return { item_code: d.item_code, item_name: d.item_name, unit_code: d.unit_code ?? "", qty: take.length, serials: take, rack: node.rack, location: node.location, pallet: node.pallet };
          })()
        : { item_code: d.item_code, item_name: d.item_name, unit_code: d.unit_code ?? "", qty, serials: [], rack: node.rack, location: node.location, pallet: node.pallet };
      const bill = billOf(d);
      const arr = lineByBill.get(bill);
      if (arr) arr.push(line);
      else lineByBill.set(bill, [line]);
      return line;
    });

    // ໜຶ່ງບິນ = ໜຶ່ງໃບຈ່າຍ ERP. ໃບປົກກະຕິມີກຸ່ມດຽວ (ref ຂອງ header) ຈຶ່ງເປັນ
    // ພຶດຕິກຳເກົ່າທຸກປະການ; ໃບຖ້ຽວຈະ post ຫຼາຍໃບພາຍໃນ transaction ດຽວ.
    const sourceType = SRC_TYPE[hdr.doc_type ?? 0] ?? "";
    // ໃບນີ້ມາຈາກໃບຈັດຖ້ຽວບໍ່? (ໃຊ້ຜູກ DP ທີ່ post ອອກ ກັບຖ້ຽວ ສຳລັບປະຫວັດ)
    const tripNo = (
      await client.query<{ trip_doc_no: string }>(
        `SELECT trip_doc_no FROM public.wms_pick_trip WHERE doc_no = $1 LIMIT 1`,
        [docNo],
      )
    ).rows[0]?.trip_doc_no ?? null;
    const results: { issueCode: string; erpDoc: string | null; serials: number }[] = [];
    for (const [bill, billLines] of [...lineByBill.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const posted = billLines.filter((l) => l.qty > 0);
      if (posted.length === 0) continue;
      const res = await executeIssue(client, {
        wh, docRef: bill || hdr.ref_doc_no, sourceType,
        location: posted[0]?.location ?? null, user: session.employee_code, lines: posted,
      });
      results.push(res);
      if (tripNo) {
        await client.query(
          `INSERT INTO public.wms_pick_trip_issue (issue_doc, trip_doc_no, pick_doc, bill_no, wh_code)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (issue_doc) DO NOTHING`,
          [res.issueCode, tripNo, docNo, bill || null, wh],
        );
      }
    }
    if (results.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີຈຳນວນໃຫ້ຈ່າຍ (ຍິງ SN ບໍ່ໄດ້ເລີຍ)" }, { status: 400 });
    }
    const result = {
      issueCode: results.map((r) => r.issueCode).join(", "),
      erpDoc: results.map((r) => r.erpDoc).filter(Boolean).join(", ") || null,
      serials: results.reduce((s, r) => s + r.serials, 0),
    };

    // Record short-pick reasons (best-effort).
    if (shortNotes.length > 0) {
      await saveMoveNotes(client, { docNo: results[0].issueCode, refDoc: hdr.ref_doc_no, stage: "issue", user: session.employee_code ?? null, notes: shortNotes });
    }

    // Close the audit trail: record what was actually issued per line and tie the
    // whole trail to the DP doc, so it stays findable once this pick slip is gone.
    // Best-effort — a logging failure must not roll back a posted issue.
    await appendScanLog(
      {
        docNo, refDoc: hdr.ref_doc_no, wh, user: session.employee_code ?? null,
        events: [
          ...lines.filter((l) => l.qty > 0).map((l) => ({
            event: "confirm" as const,
            result: "ok",
            item_code: l.item_code,
            rack: l.rack, location: l.location, pallet: l.pallet,
            qty: l.qty,
            note: `ຈ່າຍອອກ · ${l.serials.length} SN`,
          })),
          ...shortNotes.map((n) => ({
            event: "confirm" as const,
            result: "short",
            item_code: n.item_code,
            qty: n.short_qty,
            note: `ຈ່າຍບໍ່ຄົບ · ເຫດຜົນ ${n.reason_code}`,
          })),
        ],
      },
      client,
    );
    // issue_doc ເປັນ varchar(40) — ໃບຖ້ຽວ post ຫຼາຍ DP, ຈຶ່ງໝາຍໃບທຳອິດໄວ້
    // (ໃບອື່ນຕິດຕາມຜ່ານ doc_ref ຂອງແຕ່ລະບິນຢູ່ ledger ຢູ່ແລ້ວ).
    await stampIssueDoc(client, docNo, results[0].issueCode);

    // Reduce the pending to the UN-issued remainder. Items fully issued are removed;
    // partially-issued (serial short) keep their remaining qty/serials so the rest
    // can still be issued from pending. Only when nothing is left → status 1 (done).
    // ນັບເປັນ (ບິນ, ສິນຄ້າ) — ໃບຖ້ຽວມີສິນຄ້າດຽວກັນຂອງຫຼາຍບິນຢູ່ໃບດຽວ, ຖ້າ
    // ຮວບເປັນ item ຢ່າງດຽວ ສ່ວນທີ່ຍັງເຫຼືອຈະຫຼົງບິນ.
    const bikey = (bill: string, item: string) => `${bill} ${item}`;
    const plannedByBillItem = new Map<string, number>();
    for (const d of detail) {
      const k = bikey(billOf(d), d.item_code);
      plannedByBillItem.set(k, (plannedByBillItem.get(k) ?? 0) + (Number.parseFloat(d.qty) || 0));
    }
    const issuedByBillItem = new Map<string, number>();
    for (const [bill, arr] of lineByBill) {
      for (const l of arr) {
        const k = bikey(bill, l.item_code);
        issuedByBillItem.set(k, (issuedByBillItem.get(k) ?? 0) + l.qty);
      }
    }

    let anyRemaining = false;
    const keepRows: { bill: string; item: string; qty: number }[] = [];
    const remainByItem = new Map<string, number>();
    for (const [k, planned] of plannedByBillItem) {
      const [bill, item] = k.split(" ");
      const remaining = Math.round(planned) - (issuedByBillItem.get(k) ?? 0);
      if (remaining > 1e-6) {
        anyRemaining = true;
        keepRows.push({ bill, item, qty: remaining });
        remainByItem.set(item, (remainByItem.get(item) ?? 0) + remaining);
      }
    }

    // ສ້າງແຖວທີ່ຍັງເຫຼືອຄືນໃໝ່ (1 ແຖວ / 1 ບິນ / 1 ສິນຄ້າ, ຖື node ທຳອິດໄວ້).
    await client.query(`DELETE FROM public.wms_product_out_detail WHERE doc_no = $1`, [docNo]);
    for (const r of keepRows) {
      const first = detail.find((d) => billOf(d) === r.bill && d.item_code === r.item)!;
      await client.query(
        `INSERT INTO public.wms_product_out_detail (doc_no, doc_date, item_code, item_name, unit_code, qty, shelf_code, box_code, ref_doc_no, create_date_time_now)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, now())`,
        [docNo, r.item, first.item_name, first.unit_code ?? null, r.qty, first.shelf_code, first.box_code, first.ref_doc_no],
      );
    }

    // Serial ທີ່ຈອງໄວ້: ເກັບໄວ້ເທົ່າຈຳນວນທີ່ຍັງເຫຼືອຂອງສິນຄ້ານັ້ນ (ລວມທຸກບິນ).
    for (const item of new Set(detail.map((d) => d.item_code))) {
      const keep = Math.round(remainByItem.get(item) ?? 0);
      if (keep <= 0) {
        await client.query(`DELETE FROM public.wms_product_out_serial_detail WHERE ref_out_doc = $1 AND item_code = $2`, [docNo, item]);
      } else if (serialItems.has(item)) {
        await client.query(
          `DELETE FROM public.wms_product_out_serial_detail
           WHERE ref_out_doc = $1 AND item_code = $2
             AND serial_number NOT IN (
               SELECT serial_number FROM public.wms_product_out_serial_detail
               WHERE ref_out_doc = $1 AND item_code = $2 ORDER BY serial_number LIMIT $3)`,
          [docNo, item, keep],
        );
      }
    }
    await client.query(
      `UPDATE public.wms_product_out SET status = $2, last_update_datetime = now() WHERE doc_no = $1`,
      [docNo, anyRemaining ? 0 : 1],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, pending_code: docNo, issue_code: result.issueCode, erp_doc: result.erpDoc, serials: result.serials, partial: anyRemaining, moved: movedRows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  DOC_TYPE, RECEIVE_STATUS, SN_RECEIPT_FLAG, genDocNo,
  insertTransHeader, insertTransDetail,
} from "@/lib/receive";
import { postErpPurchaseReceipt } from "@/lib/erpPost";
import { lockDoc } from "@/lib/binLock";

/**
 * Turn a count sheet (ໃບກວດນັບ, status=9) into a posted WMS goods-receipt.
 * Body: { rack?, location, pallet?, remark? }. In one transaction it:
 *   1. re-validates counted qty ≤ remaining
 *   2. creates a receipt wms_product_receive (RC…, status=0) + detail + ref(PO, CK)
 *   3. posts stock (odg_wms_trans + _detail, +1)
 *   4. commits the count sheet's reserved serials (wms_product_receive_serial_detail)
 *      to the ledger (sn_trans + _detail + sn_inventory, trans_flag 81)
 *   5. flips the count sheet status 9 → consumed (5)
 */
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { doc } = await ctx.params;
  const countNo = decodeURIComponent(doc).trim();

  type LocIn = { item_code?: unknown; rack?: unknown; location?: unknown; pallet?: unknown; received?: unknown; serials?: unknown; cancelSerials?: unknown };
  let body: { rack?: unknown; location?: unknown; pallet?: unknown; remark?: unknown; lines?: unknown };
  try { body = (await request.json()) as typeof body; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }
  const remark = str(body.remark);
  // Per-line destinations (item-by-item mode). When absent, fall back to one
  // destination for the whole sheet (all-at-once mode).
  const fallback = { rack: str(body.rack), location: str(body.location), pallet: str(body.pallet) };
  const locByItem = new Map<string, { rack: string; location: string; pallet: string }>();
  // Actual received qty per item (partial arrival). Absent → receive the full
  // counted qty. The surplus (counted − received) serials are voided below so
  // the ISN running sequence stays continuous without ever reusing a number.
  const receivedByItem = new Map<string, number>();
  // Explicit serial choice for a partial line: exactly which reserved serials
  // arrived. When present it overrides the "first N" rule — those are committed
  // as stock, the rest are held. Absent → fall back to received-count + first N.
  const receivedSerialsByItem = new Map<string, string[]>();
  // Serials the user explicitly cancelled/scrapped (won't be reused later).
  const cancelledSerialsByItem = new Map<string, string[]>();
  if (Array.isArray(body.lines)) {
    for (const l of body.lines as LocIn[]) {
      const ic = str(l.item_code);
      if (!ic) continue;
      locByItem.set(ic, { rack: str(l.rack), location: str(l.location), pallet: str(l.pallet) });
      const r = typeof l.received === "number" ? l.received : Number.parseFloat(String(l.received ?? ""));
      if (Number.isFinite(r) && r >= 0) receivedByItem.set(ic, r);
      if (Array.isArray(l.serials)) {
        const arr = (l.serials as unknown[]).map((s) => str(s)).filter(Boolean);
        receivedSerialsByItem.set(ic, arr);
      }
      if (Array.isArray(l.cancelSerials)) {
        const arr = (l.cancelSerials as unknown[]).map((s) => str(s)).filter(Boolean);
        cancelledSerialsByItem.set(ic, arr);
      }
    }
  }
  // A destination = a location OR a pallet. Each line must have one (per-line or fallback).
  const destFor = (item: string) => {
    const d = locByItem.get(item);
    const rack = d?.rack || fallback.rack;
    const location = d?.location || fallback.location;
    const pallet = d?.pallet || fallback.pallet;
    return { rack, location, pallet, ok: !!(location || pallet) };
  };
  // Received qty for a line, clamped to [0, counted]. Default = counted (full).
  const recvFor = (item: string, counted: number) => {
    const raw = receivedByItem.get(item);
    if (raw === undefined) return counted;
    return Math.max(0, Math.min(counted, Math.round(raw)));
  };

  const accessible = accessibleWarehouses(session);
  const user = session.employee_code;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ລັອກໃບກວດນັບ — ກົດ "ຮັບເຂົ້າ WMS" ສອງເທື່ອຈະສ້າງໃບຮັບສອງໃບຈາກ
    // ໃບກວດນັບດຽວກັນ ຖ້າບໍ່ກັນໄວ້.
    await lockDoc(client, "count-post", countNo);

    // Count-sheet header (must be a draft).
    const hdr = (await client.query<{ wh_code: string | null; po_no: string | null; supplier: string | null; status: number | null; doc_type: number | null }>(
      `SELECT warehouse_code AS wh_code, ref_doc_no AS po_no, supplier_code AS supplier, status, doc_type
       FROM public.wms_product_receive WHERE doc_no = $1 LIMIT 1`,
      [countNo],
    )).rows[0];
    if (!hdr || hdr.doc_type !== DOC_TYPE.count) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບໃບກວດນັບ" }, { status: 404 }); }
    if (hdr.status !== RECEIVE_STATUS.draft) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບກວດນັບນີ້ຮັບເຂົ້າແລ້ວ" }, { status: 409 }); }
    const wh = hdr.wh_code ?? "";
    if (!wh) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບກວດນັບບໍ່ມີສາງ" }, { status: 400 }); }
    if (Array.isArray(accessible) && !accessible.includes(wh)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 }); }

    // The sheet's PO list (multi-PO). Each merged line's received qty is allocated
    // across these POs in order. Falls back to the header's single ref_doc_no.
    const poRows = (await client.query<{ po_no: string; supplier_code: string | null }>(
      `SELECT po_no, supplier_code FROM public.wms_product_receive_po WHERE doc_no = $1 ORDER BY line_order, roworder`,
      [countNo],
    )).rows;
    const poNos = poRows.length > 0 ? poRows.map((r) => r.po_no) : (hdr.po_no ? [hdr.po_no] : []);
    const supplierByPo = new Map(poRows.map((r) => [r.po_no, r.supplier_code]));
    const primaryPo = poNos[0] ?? "";
    if (poNos.length === 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບກວດນັບບໍ່ມີ PO" }, { status: 400 }); }

    /** Remaining (un-received) qty of an item on one PO, attributing WMS receipts
     *  by the receipt line's own ref_doc_no when set, else the header ref_doc_no. */
    async function remainingFor(po: string, item: string): Promise<number> {
      const r = await client.query<{ remaining: string }>(
        `SELECT (COALESCE(MAX(p.qty_balance),0) - COALESCE((
            SELECT SUM(d.qty) FROM public.wms_product_receive h
            JOIN public.wms_product_receive_detail d ON d.doc_no = h.doc_no
            WHERE COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), h.ref_doc_no) = $1
              AND d.item_code = $2 AND (h.status = 0 OR h.status IS NULL)
          ),0))::numeric::text AS remaining
         FROM public.odg_po_remain p WHERE p.doc_no = $1 AND p.item_code = $2`,
        [po, item],
      );
      return Number.parseFloat(r.rows[0]?.remaining ?? "0") || 0;
    }

    // Lines + manual serials from the count sheet.
    const lines = (await client.query<{ item_code: string; item_name: string | null; unit_code: string | null; qty: string }>(
      `SELECT item_code, item_name, unit_code, qty::text AS qty FROM public.wms_product_receive_detail WHERE doc_no = $1 ORDER BY roworder`,
      [countNo],
    )).rows;
    if (lines.length === 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ໃບກວດນັບບໍ່ມີລາຍການ" }, { status: 400 }); }

    // Live reserved serials on the count sheet (exclude cancelled = ignore_sync 2,
    // left over from an earlier partial receipt of this same sheet).
    const snRows = (await client.query<{ item_code: string; serial_number: string }>(
      `SELECT item_code, serial_number FROM public.wms_product_receive_serial_detail
       WHERE ref_rec_doc = $1 AND COALESCE(ignore_sync,0) <> 2 ORDER BY roworder`,
      [countNo],
    )).rows;

    // Reserved serials grouped per item, in count order.
    const snByItem = new Map<string, string[]>();
    for (const s of snRows) {
      const arr = snByItem.get(s.item_code);
      if (arr) arr.push(s.serial_number); else snByItem.set(s.item_code, [s.serial_number]);
    }

    // Per-line receive plan: each reserved serial is either committed as stock,
    // held for later reuse (ignore_sync=1), or cancelled/scrapped (ignore_sync=2).
    //  • explicit serial choice (partial ISN line) → commit chosen; of the rest,
    //    cancel the ones the user marked, hold the others
    //  • otherwise → commit the first `received`, hold the surplus
    const planByItem = new Map<string, { recv: number; commit: string[]; held: string[]; cancelled: string[] }>();
    for (const line of lines) {
      const counted = Number.parseFloat(line.qty) || 0;
      const sns = snByItem.get(line.item_code) ?? [];
      const explicit = receivedSerialsByItem.get(line.item_code);
      if (explicit && sns.length > 0) {
        const reserved = new Set(sns);
        const unknown = [...explicit, ...(cancelledSerialsByItem.get(line.item_code) ?? [])].find((s) => !reserved.has(s));
        if (unknown) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: `ສິນຄ້າ ${line.item_code}: SN ${unknown} ບໍ່ກົງກັບໃບກວດນັບ ກະລຸນາໂຫຼດໃໝ່` }, { status: 400 });
        }
        const chosen = new Set(explicit);
        const cancelSet = new Set(cancelledSerialsByItem.get(line.item_code) ?? []);
        const rest = sns.filter((s) => !chosen.has(s));
        planByItem.set(line.item_code, {
          recv: chosen.size,
          commit: sns.filter((s) => chosen.has(s)),
          cancelled: rest.filter((s) => cancelSet.has(s)),
          held: rest.filter((s) => !cancelSet.has(s)),
        });
      } else {
        const recv = recvFor(line.item_code, counted);
        const commit: string[] = [];
        const held: string[] = [];
        sns.forEach((sn, i) => (i < recv ? commit.push(sn) : held.push(sn)));
        planByItem.set(line.item_code, { recv, commit, held, cancelled: [] });
      }
    }

    // Re-validate received qty and ALLOCATE it across the sheet's POs.
    // For each received line: sum remaining across all POs (R). If R>0 the
    // received qty must not exceed R; then fill POs in order. Any excess when
    // R=0 (item not on any PO / already fully received) lands on the primary PO
    // as an over-receipt — matching the old single-PO behaviour.
    type Alloc = { po_no: string; qty: number };
    const allocByItem = new Map<string, Alloc[]>();
    let totalReceived = 0;
    for (const line of lines) {
      const recv = planByItem.get(line.item_code)!.recv;
      totalReceived += recv;
      if (recv <= 0) { allocByItem.set(line.item_code, []); continue; }
      if (!destFor(line.item_code).ok) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${line.item_code}: ກະລຸນາເລືອກ location ຫຼື pallet` }, { status: 400 });
      }
      const rema: { po_no: string; rm: number }[] = [];
      let R = 0;
      for (const po of poNos) { const rm = await remainingFor(po, line.item_code); rema.push({ po_no: po, rm }); if (rm > 0) R += rm; }
      if (R > 0 && recv > R + 1e-6) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${line.item_code}: ຮັບ ${recv} ເກີນຄ້າງລວມທຸກ PO ${Math.round(R * 1e6) / 1e6}` }, { status: 400 });
      }
      const allocs: Alloc[] = [];
      let left = recv;
      for (const { po_no, rm } of rema) {
        if (left <= 1e-9) break;
        const take = Math.min(left, Math.max(0, rm));
        if (take > 0) { allocs.push({ po_no, qty: take }); left -= take; }
      }
      if (left > 1e-6) {
        // Excess beyond every PO's remaining (R was 0) → attribute to primary PO.
        const ex = allocs.find((a) => a.po_no === primaryPo);
        if (ex) ex.qty += left; else allocs.push({ po_no: primaryPo, qty: left });
      }
      allocByItem.set(line.item_code, allocs);
    }
    if (totalReceived <= 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີຈຳນວນຮັບເຂົ້າ (ຮັບຈິງ = 0 ທຸກລາຍການ)" }, { status: 400 });
    }

    // Which POs actually received something (allocation order preserved).
    const receiptPos = poNos.filter((po) => Array.from(allocByItem.values()).some((as) => as.some((a) => a.po_no === po && a.qty > 0)));

    // Receipt header (RC). Header ref_doc_no keeps the primary PO for compat;
    // the full PO list is written to wms_product_receive_po below.
    const recNo = await genDocNo(client, "RC");
    await client.query(
      `INSERT INTO public.wms_product_receive
         (doc_no, doc_date, doc_time, status, doc_type, warehouse_code, supplier_code, remark,
          creator_code, ref_doc_no, box_code, shelf_code, create_datetime, create_date_time_now)
       VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now())`,
      [recNo, RECEIVE_STATUS.posted, DOC_TYPE.receipt, wh, hdr.supplier || null, remark || null, user, primaryPo, fallback.pallet || null, fallback.location || fallback.rack || null],
    );
    // _ref keeps the classic (primary PO, count sheet) pair for existing readers.
    await client.query(
      `INSERT INTO public.wms_product_receive_ref (doc_no, ref_doc_no, line_order, create_date_time_now)
       VALUES ($1, $2, 1, now()), ($1, $3, 2, now())`,
      [recNo, primaryPo, countNo],
    );
    // The receipt's full PO list (attribution source for remaining calcs).
    for (let i = 0; i < receiptPos.length; i++) {
      await client.query(
        `INSERT INTO public.wms_product_receive_po (doc_no, po_no, wh_code, supplier_code, line_order, create_date_time_now)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [recNo, receiptPos[i], wh, supplierByPo.get(receiptPos[i]) ?? null, i + 1],
      );
    }

    await insertTransHeader(client, { docNo: recNo, docRef: primaryPo, wh, user });

    // Apply the per-line plan computed above: committed serials become stock,
    // held serials stay on the draft for the rest of the goods, cancelled serials
    // are scrapped (ignore_sync=2) — kept on record so the ISN number is never
    // reused, but never re-received.
    const commit: { item_code: string; serial_number: string }[] = [];
    const held: string[] = [];
    const cancelled: string[] = [];
    // Which PO each committed serial belongs to (for the serial ledger doc_ref).
    const serialPo = new Map<string, string>();
    // Received qty grouped per PO → per item, for ERP purchase posting.
    const erpByPo = new Map<string, Map<string, { item_code: string; item_name: string | null; unit_code: string | null; qty: number }>>();

    for (const line of lines) {
      const plan = planByItem.get(line.item_code)!;
      const recv = plan.recv;
      const d = destFor(line.item_code);
      for (const sn of plan.commit) commit.push({ item_code: line.item_code, serial_number: sn });
      for (const sn of plan.held) held.push(sn);
      for (const sn of plan.cancelled) cancelled.push(sn);
      if (recv <= 0) continue; // nothing received → no stock row, all SN held/cancelled

      const allocs = allocByItem.get(line.item_code) ?? [];

      // Assign the line's committed serials to POs following the allocation.
      let sIdx = 0;
      for (const a of allocs) {
        let n = Math.round(a.qty);
        while (n-- > 0 && sIdx < plan.commit.length) serialPo.set(plan.commit[sIdx++], a.po_no);
      }
      while (sIdx < plan.commit.length) serialPo.set(plan.commit[sIdx++], allocs[allocs.length - 1]?.po_no ?? primaryPo);

      // One receipt-detail row per (item, PO allocation) — attributes the qty.
      for (const a of allocs) {
        await client.query(
          `INSERT INTO public.wms_product_receive_detail
             (doc_no, doc_date, doc_time, item_code, item_name, unit_code, qty, box_code, shelf_code, ref_doc_no, wh_code, create_date_time_now)
           VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), $2, $3, $4, $5, $6, $7, $8, $9, now())`,
          [recNo, line.item_code, line.item_name, line.unit_code || null, a.qty, d.pallet || null, d.location || d.rack || null, a.po_no, wh],
        );
        // ERP accumulation per PO.
        let m = erpByPo.get(a.po_no);
        if (!m) { m = new Map(); erpByPo.set(a.po_no, m); }
        const ex = m.get(line.item_code);
        if (ex) ex.qty += a.qty;
        else m.set(line.item_code, { item_code: line.item_code, item_name: line.item_name, unit_code: line.unit_code, qty: a.qty });
      }

      // One stock movement per item (full received qty) — stock is PO-agnostic.
      await insertTransDetail(client, {
        docNo: recNo, docRef: primaryPo, wh, user,
        line: { item_code: line.item_code, item_name: line.item_name, qty: recv, unit_code: line.unit_code, rack: d.rack || null, location: d.location || null, pallet: d.pallet || null },
      });
    }

    // Commit the received serials to the ledger (verbatim — generated at save
    // time) + serial stock.
    const lineByItem = new Map(lines.map((l) => [l.item_code, l]));
    if (commit.length > 0) {
      await client.query(
        `INSERT INTO public.sn_trans (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_def, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, $5, 'RC', $6)`,
        [SN_RECEIPT_FLAG, recNo, user, commit.length, primaryPo, wh],
      );
      for (const s of commit) {
        const line = lineByItem.get(s.item_code);
        const itemName = line?.item_name ?? null;
        const unitCode = line?.unit_code ?? null;
        const d = destFor(s.item_code);
        const serialPoNo = serialPo.get(s.serial_number) ?? primaryPo;
        await client.query(
          `INSERT INTO public.sn_trans_detail (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, unit_cost, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet)
           VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1, NULL, $6, $7, $8, 1, $9, $10, $11)`,
          [SN_RECEIPT_FLAG, recNo, user, s.item_code, s.serial_number, wh, itemName, serialPoNo, d.rack || null, d.location || null, d.pallet || null],
        );
        await client.query(
          `INSERT INTO public.sn_inventory (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
           VALUES ($1, $1, 1, 0, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [s.serial_number, s.item_code, itemName, unitCode, wh, d.rack || null, d.location || null, d.pallet || null, user],
        );
      }
    }

    // Goods still owed on this sheet after the receipt: held serials (ISN) or the
    // unreceived qty (non-ISN). Cancelled serials are scrapped, not owed.
    let remainTotal = 0;
    const remainByItem = new Map<string, number>();
    for (const line of lines) {
      const plan = planByItem.get(line.item_code)!;
      const counted = Number.parseFloat(line.qty) || 0;
      const isIsn = (snByItem.get(line.item_code) ?? []).length > 0;
      const remain = isIsn ? plan.held.length : Math.max(0, counted - plan.recv);
      remainByItem.set(line.item_code, remain);
      remainTotal += remain;
    }

    // Cancelled serials (ignore_sync=2): scrapped labels — the row stays so the
    // ISN number is never regenerated, but reuse never re-claims them.
    if (cancelled.length > 0) {
      await client.query(
        `UPDATE public.wms_product_receive_serial_detail
           SET ignore_sync = 2, is_lock_record = 0, last_update_date_time_now = now()
         WHERE ref_rec_doc = $1 AND serial_number = ANY($2::text[])`,
        [countNo, cancelled],
      );
    }

    if (remainTotal > 0) {
      // Incomplete: keep the count sheet as a draft for the remaining goods so it
      // stays in the list and the rest can be received on the SAME sheet.
      //  • committed serials → move onto the receipt (off the draft)
      //  • held serials → stay as the draft's live reserved (preserve printed labels)
      //  • the sheet's lines shrink to the remaining qty
      if (commit.length > 0) {
        await client.query(
          `UPDATE public.wms_product_receive_serial_detail
             SET ref_rec_doc = $2, ignore_sync = 0, last_update_date_time_now = now()
           WHERE ref_rec_doc = $1 AND serial_number = ANY($3::text[])`,
          [countNo, recNo, commit.map((c) => c.serial_number)],
        );
      }
      if (held.length > 0) {
        await client.query(
          `UPDATE public.wms_product_receive_serial_detail
             SET ignore_sync = 0, is_lock_record = 1, last_update_date_time_now = now()
           WHERE ref_rec_doc = $1 AND serial_number = ANY($2::text[])`,
          [countNo, held],
        );
      }
      for (const line of lines) {
        const remain = remainByItem.get(line.item_code) ?? 0;
        if (remain > 0) {
          await client.query(`UPDATE public.wms_product_receive_detail SET qty = $3 WHERE doc_no = $1 AND item_code = $2`, [countNo, line.item_code, remain]);
        } else {
          await client.query(`DELETE FROM public.wms_product_receive_detail WHERE doc_no = $1 AND item_code = $2`, [countNo, line.item_code]);
        }
      }
      // status stays 9 (draft) — sheet remains in the list.
    } else {
      // Fully accounted (received and/or cancelled) → consume the sheet.
      await client.query(`UPDATE public.wms_product_receive SET status = $2 WHERE doc_no = $1`, [countNo, RECEIVE_STATUS.consumed]);
    }

    // ERP: post ໃບຊື້ສິນຄ້າຕິດໜີ້ (flag 12) — one per PO that received goods,
    // priced from that PO. Env-gated (writes real ERP financial docs).
    const erpDocs: { po_no: string; doc_no: string; total: number; items: number; missing: string[] }[] = [];
    const erpMissing: string[] = [];
    if (process.env.WMS_ERP_PURCHASE_ENABLED === "1") {
      for (const [po, itemsMap] of erpByPo) {
        const items = Array.from(itemsMap.values());
        if (!po || items.length === 0) continue;
        const r = await postErpPurchaseReceipt(client, {
          poNo: po, items, wh, location: null,
          user: user ?? null, wmsDoc: recNo, remark: `WMS receive ${po}`,
        });
        if (r && r.docNo) {
          erpDocs.push({ po_no: po, doc_no: r.docNo, total: r.total, items: r.posted, missing: r.missing });
          erpMissing.push(...r.missing);
        }
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      receive_code: recNo,
      count_code: countNo,
      pos: receiptPos.length,
      received: lines.length,
      serials: commit.length,
      remaining: remainTotal,
      held: held.length,
      cancelled: cancelled.length,
      // First ERP doc kept as erp_purchase for backward-compat; full list in erp_purchases.
      erp_purchase: erpDocs[0]
        ? { doc_no: erpDocs[0].doc_no, total: erpDocs[0].total, items: erpDocs[0].items, missing: erpMissing }
        : null,
      erp_purchases: erpDocs,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";
import {
  SALE_FLAG,
  allocateFifo,
  stockNodes,
  tripHeader,
  tripNeedLines,
  type NodeStock,
} from "@/lib/tripPick";

/**
 * ໃບຈັດຖ້ຽວ 1 ໃບ → ແຜນເກັບສິນຄ້າ (GET) ແລະ ສ້າງໃບສັ່ງຈ່າຍ (POST).
 *
 * GET  ?wh=<code>
 *   ລວມຍອດທີ່ຕ້ອງເກັບຂອງທັງຖ້ຽວ ເປັນ "ຕໍ່ສິນຄ້າ" (ຄົນເກັບຍ່າງເກັບເທື່ອດຽວ),
 *   ພ້ອມແຍກໃຫ້ເຫັນວ່າ ແຕ່ລະສິນຄ້າ ເປັນຂອງບິນໃດແດ່ + ບ່ອນຈັດເກັບ (FIFO).
 *
 * POST { wh_code, bills?, lines:[{item_code, rack, location, pallet, qty}], remark? }
 *   ສ້າງໃບ pick "ໃບດຽວ" ຕໍ່ 1 ຖ້ຽວ (header.ref_doc_no = ເລກຖ້ຽວ, doc_type 44)
 *   — ເກັບເທື່ອດຽວ ພິມໃບດຽວ ຢືນຢັນເທື່ອດຽວ. ບິນຕົ້ນທາງຖືກເກັບໄວ້ *ລະດັບແຖວ*
 *   (`wms_product_out_detail.ref_doc_no`) ໂດຍປັນຈຳນວນທີ່ວາງແຜນລົງແຕ່ລະບິນ
 *   ຕາມລຳດັບ, ຕອນຢືນຢັນຈຶ່ງ post ເຂົ້າ ERP ແຍກຕໍ່ບິນ.
 */

type LineInput = { item_code?: unknown; rack?: unknown; location?: unknown; pallet?: unknown; qty?: unknown; item_name?: unknown; unit_code?: unknown };
type Body = { wh_code?: unknown; bills?: unknown; lines?: unknown; remark?: unknown };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}
const nodeKey = (item: string, rack: string, location: string, pallet: string) => `${item}|${rack}|${location}|${pallet}`;

export async function GET(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { doc } = await ctx.params;
  const tripNo = decodeURIComponent(doc).trim();
  const wh = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!tripNo || !wh) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const header = await tripHeader(tripNo);
  if (!header) return NextResponse.json({ error: "ບໍ່ພົບໃບຈັດຖ້ຽວ" }, { status: 404 });

  const need = await tripNeedLines(wh, tripNo);
  const itemCodes = [...new Set(need.map((n) => n.item_code))];
  const [{ nodes, serialItems }, snIssueOn, snPickRequired] = await Promise.all([
    stockNodes(wh, itemCodes),
    warehouseSnEnabled(wh, "issue"),
    warehouseSnEnabled(wh, "issue_pick"),
  ]);
  const pickNeedsSn = snIssueOn && snPickRequired;

  // ບິນຂອງຖ້ຽວ (ສະເພາະທີ່ຍັງມີຂອງຄ້າງໃນສາງນີ້) + ຊື່ລູກຄ້າ
  const billNos = [...new Set(need.map((n) => n.bill_no))];
  const billHead = billNos.length
    ? await query<{ bill_no: string; bill_date: string | null; cust_code: string | null; cust_name: string | null; remark: string | null }>(
        `SELECT h.doc_no AS bill_no, to_char(h.doc_date, 'YYYY-MM-DD') AS bill_date,
                h.cust_code, cu.name_1 AS cust_name, h.remark
         FROM public.ic_trans h
         LEFT JOIN public.ar_customer cu ON cu.code = h.cust_code
         WHERE h.doc_no = ANY($1) AND h.trans_flag = ${SALE_FLAG}`,
        [billNos],
      )
    : [];
  const headByBill = new Map(billHead.map((b) => [b.bill_no, b]));

  const bills = billNos
    .map((bill_no) => {
      const lines = need.filter((n) => n.bill_no === bill_no);
      const h = headByBill.get(bill_no);
      return {
        bill_no,
        bill_date: h?.bill_date ?? null,
        cust_code: h?.cust_code ?? null,
        cust_name: h?.cust_name ?? null,
        remark: h?.remark ?? null,
        line_count: lines.length,
        need_qty: lines.reduce((s, l) => s + l.need_qty, 0),
      };
    })
    .sort((a, b) => a.bill_no.localeCompare(b.bill_no));

  // ລວມຕໍ່ສິນຄ້າ (ຄົນເກັບເບິ່ງເປັນລາຍສິນຄ້າ, ບໍ່ແມ່ນລາຍບິນ)
  const items = itemCodes
    .map((item_code) => {
      const lines = need.filter((n) => n.item_code === item_code);
      const needQty = lines.reduce((s, l) => s + l.need_qty, 0);
      const locations: NodeStock[] = nodes.get(item_code) ?? [];
      const serialized = serialItems.has(item_code);
      return {
        item_code,
        item_name: lines[0]?.item_name ?? null,
        unit_code: lines[0]?.unit_code ?? null,
        need_qty: needQty,
        serialized,
        locations,
        alloc: allocateFifo(needQty, locations, serialized && pickNeedsSn),
        bills: lines
          .map((l) => ({ bill_no: l.bill_no, qty: l.need_qty }))
          .sort((a, b) => a.bill_no.localeCompare(b.bill_no)),
      };
    })
    .sort((a, b) => a.item_code.localeCompare(b.item_code));

  // ໃບ pick ທີ່ອອກຈາກຖ້ຽວນີ້ໄປແລ້ວ (ໃບໃໝ່ = 1 ໃບ ຫຼາຍບິນ; ໃບເກົ່າ = 1 ໃບ 1 ບິນ)
  const picks = await query<{ doc_no: string; bill_no: string | null; status: number | null; doc_date: string | null; qty: string; line_count: number }>(
    `SELECT pt.doc_no,
            COALESCE(
              (SELECT string_agg(DISTINCT COALESCE(NULLIF(TRIM(d.ref_doc_no), ''), o.ref_doc_no), ', ')
               FROM public.wms_product_out_detail d WHERE d.doc_no = pt.doc_no),
              pt.bill_no) AS bill_no,
            o.status, to_char(o.doc_date, 'YYYY-MM-DD') AS doc_date,
            (SELECT COALESCE(SUM(d.qty), 0) FROM public.wms_product_out_detail d WHERE d.doc_no = pt.doc_no)::numeric::text AS qty,
            (SELECT count(*)::int FROM public.wms_product_out_detail d WHERE d.doc_no = pt.doc_no) AS line_count
     FROM public.wms_pick_trip pt
     LEFT JOIN public.wms_product_out o ON o.doc_no = pt.doc_no
     WHERE pt.trip_doc_no = $1 AND (pt.wh_code IS NULL OR pt.wh_code = $2)
     ORDER BY pt.doc_no`,
    [tripNo, wh],
  );

  return NextResponse.json({
    trip: header,
    wh_code: wh,
    bills,
    items,
    picks,
    sn: { issue: snIssueOn, pick: pickNeedsSn },
  });
}

export async function POST(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const { doc } = await ctx.params;
  const tripNo = decodeURIComponent(doc).trim();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  const remark = str(body.remark);
  if (!wh || !tripNo) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const header = await tripHeader(tripNo);
  if (!header) return NextResponse.json({ error: "ບໍ່ພົບໃບຈັດຖ້ຽວ" }, { status: 404 });

  // ແຜນທີ່ຄົນເກັບສົ່ງມາ: ຕໍ່ (ສິນຄ້າ, ບ່ອນຈັດເກັບ)
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });
  }
  const planned: { item_code: string; rack: string; location: string; pallet: string; qty: number }[] = [];
  const seen = new Set<string>();
  for (const raw of body.lines as LineInput[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    const rack = str(raw.rack);
    const location = str(raw.location);
    const pallet = str(raw.pallet);
    const qty = num(raw.qty);
    if (qty === null || qty <= 0) continue;
    const key = nodeKey(item_code, rack, location, pallet);
    if (seen.has(key)) {
      return NextResponse.json({ error: `ສິນຄ້າ ${item_code} ຊ້ຳກັນຢູ່ບ່ອນຈັດເກັບດຽວກັນ` }, { status: 400 });
    }
    seen.add(key);
    planned.push({ item_code, rack, location, pallet, qty });
  }
  if (planned.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });

  // ຍອດທີ່ຖ້ຽວນີ້ຕ້ອງຈ່າຍ (ຫຼັງຫັກທີ່ຈ່າຍແລ້ວ / ຄ້າງໃນໃບ pick ອື່ນ)
  const billFilter = Array.isArray(body.bills)
    ? new Set((body.bills as unknown[]).map((b) => str(b)).filter(Boolean))
    : null;
  const need = (await tripNeedLines(wh, tripNo)).filter((n) => !billFilter || billFilter.has(n.bill_no));
  if (need.length === 0) {
    return NextResponse.json({ error: "ຖ້ຽວນີ້ບໍ່ມີສິນຄ້າຄ້າງຈ່າຍໃນສາງນີ້ແລ້ວ" }, { status: 400 });
  }
  const needByItem = new Map<string, { bill_no: string; qty: number }[]>();
  const itemMeta = new Map<string, { item_name: string | null; unit_code: string | null }>();
  for (const n of need) {
    const arr = needByItem.get(n.item_code);
    if (arr) arr.push({ bill_no: n.bill_no, qty: n.need_qty });
    else needByItem.set(n.item_code, [{ bill_no: n.bill_no, qty: n.need_qty }]);
    if (!itemMeta.has(n.item_code)) itemMeta.set(n.item_code, { item_name: n.item_name, unit_code: n.unit_code });
  }
  for (const arr of needByItem.values()) arr.sort((a, b) => a.bill_no.localeCompare(b.bill_no));

  for (const p of planned) {
    const arr = needByItem.get(p.item_code);
    if (!arr) return NextResponse.json({ error: `ສິນຄ້າ ${p.item_code} ບໍ່ຢູ່ໃນຖ້ຽວນີ້ (ຫຼື ຈ່າຍໄປແລ້ວ)` }, { status: 400 });
  }
  for (const [item, arr] of needByItem) {
    const want = planned.filter((p) => p.item_code === item).reduce((s, p) => s + p.qty, 0);
    const cap = arr.reduce((s, b) => s + b.qty, 0);
    if (want > cap + 1e-6) {
      return NextResponse.json({ error: `ສິນຄ້າ ${item}: ຈ່າຍ ${want} ເກີນຄ້າງຂອງຖ້ຽວ ${cap}` }, { status: 400 });
    }
  }

  // ຂໍ້ມູນລູກຄ້າຕໍ່ບິນ (ໃສ່ໃສ່ຫົວໃບ pick)
  const billNos = [...new Set(need.map((n) => n.bill_no))];
  const custRows = await query<{ bill_no: string; cust_code: string | null }>(
    `SELECT doc_no AS bill_no, cust_code FROM public.ic_trans WHERE doc_no = ANY($1) AND trans_flag = ${SALE_FLAG}`,
    [billNos],
  );
  const custByBill = new Map(custRows.map((r) => [r.bill_no, r.cust_code]));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const snOn = await warehouseSnEnabled(wh, "issue", client);
    const pickNeedsSn = snOn && (await warehouseSnEnabled(wh, "issue_pick", client));

    // ສິນຄ້າທີ່ຄຸມ serial ຈິງໃນສາງນີ້
    const itemCodes = [...needByItem.keys()];
    const snItems = new Set(
      (
        await client.query<{ item_code: string }>(
          `SELECT DISTINCT item_code FROM public.sn_inventory
           WHERE wh_code = $1 AND COALESCE(status, 0) = 0 AND item_code = ANY($2)`,
          [wh, itemCodes],
        )
      ).rows.map((r) => r.item_code),
    );

    // ກວດຍອດຢູ່ບ່ອນຈັດເກັບ + ດຶງ serial (FIFO ຕາມ ISN) ໃຫ້ແຕ່ລະ node
    const serialsByNode = new Map<string, string[]>();
    for (const p of planned) {
      // NOTE: ບໍ່ກອງ `status` — ຄືກັບໜ້າຍອດຄົງເຫຼືອ (status=1 ຄືຂາອອກຂອງການຍ້າຍພາຍໃນ)
      const bal = await client.query<{ before: string }>(
        `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS before
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1
           AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  = $2
           AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
           AND COALESCE(NULLIF(TRIM(t.pallet), ''), '')      = $4
           AND t.item_code = $5`,
        [wh, p.rack, p.location, p.pallet, p.item_code],
      );
      const before = Number.parseFloat(bal.rows[0]?.before ?? "0") || 0;
      if (p.qty > before + 1e-6) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ສິນຄ້າ ${p.item_code}: ຈ່າຍ ${p.qty} ເກີນຄົງເຫຼືອ ${before} ທີ່ບ່ອນນີ້` }, { status: 400 });
      }
      if (pickNeedsSn && snItems.has(p.item_code)) {
        const want = Math.round(p.qty);
        // ຄືກັບ /api/movements/item-serials: sn ທີ່ໃຊ້ຈິງ = COALESCE(sn, isn)
        // (ມີ ~32k ໜ່ວຍ ທີ່ມີແຕ່ ISN), ແລະ ກອງ node ສະເພາະຄ່າທີ່ບໍ່ຫວ່າງ ເພາະ
        // sn_inventory ບັນທຶກບ່ອນຈັດເກັບຫຼວມກວ່າ movement node. FIFO = ISN ນ້ອຍກ່ອນ.
        const snArgs: unknown[] = [wh, p.item_code];
        const snFilters = ["i.wh_code = $1", "i.item_code = $2", "COALESCE(i.status, 0) = 0"];
        if (p.rack) { snArgs.push(p.rack); snFilters.push(`COALESCE(NULLIF(TRIM(i.rack), ''), '') = $${snArgs.length}`); }
        if (p.location) { snArgs.push(p.location); snFilters.push(`COALESCE(NULLIF(TRIM(i.location), ''), '') = $${snArgs.length}`); }
        if (p.pallet) { snArgs.push(p.pallet); snFilters.push(`COALESCE(NULLIF(TRIM(i.pallet), ''), '') = $${snArgs.length}`); }
        snArgs.push(want);
        const sn = await client.query<{ sn: string }>(
          `SELECT COALESCE(NULLIF(TRIM(i.sn), ''), i.isn) AS sn
           FROM public.sn_inventory i
           WHERE ${snFilters.join(" AND ")}
             AND COALESCE(NULLIF(TRIM(i.sn), ''), i.isn) IS NOT NULL
           ORDER BY COALESCE(NULLIF(TRIM(i.isn), ''), i.sn) ASC
           LIMIT $${snArgs.length}`,
          snArgs,
        );
        if (sn.rows.length < want) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: `ສິນຄ້າ ${p.item_code}: ບ່ອນນີ້ມີ serial ພຽງ ${sn.rows.length}/${want} — ກະລຸນາປ່ຽນບ່ອນຈັດເກັບ` },
            { status: 400 },
          );
        }
        serialsByNode.set(nodeKey(p.item_code, p.rack, p.location, p.pallet), sn.rows.map((r) => r.sn));
      }
    }

    // ປັນແຜນ (ຕໍ່ສິນຄ້າ) ລົງບິນ — ບິນລະເທົ່າທີ່ຄ້າງ, ຕາມລຳດັບເລກບິນ
    type OutLine = { item_code: string; item_name: string | null; unit_code: string | null; qty: number; rack: string; location: string; pallet: string; serials: string[] };
    const linesByBill = new Map<string, OutLine[]>();
    for (const [item, billNeeds] of needByItem) {
      const queue = planned
        .filter((p) => p.item_code === item)
        .map((p) => ({
          ...p,
          left: p.qty,
          serials: [...(serialsByNode.get(nodeKey(item, p.rack, p.location, p.pallet)) ?? [])],
        }));
      let qi = 0;
      for (const bn of billNeeds) {
        let left = bn.qty;
        while (left > 1e-6 && qi < queue.length) {
          const node = queue[qi];
          if (node.left <= 1e-6) { qi += 1; continue; }
          const take = Math.min(left, node.left);
          const serials = node.serials.splice(0, Math.round(take));
          const arr = linesByBill.get(bn.bill_no) ?? [];
          arr.push({
            item_code: item,
            item_name: itemMeta.get(item)?.item_name ?? null,
            unit_code: itemMeta.get(item)?.unit_code ?? null,
            qty: take,
            rack: node.rack,
            location: node.location,
            pallet: node.pallet,
            serials,
          });
          linesByBill.set(bn.bill_no, arr);
          node.left -= take;
          left -= take;
        }
      }
    }

    if (linesByBill.size === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ຈ່າຍ" }, { status: 400 });
    }

    // ── ໃບດຽວຕໍ່ຖ້ຽວ ─────────────────────────────────────────────────────────
    // header.ref_doc_no = ເລກຖ້ຽວ; ບິນຕົ້ນທາງຢູ່ລະດັບແຖວ (detail.ref_doc_no)
    // ເພື່ອໃຫ້ຕອນຢືນຢັນ post ເຂົ້າ ERP ແຍກຕໍ່ບິນໄດ້ຄືເກົ່າ.
    const tripTag = `ຖ້ຽວ ${tripNo}${header.car_name || header.car ? ` · ${header.car_name ?? header.car}` : ""}${header.driver_name ? ` · ${header.driver_name}` : ""}`;
    const orderedBills = [...linesByBill.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    const outDoc = (
      await client.query<{ doc_no: string }>(
        `SELECT 'OUT' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('public.wms_product_out_roworder_seq')::text, 5, '0') AS doc_no`,
      )
    ).rows[0].doc_no;

    const slipRemark = `${tripTag}${remark ? ` · ${remark}` : ""}`.slice(0, 255);
    // ລູກຄ້າ: ໃສ່ໄດ້ພຽງເມື່ອທັງໃບເປັນລູກຄ້າດຽວ (ຖ້ຽວປົກກະຕິມີຫຼາຍລູກຄ້າ).
    const custCodes = new Set(orderedBills.map(([b]) => custByBill.get(b) ?? "").filter(Boolean));
    await client.query(
      `INSERT INTO public.wms_product_out
         (doc_no, doc_date, doc_time, status, warehouse_code, branch_code, customer_code, ref_doc_no, doc_type, creator_code, remark, create_date_time_now)
       VALUES ($1, CURRENT_DATE, to_char(now(),'HH24:MI'), 0, $2, '00', $3, $4, ${SALE_FLAG}, $5, $6, now())`,
      [outDoc, wh, custCodes.size === 1 ? [...custCodes][0] : null, tripNo, session.employee_code, slipRemark],
    );

    const created: { bill_no: string; lines: number; qty: number; serials: number }[] = [];
    for (const [billNo, lines] of orderedBills) {
      for (const l of lines) {
        // shelf_code ເກັບ node ເຕັມ `rack|location|pallet`; box_code ເກັບ location ອ່ານງ່າຍ;
        // ref_doc_no = ບິນຂາຍທີ່ແຖວນີ້ເປັນຂອງ.
        await client.query(
          `INSERT INTO public.wms_product_out_detail
             (doc_no, doc_date, item_code, item_name, unit_code, qty, shelf_code, box_code, ref_doc_no, create_date_time_now)
           VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, now())`,
          [outDoc, l.item_code, l.item_name, l.unit_code || null, l.qty, `${l.rack}|${l.location}|${l.pallet}`, l.location || null, billNo],
        );
        for (const sn of l.serials) {
          await client.query(
            `INSERT INTO public.wms_product_out_serial_detail (ref_out_doc, ref_out_date, item_code, serial_number, create_date_time_now)
             VALUES ($1, CURRENT_DATE, $2, $3, now())`,
            [outDoc, l.item_code, sn],
          );
        }
      }
      created.push({
        bill_no: billNo,
        lines: lines.length,
        qty: lines.reduce((s, l) => s + l.qty, 0),
        serials: lines.reduce((s, l) => s + l.serials.length, 0),
      });
    }

    await client.query(
      `INSERT INTO public.wms_pick_trip
         (doc_no, trip_doc_no, bill_no, wh_code, car, driver, route_code, round_code, date_logistic, created_by)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8::date, $9)
       ON CONFLICT (doc_no) DO NOTHING`,
      [outDoc, tripNo, wh, header.car, header.driver, header.route_code, header.round_code, header.date_logistic, session.employee_code],
    );

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      trip_doc_no: tripNo,
      doc_no: outDoc,
      bills: created,
      lines: created.reduce((s, c) => s + c.lines, 0),
      qty: created.reduce((s, c) => s + c.qty, 0),
      serials: created.reduce((s, c) => s + c.serials, 0),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

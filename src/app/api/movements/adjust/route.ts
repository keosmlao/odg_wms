import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { getIsnInfo, getMaxIsnSeq, isnYearCode } from "@/lib/receive";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";

/** trans_flag for WMS-internal stock adjustments in odg_wms_trans_detail. */
const ADJUST_TRANS_FLAG = 99;

const REASONS = new Set(["count", "damaged", "lost", "found", "other"]);

type AdjustLineInput = {
  item_code?: unknown;
  item_name?: unknown;
  unit_code?: unknown;
  counted_qty?: unknown;
  // Serialized items adjust by serial, not by free qty:
  serials_remove?: unknown; // ISN/SN to take out (missing/damaged)
  serials_add?: unknown; // existing ISN/SN found to add
  serials_generate?: unknown; // number of brand-new ISN to generate & add
};

type AdjustBody = {
  wh_code?: unknown;
  shelf_code?: unknown;
  shelf_code1?: unknown;
  pallet?: unknown;
  reason?: unknown;
  note?: unknown;
  lines?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Post a stock adjustment.
 *
 * For each item line the server recomputes the current balance at the
 * (wh, rack, location, pallet) node, derives delta = counted - before, and —
 * when delta != 0 — writes:
 *   1. a balancing movement into `odg_wms_trans_detail` (calc_flag ±1,
 *      trans_flag 99) so the balance the app shows updates immediately, and
 *   2. a detail line into the existing `wms_product_adj_stock_detail`.
 * A single `wms_product_adj_stock` header ties all lines together (one doc_no).
 *
 * Location mapping into the legacy adj-stock tables (which only have
 * shelf_code + box_code, no warehouse): shelf_code <- our location code
 * (which embeds the rack prefix), box_code <- pallet. Warehouse is preserved on
 * the trans_detail rows and echoed into the header remark.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  let body: AdjustBody;
  try {
    body = (await request.json()) as AdjustBody;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  const shelf = str(body.shelf_code); // rack
  const shelf1 = str(body.shelf_code1); // location
  const pallet = str(body.pallet);
  const reason = str(body.reason) || "count";
  const note = str(body.note);

  if (!wh) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  }
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: "ເຫດຜົນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ປັບປຸງ" }, { status: 400 });
  }

  // Per-warehouse policy: when the ADJUST menu has SN off, adjust by qty only —
  // ignore serial add/remove/generate for every line.
  const snOn = await warehouseSnEnabled(wh, "adjust");

  // Normalise + validate lines (dedupe by item_code — one adjust per item/node).
  const seen = new Set<string>();
  const lines: {
    item_code: string;
    item_name: string | null;
    unit_code: string;
    counted: number;
    serialsRemove: string[];
    serialsAdd: string[];
    serialsGenerate: number;
  }[] = [];
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.map((x) => str(x)).filter(Boolean))) : [];
  for (const raw of body.lines as AdjustLineInput[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    if (seen.has(item_code)) {
      return NextResponse.json(
        { error: `ສິນຄ້າ ${item_code} ຊ້ຳກັນໃນລາຍການ` },
        { status: 400 },
      );
    }
    seen.add(item_code);
    const serialsRemove = snOn ? strArr(raw.serials_remove) : [];
    const serialsAdd = snOn ? strArr(raw.serials_add) : [];
    const serialsGenerate = snOn ? Math.max(0, Math.round(num(raw.serials_generate) ?? 0)) : 0;
    const isSerial = serialsRemove.length > 0 || serialsAdd.length > 0 || serialsGenerate > 0;
    // Non-serial lines need a counted qty; serial lines derive it from the serials.
    const counted = isSerial ? 0 : num(raw.counted_qty);
    if (!isSerial && (counted === null || counted < 0)) {
      // SN off + a serial-only line with no counted qty → nothing to adjust; skip.
      if (!snOn) continue;
      return NextResponse.json(
        { error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` },
        { status: 400 },
      );
    }
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code),
      counted: counted ?? 0,
      serialsRemove,
      serialsAdd,
      serialsGenerate,
    });
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ປັບປຸງ" }, { status: 400 });
  }

  // Legacy detail location mapping.
  const legacyShelf = shelf1 || shelf; // prefer location, fall back to rack
  const legacyBox = pallet;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Generate a doc_no. Reuse the legacy table's roworder sequence as a serial
    // (gaps are harmless); format ADJ<YYMMDD>-<seq5>.
    const codeRes = await client.query<{ doc_no: string }>(
      `SELECT 'ADJ' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
              lpad(nextval('public.wms_product_adj_stock_roworder_seq')::text, 5, '0') AS doc_no`,
    );
    const docNo = codeRes.rows[0].doc_no;

    const posted: {
      item_code: string;
      before_qty: string;
      counted_qty: number;
      delta_qty: string;
    }[] = [];
    let changed = 0;
    let snGenerated = 0;
    let snHeaderDone = false;
    const user = session.employee_code;
    const yearCode = isnYearCode(new Date().getFullYear());

    // Serial-ledger header (sn_trans), created lazily on first serial activity.
    async function ensureSnHeader() {
      if (snHeaderDone) return;
      await client.query(
        `INSERT INTO public.sn_trans
           (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, 0, 'ADJ', $4)`,
        [ADJUST_TRANS_FLAG, docNo, user, wh],
      );
      snHeaderDone = true;
    }
    // sn_trans_detail row for one serial (calc_flag +1 add / -1 remove).
    async function snLedger(itemCode: string, itemName: string | null, serial: string, isn: string | null, cf: 1 | -1) {
      await client.query(
        `INSERT INTO public.sn_trans_detail
           (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse,
            item_name, doc_ref, calc_flag, rack, location, pallet, isn)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ADJUST_TRANS_FLAG, docNo, user, itemCode, serial, wh, itemName, reason, cf, shelf || null, shelf1 || null, pallet || null, isn],
      );
    }

    for (const line of lines) {
      // Recompute current balance at the node inside the transaction.
      const balRes = await client.query<{ before: string }>(
        `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS before
         FROM public.odg_wms_trans_detail t
         WHERE (t.status = 0 OR t.status IS NULL)
           AND t.wh_code = $1
           AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') = $2
           AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
           AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $4
           AND t.item_code = $5`,
        [wh, shelf, shelf1, pallet, line.item_code],
      );
      const before = Number.parseFloat(balRes.rows[0].before) || 0;
      const isSerial = line.serialsRemove.length > 0 || line.serialsAdd.length > 0 || line.serialsGenerate > 0;

      let delta: number;
      if (isSerial) {
        await ensureSnHeader();

        // a) Remove ISN that are missing/damaged → flip sn_inventory to issued.
        for (const isn of line.serialsRemove) {
          const r = await client.query(
            `UPDATE public.sn_inventory SET status = 1, user_mapping = $1
             WHERE wh_code = $2 AND item_code = $3 AND (isn = $4 OR sn = $4) AND COALESCE(status, 0) = 0`,
            [user, wh, line.item_code, isn],
          );
          if ((r.rowCount ?? 0) === 0) {
            await client.query("ROLLBACK");
            return NextResponse.json({ error: `ບໍ່ພົບ SN ${isn} ຂອງ ${line.item_code} ໃນສາງ` }, { status: 400 });
          }
          await snLedger(line.item_code, line.item_name, isn, isn, -1);
        }

        // b) Add a scanned serial. If it already exists in the system (any
        //    status/warehouse) bring it here (relocate / re-activate); otherwise
        //    it's a brand-new one → insert. Serials that are ALREADY in stock at
        //    this exact node are a no-op and must NOT count toward the delta
        //    (else the balancing stock row inflates the count).
        let added = 0;
        for (const isn of line.serialsAdd) {
          const here = await client.query<{ here: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM public.sn_inventory
               WHERE item_code = $1 AND (isn = $2 OR sn = $2)
                 AND COALESCE(status, 0) = 0 AND wh_code = $3
                 AND COALESCE(NULLIF(TRIM(rack), ''), '')     = $4
                 AND COALESCE(NULLIF(TRIM(location), ''), '')  = $5
                 AND COALESCE(NULLIF(TRIM(pallet), ''), '')    = $6
             ) AS here`,
            [line.item_code, isn, wh, shelf, shelf1, pallet],
          );
          if (here.rows[0]?.here) continue; // already in stock here → nothing changes
          const upd = await client.query(
            `UPDATE public.sn_inventory
               SET status = 0, rack = $1, location = $2, pallet = $3, wh_code = $4,
                   item_name = COALESCE(item_name, $5), user_mapping = $6
             WHERE item_code = $7 AND (isn = $8 OR sn = $8)`,
            [shelf || null, shelf1 || null, pallet || null, wh, line.item_name, user, line.item_code, isn],
          );
          if ((upd.rowCount ?? 0) === 0) {
            await client.query(
              `INSERT INTO public.sn_inventory
                 (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
               VALUES ($1, $1, 1, 0, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [isn, line.item_code, line.item_name, line.unit_code || null, wh, shelf || null, shelf1 || null, pallet || null, user],
            );
          }
          await snLedger(line.item_code, line.item_name, isn, isn, 1);
          added += 1;
        }

        // c) Generate brand-new ISN (item must have an ISN category).
        if (line.serialsGenerate > 0) {
          const inf = (await getIsnInfo(client, [line.item_code])).get(line.item_code);
          if (!inf?.is_isn || !inf.category) {
            await client.query("ROLLBACK");
            return NextResponse.json({ error: `${line.item_code}: generate ISN ບໍ່ໄດ້ (ບໍ່ມີ category/ບໍ່ແມ່ນ serial)` }, { status: 400 });
          }
          const prefix = `${inf.category}${yearCode}`;
          const maxseq = await getMaxIsnSeq(client, prefix);
          await client.query(
            `INSERT INTO public.sn_inventory
               (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
             SELECT $1 || lpad(($2::bigint + g)::text, 7, '0'), $1 || lpad(($2::bigint + g)::text, 7, '0'),
                    1, 0, $3, $4, $5, $6, $7, $8, $9, $10
             FROM generate_series(1, $11) g`,
            [prefix, maxseq, line.item_code, line.item_name, line.unit_code || null, wh, shelf || null, shelf1 || null, pallet || null, user, line.serialsGenerate],
          );
          await client.query(
            `INSERT INTO public.sn_trans_detail
               (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
             SELECT $1, $2, CURRENT_DATE, $3, $4, $5 || lpad(($6::bigint + g)::text, 7, '0'), 1, $7, $8, $9, 1, $10, $11, $12, $5 || lpad(($6::bigint + g)::text, 7, '0')
             FROM generate_series(1, $13) g`,
            [ADJUST_TRANS_FLAG, docNo, user, line.item_code, prefix, maxseq, wh, line.item_name, reason, shelf || null, shelf1 || null, pallet || null, line.serialsGenerate],
          );
          snGenerated += line.serialsGenerate;
        }

        delta = added + line.serialsGenerate - line.serialsRemove.length;
      } else {
        delta = Math.round((line.counted - before) * 1e6) / 1e6;
        if (delta === 0) {
          posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: line.counted, delta_qty: "0" });
          continue;
        }
      }

      const counted = before + delta;

      // Balancing movement — only when the qty actually changed (serial swap = 0).
      if (delta !== 0) {
        await client.query(
          `INSERT INTO public.odg_wms_trans_detail
             (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name,
              qty, unit_code, shelf_code, shelf_code1, wh_code, user_created,
              status, calc_flag, doc_time, pallet)
           VALUES
             ($1, CURRENT_DATE, $2, $3, $4, $5,
              $6, $7, $8, $9, $10, $11,
              0, $12, to_char(now(), 'HH24:MI'), $13)`,
          [ADJUST_TRANS_FLAG, docNo, reason, line.item_code, line.item_name, Math.abs(delta), line.unit_code || null, shelf || null, shelf1 || null, wh, user, delta > 0 ? 1 : -1, pallet || null],
        );
      }

      // Legacy adjustment detail line (audit / history).
      await client.query(
        `INSERT INTO public.wms_product_adj_stock_detail
           (doc_no, item_code, unit_code, box_code, shelf_code,
            qty, current_qty, diff_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [docNo, line.item_code, line.unit_code, legacyBox, legacyShelf, counted, before, delta],
      );

      changed += 1;
      posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: counted, delta_qty: String(delta) });
    }

    if (changed === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ບໍ່ມີການປ່ຽນແປງ — ຈຳນວນທີ່ໃສ່ກົງກັບຍອດປະຈຸບັນທັງໝົດ" },
        { status: 400 },
      );
    }

    // Header (one per submit). Legacy table has no wh_code → keep it in remark.
    const remark = `[${wh}] ${note}`.trim();
    await client.query(
      `INSERT INTO public.wms_product_adj_stock
         (doc_no, doc_date, doc_time, doc_type, remark, create_datetime, creator_code, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, now(), $4, 0)`,
      [docNo, reason, remark, session.employee_code],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, adjust_code: docNo, changed, sn_generated: snGenerated, lines: posted });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

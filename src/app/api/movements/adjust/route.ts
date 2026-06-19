import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/** trans_flag for WMS-internal stock adjustments in odg_wms_trans_detail. */
const ADJUST_TRANS_FLAG = 99;

const REASONS = new Set(["count", "damaged", "lost", "found", "other"]);

type AdjustLineInput = {
  item_code?: unknown;
  item_name?: unknown;
  unit_code?: unknown;
  counted_qty?: unknown;
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

  // Normalise + validate lines (dedupe by item_code — one adjust per item/node).
  const seen = new Set<string>();
  const lines: { item_code: string; item_name: string | null; unit_code: string; counted: number }[] = [];
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
    const counted = num(raw.counted_qty);
    if (counted === null || counted < 0) {
      return NextResponse.json(
        { error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` },
        { status: 400 },
      );
    }
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code),
      counted,
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
      const delta = Math.round((line.counted - before) * 1e6) / 1e6;

      if (delta === 0) {
        posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: line.counted, delta_qty: "0" });
        continue;
      }

      const calcFlag = delta > 0 ? 1 : -1;
      const moveQty = Math.abs(delta);

      // 1) Balancing movement (source of the balance the app reads).
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name,
            qty, unit_code, shelf_code, shelf_code1, wh_code, user_created,
            status, calc_flag, doc_time, pallet)
         VALUES
           ($1, CURRENT_DATE, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            0, $12, to_char(now(), 'HH24:MI'), $13)`,
        [
          ADJUST_TRANS_FLAG,
          docNo,
          reason,
          line.item_code,
          line.item_name,
          moveQty,
          line.unit_code || null,
          shelf || null,
          shelf1 || null,
          wh,
          session.employee_code,
          calcFlag,
          pallet || null,
        ],
      );

      // 2) Legacy adjustment detail line.
      await client.query(
        `INSERT INTO public.wms_product_adj_stock_detail
           (doc_no, item_code, unit_code, box_code, shelf_code,
            qty, current_qty, diff_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [docNo, line.item_code, line.unit_code, legacyBox, legacyShelf, line.counted, before, delta],
      );

      changed += 1;
      posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: line.counted, delta_qty: String(delta) });
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
    return NextResponse.json({ ok: true, adjust_code: docNo, changed, lines: posted });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

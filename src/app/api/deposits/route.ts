import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { getDepositSettings, nextDepositCode } from "@/lib/deposit-server";
import { normalizeCurrency } from "@/lib/deposit";

/**
 * Create a new deposit from a set of pending bills.
 *
 * Body: {
 *   wh_code: string,
 *   start_date?: string (YYYY-MM-DD, defaults to today),
 *   cust_code?: string,
 *   cust_name?: string,
 *   note?: string,
 *   bills: Array<{ doc_no: string; trans_flag: number }>
 * }
 *
 * Rates are snapshotted from the current global settings so the
 * eventual settlement is deterministic.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  let body: {
    wh_code?: unknown;
    start_date?: unknown;
    cust_code?: unknown;
    cust_name?: unknown;
    note?: unknown;
    bills?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh =
    typeof body.wh_code === "string" ? body.wh_code.trim() : "";
  if (!wh) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const startDate =
    typeof body.start_date === "string" && body.start_date.trim()
      ? body.start_date.trim()
      : new Date().toISOString().slice(0, 10);

  const billsInput = Array.isArray(body.bills) ? body.bills : [];
  const billKeys: Array<{ doc_no: string; trans_flag: number }> = [];
  for (const b of billsInput) {
    if (!b || typeof b !== "object") continue;
    const rec = b as { doc_no?: unknown; trans_flag?: unknown };
    const docNo = typeof rec.doc_no === "string" ? rec.doc_no.trim() : "";
    const flag =
      typeof rec.trans_flag === "number"
        ? rec.trans_flag
        : Number.parseInt(String(rec.trans_flag ?? ""), 10);
    if (!docNo || !Number.isFinite(flag)) continue;
    billKeys.push({ doc_no: docNo, trans_flag: flag });
  }
  if (billKeys.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກບິນຢ່າງໜ້ອຍ 1 ບິນ" },
      { status: 400 },
    );
  }

  const custCode =
    typeof body.cust_code === "string" && body.cust_code.trim()
      ? body.cust_code.trim()
      : null;
  const custName =
    typeof body.cust_name === "string" && body.cust_name.trim()
      ? body.cust_name.trim()
      : null;
  const note =
    typeof body.note === "string" && body.note.trim()
      ? body.note.trim()
      : null;

  const settings = await getDepositSettings();
  const code = await nextDepositCode(startDate);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Pull bill aggregates from the cache (filtered to the chosen wh) so
    // we capture items/qty/value at deposit time. Bills missing from the
    // cache are skipped — the user should refresh the cache first.
    const docNos = billKeys.map((b) => b.doc_no);
    const flags = billKeys.map((b) => b.trans_flag);
    const cacheRes = await client.query<{
      doc_no: string;
      trans_flag: number;
      doc_date: string | null;
      cust_code: string | null;
      cust_name: string | null;
      sale_code: string | null;
      sale_name: string | null;
      currency_code: string | null;
      lines: number;
      items: number;
      qty_sum: string;
      value_sum: string;
    }>(
      `SELECT c.doc_no, c.trans_flag, c.doc_date::text AS doc_date,
              c.cust_code, c.cust_name, c.sale_code, c.sale_name,
              c.currency_code,
              c.lines, c.items,
              c.qty_sum::text   AS qty_sum,
              c.value_sum::text AS value_sum
       FROM public.wms_pending_bill_cache c
       JOIN UNNEST($1::varchar[], $2::smallint[]) AS x(doc_no, trans_flag)
         ON x.doc_no = c.doc_no AND x.trans_flag = c.trans_flag
       WHERE c.wh_code = $3`,
      [docNos, flags, wh],
    );
    if (cacheRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "ບໍ່ພົບບິນໃນ cache ສຳລັບສາງນີ້ — ກະລຸນາ refresh ບິນຄ້າງຈ່າຍກ່ອນ",
        },
        { status: 400 },
      );
    }

    let totalItems = 0;
    let totalQty = 0;
    let totalValue = 0;
    for (const r of cacheRes.rows) {
      totalItems += r.items;
      totalQty += Number.parseFloat(r.qty_sum) || 0;
      totalValue += Number.parseFloat(r.value_sum) || 0;
    }

    // The fee is charged in the bills' own currency (THB for sales bills).
    // Mixed-currency selections fall back to the configured default — the
    // picker already warns the user about that case.
    const currencies = new Set(
      cacheRes.rows
        .map((r) => (r.currency_code ?? "").trim())
        .filter((c) => c.length > 0),
    );
    const depositCurrency =
      currencies.size === 1
        ? normalizeCurrency(Array.from(currencies)[0], settings.currency)
        : settings.currency;

    // Auto-detect cust_code / cust_name / sale info from bills if not provided
    const firstWithCust = cacheRes.rows.find((r) => r.cust_code);
    const firstWithSale = cacheRes.rows.find((r) => r.sale_code);
    const detectedCustCode = custCode ?? firstWithCust?.cust_code ?? null;
    const detectedCustName = custName ?? firstWithCust?.cust_name ?? null;
    const detectedSaleCode = firstWithSale?.sale_code ?? null;
    const detectedSaleName = firstWithSale?.sale_name ?? null;

    const insHeader = await client.query<{ deposit_id: number }>(
      `INSERT INTO public.wms_deposit (
         deposit_code, wh_code, cust_code, cust_name,
         sale_code, sale_name,
         start_date, status,
         fee_model,
         free_days_max,
         tier1_days_max, tier1_pct,
         tier2_days_max, tier2_pct,
         tier3_days_max, tier3_pct,
         tier4_pct,
         min_charge, max_charge, currency,
         total_items, total_qty, total_value,
         note, created_by
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6,
         $7::date, 'active',
         $8,
         $9,
         $10, $11,
         $12, $13,
         $14, $15,
         $16,
         $17, $18, $19,
         $20, $21, $22,
         $23, $24
       )
       RETURNING deposit_id`,
      [
        code,
        wh,
        detectedCustCode,
        detectedCustName,
        detectedSaleCode,
        detectedSaleName,
        startDate,
        settings.fee_model,
        settings.free_days_max,
        settings.tier1_days_max,
        settings.tier1_pct,
        settings.tier2_days_max,
        settings.tier2_pct,
        settings.tier3_days_max,
        settings.tier3_pct,
        settings.tier4_pct,
        settings.min_charge,
        settings.max_charge,
        depositCurrency,
        totalItems,
        totalQty,
        totalValue,
        note,
        session.employee_id,
      ],
    );
    const depositId = insHeader.rows[0].deposit_id;

    // Insert bill snapshot rows (with value_sum + cust_name + sale info + currency)
    for (const r of cacheRes.rows) {
      await client.query(
        `INSERT INTO public.wms_deposit_bill (
           deposit_id, doc_no, trans_flag, doc_date,
           cust_code, cust_name, sale_code, sale_name,
           currency_code,
           lines, items, qty_sum, value_sum
         ) VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          depositId,
          r.doc_no,
          r.trans_flag,
          r.doc_date,
          r.cust_code,
          r.cust_name,
          r.sale_code,
          r.sale_name,
          r.currency_code,
          r.lines,
          r.items,
          r.qty_sum,
          r.value_sum,
        ],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, deposit_id: depositId, deposit_code: code });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("create deposit failed:", err);
    return NextResponse.json(
      { error: "ບັນທຶກບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import {
  recalcDepositTotals,
  requireDepositAccess,
} from "@/lib/deposit-server";

/**
 * Add bills to / remove bills from an active deposit. Header totals
 * (items / qty / value) are re-summed from the snapshot rows afterwards so the
 * fee always matches what is actually being stored.
 *
 * Only active deposits can be edited — a settled one must be reopened first,
 * otherwise the recorded payment would no longer match the goods.
 */

async function guardActive(id: string) {
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 }),
    };
  }
  const guard = await requireDepositAccess(depositId);
  if (!guard.ok) return guard;
  if (guard.row.status !== "active") {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "ແກ້ໄຂໄດ້ສະເພາະຮັບຝາກທີ່ຍັງ active" },
        { status: 409 },
      ),
    };
  }
  return guard;
}

/** POST { bills: [{ doc_no, trans_flag }] } — attach more bills. */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const guard = await guardActive(id);
  if (!guard.ok) return guard.response;
  const depositId = guard.row.deposit_id;

  let body: { bills?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const docNos: string[] = [];
  const flags: number[] = [];
  for (const b of Array.isArray(body.bills) ? body.bills : []) {
    if (!b || typeof b !== "object") continue;
    const rec = b as { doc_no?: unknown; trans_flag?: unknown };
    const docNo = typeof rec.doc_no === "string" ? rec.doc_no.trim() : "";
    const flag =
      typeof rec.trans_flag === "number"
        ? rec.trans_flag
        : Number.parseInt(String(rec.trans_flag ?? ""), 10);
    if (!docNo || !Number.isFinite(flag)) continue;
    docNos.push(docNo);
    flags.push(flag);
  }
  if (docNos.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກບິນຢ່າງໜ້ອຍ 1 ບິນ" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Snapshot straight from the cache, skipping bills already attached here
    // or held by another active deposit.
    const ins = await client.query(
      `INSERT INTO public.wms_deposit_bill (
         deposit_id, doc_no, trans_flag, doc_date,
         cust_code, cust_name, sale_code, sale_name, currency_code,
         lines, items, qty_sum, value_sum
       )
       SELECT $1, c.doc_no, c.trans_flag, c.doc_date,
              c.cust_code, c.cust_name, c.sale_code, c.sale_name, c.currency_code,
              c.lines, c.items, c.qty_sum, c.value_sum
       FROM public.wms_pending_bill_cache c
       JOIN UNNEST($2::varchar[], $3::smallint[]) AS x(doc_no, trans_flag)
         ON x.doc_no = c.doc_no AND x.trans_flag = c.trans_flag
       WHERE c.wh_code = $4
         AND NOT EXISTS (
           SELECT 1 FROM public.wms_deposit_bill db
           JOIN public.wms_deposit d ON d.deposit_id = db.deposit_id
           WHERE db.doc_no = c.doc_no AND db.trans_flag = c.trans_flag
             AND d.status = 'active' AND d.deposit_id <> $1
         )
       ON CONFLICT (deposit_id, doc_no, trans_flag) DO NOTHING`,
      [depositId, docNos, flags, guard.row.wh_code],
    );

    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          error:
            "ບໍ່ໄດ້ເພີ່ມບິນ — ບິນອາດຢູ່ໃນຮັບຝາກອື່ນແລ້ວ ຫຼື ບໍ່ພົບໃນ cache ຂອງສາງນີ້",
        },
        { status: 400 },
      );
    }

    await recalcDepositTotals(client, depositId);
    await client.query(
      `UPDATE public.wms_deposit
          SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
        WHERE deposit_id = $1`,
      [depositId, guard.session.employee_id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, added: ins.rowCount });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("add deposit bills failed:", err);
    return NextResponse.json({ error: "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/** DELETE ?doc_no=..&trans_flag=.. — detach one bill. */
export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const guard = await guardActive(id);
  if (!guard.ok) return guard.response;
  const depositId = guard.row.deposit_id;

  const url = new URL(request.url);
  const docNo = (url.searchParams.get("doc_no") ?? "").trim();
  const flag = Number.parseInt(url.searchParams.get("trans_flag") ?? "", 10);
  if (!docNo || !Number.isFinite(flag)) {
    return NextResponse.json(
      { error: "ຕ້ອງລະບຸ doc_no ແລະ trans_flag" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const del = await client.query(
      `DELETE FROM public.wms_deposit_bill
        WHERE deposit_id = $1 AND doc_no = $2 AND trans_flag = $3`,
      [depositId, docNo, flag],
    );
    if (del.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບບິນນີ້" }, { status: 404 });
    }

    const left = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.wms_deposit_bill WHERE deposit_id = $1`,
      [depositId],
    );
    if (Number.parseInt(left.rows[0]?.n ?? "0", 10) === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ຕ້ອງເຫຼືອຢ່າງໜ້ອຍ 1 ບິນ — ຖ້າບໍ່ຝາກແລ້ວໃຫ້ຍົກເລີກຮັບຝາກ" },
        { status: 400 },
      );
    }

    await recalcDepositTotals(client, depositId);
    await client.query(
      `UPDATE public.wms_deposit
          SET updated_at = CURRENT_TIMESTAMP, updated_by = $2
        WHERE deposit_id = $1`,
      [depositId, guard.session.employee_id],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("remove deposit bill failed:", err);
    return NextResponse.json({ error: "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

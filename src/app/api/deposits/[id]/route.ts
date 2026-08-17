import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { calculateFee } from "@/lib/deposit";
import { requireDepositAccess } from "@/lib/deposit-server";

type Action = "settle" | "cancel" | "reopen";

/**
 * Settle, cancel, or reopen a deposit.
 *
 * Body: {
 *   action: 'settle' | 'cancel' | 'reopen',
 *   end_date?: string,       // for settle, defaults to today
 *   payment_method?: 'cash' | 'transfer' | 'other',
 *   payment_reference?: string,
 *   override_fee?: number,   // optional manual override
 *   note?: string
 * }
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireDepositAccess(depositId);
  if (!guard.ok) return guard.response;

  let body: {
    action?: unknown;
    end_date?: unknown;
    payment_method?: unknown;
    payment_reference?: unknown;
    override_fee?: unknown;
    note?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const action: Action | null =
    body.action === "settle" ||
    body.action === "cancel" ||
    body.action === "reopen"
      ? (body.action as Action)
      : null;
  if (!action) {
    return NextResponse.json({ error: "action ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (action === "settle") {
      if (guard.row.status !== "active") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "ຮັບຝາກນີ້ບໍ່ໄດ້ຢູ່ໃນສະຖານະ active" },
          { status: 409 },
        );
      }
      const endDate =
        typeof body.end_date === "string" && body.end_date.trim()
          ? body.end_date.trim()
          : new Date().toISOString().slice(0, 10);

      const calc = calculateFee({
        start_date: guard.row.start_date,
        end_date: endDate,
        free_days_max: guard.row.free_days_max,
        tier1_days_max: guard.row.tier1_days_max,
        tier1_pct: guard.row.tier1_pct,
        tier2_days_max: guard.row.tier2_days_max,
        tier2_pct: guard.row.tier2_pct,
        tier3_days_max: guard.row.tier3_days_max,
        tier3_pct: guard.row.tier3_pct,
        tier4_pct: guard.row.tier4_pct,
        min_charge: guard.row.min_charge,
        max_charge: guard.row.max_charge,
        total_value: guard.row.total_value,
      });

      const overrideRaw = body.override_fee;
      const override =
        typeof overrideRaw === "number"
          ? overrideRaw
          : typeof overrideRaw === "string"
            ? Number.parseFloat(overrideRaw)
            : null;
      const finalFee =
        override !== null && Number.isFinite(override) && override >= 0
          ? override
          : calc.fee;

      const method =
        body.payment_method === "transfer" || body.payment_method === "other"
          ? body.payment_method
          : "cash";
      const reference =
        typeof body.payment_reference === "string"
          ? body.payment_reference.trim() || null
          : null;
      const note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : null;

      await client.query(
        `UPDATE public.wms_deposit
         SET status = 'settled',
             end_date = $2::date,
             settled_fee = $3,
             settled_days = $4,
             settled_by = $5,
             settled_at = CURRENT_TIMESTAMP,
             note = COALESCE($6, note)
         WHERE deposit_id = $1`,
        [
          depositId,
          endDate,
          finalFee,
          calc.duration_days,
          guard.session.employee_id,
          note,
        ],
      );

      await client.query(
        `INSERT INTO public.wms_deposit_payment (
           deposit_id, amount, currency, method, reference,
           received_by, note
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          depositId,
          finalFee,
          guard.row.currency,
          method,
          reference,
          guard.session.employee_id,
          note,
        ],
      );

      await client.query("COMMIT");
      return NextResponse.json({
        ok: true,
        fee: finalFee,
        duration_days: calc.duration_days,
        tier: calc.tier,
        applied_pct: calc.applied_pct,
      });
    }

    if (action === "cancel") {
      if (guard.row.status !== "active") {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "ຍົກເລີກໄດ້ສະເພາະຮັບຝາກ active" },
          { status: 409 },
        );
      }
      const note =
        typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : null;
      await client.query(
        `UPDATE public.wms_deposit
         SET status = 'cancelled',
             end_date = CURRENT_DATE,
             settled_by = $2,
             settled_at = CURRENT_TIMESTAMP,
             note = COALESCE($3, note)
         WHERE deposit_id = $1`,
        [depositId, guard.session.employee_id, note],
      );
      await client.query("COMMIT");
      return NextResponse.json({ ok: true });
    }

    // reopen
    if (guard.row.status === "active") {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true });
    }
    if (guard.session.role !== "manager") {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ສະເພາະຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດເປີດຄືນ" },
        { status: 403 },
      );
    }
    // Wipe any payment rows on reopen — preserves correctness if user later re-settles.
    await client.query(
      `DELETE FROM public.wms_deposit_payment WHERE deposit_id = $1`,
      [depositId],
    );
    await client.query(
      `UPDATE public.wms_deposit
       SET status = 'active',
           end_date = NULL,
           settled_fee = NULL,
           settled_days = NULL,
           settled_by = NULL,
           settled_at = NULL
       WHERE deposit_id = $1`,
      [depositId],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("deposit action failed:", err);
    return NextResponse.json(
      { error: "ບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

/**
 * Edit the header of an active deposit: start date (which drives the fee),
 * customer, and note. Settled/cancelled deposits are frozen — reopen first.
 *
 * Body: { start_date?, cust_code?, cust_name?, note? }
 */
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireDepositAccess(depositId);
  if (!guard.ok) return guard.response;
  if (guard.row.status !== "active") {
    return NextResponse.json(
      { error: "ແກ້ໄຂໄດ້ສະເພາະຮັບຝາກທີ່ຍັງ active" },
      { status: 409 },
    );
  }

  let body: {
    start_date?: unknown;
    cust_code?: unknown;
    cust_name?: unknown;
    note?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const startDate =
    typeof body.start_date === "string" && body.start_date.trim()
      ? body.start_date.trim()
      : guard.row.start_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json(
      { error: "ວັນທີ່ເລີ່ມຝາກບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  await query(
    `UPDATE public.wms_deposit
        SET start_date = $2::date,
            cust_code  = $3,
            cust_name  = $4,
            note       = $5,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = $6
      WHERE deposit_id = $1`,
    [
      depositId,
      startDate,
      text(body.cust_code),
      text(body.cust_name),
      text(body.note),
      guard.session.employee_id,
    ],
  );

  return NextResponse.json({ ok: true });
}

/**
 * Hard-delete a deposit (manager-only). Cascades to bill snapshot rows and
 * payment rows via the FK ON DELETE CASCADE on those tables.
 *
 * Deleting a settled deposit removes the recorded revenue — only managers
 * are allowed and the client must show a strong confirm before calling.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireDepositAccess(depositId);
  if (!guard.ok) return guard.response;

  if (guard.session.role !== "manager") {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດລົບການຮັບຝາກ" },
      { status: 403 },
    );
  }

  await query(`DELETE FROM public.wms_deposit WHERE deposit_id = $1`, [
    depositId,
  ]);
  return NextResponse.json({ ok: true });
}

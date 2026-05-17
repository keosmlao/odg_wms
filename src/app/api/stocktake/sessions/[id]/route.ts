import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import {
  PENDING_INSERT_SQL,
  SESSION_SELECT_FIELDS,
  SNAPSHOT_INSERT_SQL,
  requireSessionAccess,
  trimOrNull,
  type SessionRow,
} from "@/lib/stocktake";

type Action = "submit" | "approve" | "reject" | "reopen" | "update";

function canApprove(role: string | null) {
  return role === "manager" || role === "supervisor";
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  // Detect action. New API uses body.action; legacy uses body.status.
  let action: Action = "update";
  if (typeof body.action === "string") {
    const a = body.action as Action;
    if (
      a === "submit" ||
      a === "approve" ||
      a === "reject" ||
      a === "reopen"
    ) {
      action = a;
    }
  } else if (body.status === "closed") {
    action = "submit";
  } else if (body.status === "open") {
    action = "reopen";
  }

  // Only require open status for plain updates (rename / blind toggle).
  const guard = await requireSessionAccess(sessionId, {
    mustBeOpen: action === "update",
  });
  if (!guard.ok) return guard.response;

  // Permission: blind toggle is supervisor/manager only — counters cannot
  // unmask SML balance for themselves.
  if (body.blind !== undefined && !canApprove(guard.session.role)) {
    return NextResponse.json(
      {
        error:
          "ສະເພາະ supervisor / ຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດປ່ຽນ Blind mode",
      },
      { status: 403 },
    );
  }

  const fields: string[] = [];
  const args: unknown[] = [];

  // Common updateable fields (allowed only while open).
  if (action === "update" || action === "reject") {
    if (body.name !== undefined) {
      args.push(trimOrNull(body.name));
      fields.push(`name = $${args.length}`);
    }
    if (body.note !== undefined) {
      args.push(trimOrNull(body.note));
      fields.push(`note = $${args.length}`);
    }
    if (body.blind !== undefined) {
      args.push(body.blind === false ? false : true);
      fields.push(`blind = $${args.length}`);
    }
  }

  // Workflow transitions.
  if (action === "submit") {
    if (guard.row.status !== "open") {
      return NextResponse.json(
        { error: "ສະຖານະບໍ່ໃຫ້ສົ່ງອະນຸມັດ" },
        { status: 409 },
      );
    }
    args.push(guard.session.employee_id);
    fields.push(`submitted_by = $${args.length}`);
    fields.push(`submitted_at = CURRENT_TIMESTAMP`);
    fields.push(`status = 'pending_approval'`);
  } else if (action === "approve") {
    if (!canApprove(guard.session.role)) {
      return NextResponse.json(
        { error: "ສະເພາະ supervisor / ຜູ້ຈັດການເທົ່ານັ້ນ" },
        { status: 403 },
      );
    }
    if (guard.row.status !== "pending_approval") {
      return NextResponse.json(
        { error: "ສະຖານະບໍ່ໃຫ້ອະນຸມັດ" },
        { status: 409 },
      );
    }
    args.push(guard.session.employee_id);
    fields.push(`approved_by = $${args.length}`);
    fields.push(`closed_at = CURRENT_TIMESTAMP`);
    fields.push(`status = 'closed'`);
    if (body.approval_note !== undefined) {
      args.push(trimOrNull(body.approval_note));
      fields.push(`approval_note = $${args.length}`);
    }
  } else if (action === "reject") {
    if (!canApprove(guard.session.role)) {
      return NextResponse.json(
        { error: "ສະເພາະ supervisor / ຜູ້ຈັດການເທົ່ານັ້ນ" },
        { status: 403 },
      );
    }
    if (guard.row.status !== "pending_approval") {
      return NextResponse.json(
        { error: "ສະຖານະບໍ່ໃຫ້ປະຕິເສດ" },
        { status: 409 },
      );
    }
    fields.push(`submitted_by = NULL`);
    fields.push(`submitted_at = NULL`);
    fields.push(`status = 'open'`);
    if (body.approval_note !== undefined) {
      args.push(trimOrNull(body.approval_note));
      fields.push(`approval_note = $${args.length}`);
    }
  } else if (action === "reopen") {
    if (!canApprove(guard.session.role)) {
      return NextResponse.json(
        { error: "ສະເພາະ supervisor / ຜູ້ຈັດການເທົ່ານັ້ນ" },
        { status: 403 },
      );
    }
    if (guard.row.status === "open") {
      return NextResponse.json({ ok: true, session: guard.row });
    }
    fields.push(`closed_at = NULL`);
    fields.push(`approved_by = NULL`);
    fields.push(`submitted_by = NULL`);
    fields.push(`submitted_at = NULL`);
    fields.push(`status = 'open'`);
  }

  if (fields.length === 0) {
    return NextResponse.json({ ok: true, session: guard.row });
  }

  // For `reopen` after a real close, the frozen snapshot is stale (movements
  // happened during the closed window). Refresh it in the same transaction
  // so the variance comparison stays consistent.
  const needsResnapshot =
    action === "reopen" && guard.row.status === "closed";

  if (!needsResnapshot) {
    args.push(sessionId);
    const rows = await query<SessionRow>(
      `UPDATE public.wms_stocktake_session
       SET ${fields.join(", ")}
       WHERE session_id = $${args.length}
       RETURNING ${SESSION_SELECT_FIELDS}`,
      args,
    );
    return NextResponse.json({ ok: true, session: rows[0] });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    args.push(sessionId);
    const upd = await client.query(
      `UPDATE public.wms_stocktake_session
       SET ${fields.join(", ")}
       WHERE session_id = $${args.length}
       RETURNING ${SESSION_SELECT_FIELDS}`,
      args,
    );
    const row = upd.rows[0] as SessionRow;

    // Wipe old snapshot + pending and re-take from current SML state.
    await client.query(
      `DELETE FROM public.wms_stocktake_snapshot WHERE session_id = $1`,
      [sessionId],
    );
    await client.query(
      `DELETE FROM public.wms_stocktake_pending WHERE session_id = $1`,
      [sessionId],
    );
    await client.query(SNAPSHOT_INSERT_SQL, [sessionId, row.wh_code]);
    await client.query(PENDING_INSERT_SQL, [sessionId, row.wh_code]);

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, session: row, snapshot_refreshed: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("reopen session failed:", err);
    return NextResponse.json(
      { error: "ເປີດຄືນບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const guard = await requireSessionAccess(sessionId);
  if (!guard.ok) return guard.response;

  if (guard.session.role !== "manager") {
    return NextResponse.json(
      { error: "ສະເພາະຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດລຶບຮອບກວດນັບ" },
      { status: 403 },
    );
  }

  // Audit-trail protection: closed (approved) sessions are permanent records.
  // If you must remove one, reopen it first — that leaves a trace.
  if (guard.row.status === "closed") {
    return NextResponse.json(
      {
        error:
          "ບໍ່ສາມາດລຶບຮອບທີ່ປິດແລ້ວ — ກະລຸນາ 'ເປີດຄືນ' ກ່ອນ ຖ້າຈຳເປັນ",
      },
      { status: 409 },
    );
  }

  await query(
    `DELETE FROM public.wms_stocktake_session WHERE session_id = $1`,
    [sessionId],
  );
  return NextResponse.json({ ok: true });
}

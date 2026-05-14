import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  asNumericString,
  requireSessionAccess,
  trimOrNull,
} from "@/lib/stocktake";

async function loadLine(lineId: number) {
  const rows = await query<{
    line_id: number;
    session_id: number;
    label_id: number;
  }>(
    `SELECT line_id, session_id, label_id
     FROM public.wms_stocktake_line
     WHERE line_id = $1`,
    [lineId],
  );
  return rows[0] ?? null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const lineId = Number.parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const line = await loadLine(lineId);
  if (!line) {
    return NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 });
  }
  const guard = await requireSessionAccess(line.session_id, {
    mustBeOpen: true,
  });
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const fields: string[] = [];
  const args: unknown[] = [];

  if (body.qty !== undefined) {
    const q = asNumericString(body.qty);
    if (q === null) {
      return NextResponse.json({ error: "qty ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    }
    args.push(q);
    fields.push(`qty = $${args.length}`);
  }
  if (body.note !== undefined) {
    args.push(trimOrNull(body.note));
    fields.push(`note = $${args.length}`);
  }
  if (body.rack_code !== undefined) {
    args.push(trimOrNull(body.rack_code));
    fields.push(`rack_code = $${args.length}`);
  }
  if (body.location_code !== undefined) {
    args.push(trimOrNull(body.location_code));
    fields.push(`location_code = $${args.length}`);
  }

  if (fields.length === 0) {
    return NextResponse.json({ ok: true });
  }

  args.push(lineId);
  await query(
    `UPDATE public.wms_stocktake_line SET ${fields.join(", ")} WHERE line_id = $${args.length}`,
    args,
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const lineId = Number.parseInt(id, 10);
  if (!Number.isFinite(lineId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const line = await loadLine(lineId);
  if (!line) {
    return NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 });
  }
  const guard = await requireSessionAccess(line.session_id, {
    mustBeOpen: true,
  });
  if (!guard.ok) return guard.response;

  await query(`DELETE FROM public.wms_stocktake_line WHERE line_id = $1`, [
    lineId,
  ]);
  return NextResponse.json({ ok: true });
}

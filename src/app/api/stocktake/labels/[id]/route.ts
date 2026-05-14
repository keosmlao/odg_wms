import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSessionAccess, trimOrNull } from "@/lib/stocktake";

async function loadLabel(labelId: number) {
  const rows = await query<{ label_id: number; session_id: number }>(
    `SELECT label_id, session_id FROM public.wms_stocktake_label WHERE label_id = $1`,
    [labelId],
  );
  return rows[0] ?? null;
}

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const labelId = Number.parseInt(id, 10);
  if (!Number.isFinite(labelId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const label = await loadLabel(labelId);
  if (!label) {
    return NextResponse.json({ error: "ບໍ່ພົບປ້າຍ" }, { status: 404 });
  }
  const guard = await requireSessionAccess(label.session_id, {
    mustBeOpen: true,
  });
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const note = trimOrNull(body.note);
  await query(
    `UPDATE public.wms_stocktake_label SET note = $1 WHERE label_id = $2`,
    [note, labelId],
  );
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const labelId = Number.parseInt(id, 10);
  if (!Number.isFinite(labelId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const label = await loadLabel(labelId);
  if (!label) {
    return NextResponse.json({ error: "ບໍ່ພົບປ້າຍ" }, { status: 404 });
  }
  const guard = await requireSessionAccess(label.session_id, {
    mustBeOpen: true,
  });
  if (!guard.ok) return guard.response;

  await query(`DELETE FROM public.wms_stocktake_label WHERE label_id = $1`, [
    labelId,
  ]);
  return NextResponse.json({ ok: true });
}

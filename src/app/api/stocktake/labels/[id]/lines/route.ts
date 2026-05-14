import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  asNumericString,
  requireSessionAccess,
  trimOrNull,
} from "@/lib/stocktake";

type LineRow = {
  line_id: number;
  session_id: number;
  label_id: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
  counted_by: number | null;
  counted_at: string;
};

async function loadLabel(labelId: number) {
  const rows = await query<{ label_id: number; session_id: number }>(
    `SELECT label_id, session_id FROM public.wms_stocktake_label WHERE label_id = $1`,
    [labelId],
  );
  return rows[0] ?? null;
}

export async function POST(
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

  const itemCode = trimOrNull(body.item_code);
  if (!itemCode) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸລະຫັດສິນຄ້າ" },
      { status: 400 },
    );
  }
  const qty = asNumericString(body.qty);
  if (qty === null) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸຈຳນວນ" },
      { status: 400 },
    );
  }

  const itemName = trimOrNull(body.item_name);
  const unitCode = trimOrNull(body.unit_code);
  const note = trimOrNull(body.note);
  const rackCode = trimOrNull(body.rack_code);
  const locationCode = trimOrNull(body.location_code);

  const rows = await query<LineRow>(
    `INSERT INTO public.wms_stocktake_line
       (session_id, label_id, item_code, item_name, unit_code,
        qty, note, rack_code, location_code, counted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING line_id, session_id, label_id, item_code, item_name, unit_code,
               qty::text AS qty, note, rack_code, location_code,
               counted_by, counted_at::text AS counted_at`,
    [
      label.session_id,
      labelId,
      itemCode,
      itemName,
      unitCode,
      qty,
      note,
      rackCode,
      locationCode,
      guard.session.employee_id,
    ],
  );

  return NextResponse.json({ ok: true, line: rows[0] });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireSessionAccess, trimOrNull } from "@/lib/stocktake";

type LabelRow = {
  label_id: number;
  session_id: number;
  label_code: string;
  note: string | null;
};

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireSessionAccess(sessionId, { mustBeOpen: true });
  if (!guard.ok) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const codes: string[] = [];

  // Mode A: explicit list of codes
  if (Array.isArray(body.codes)) {
    for (const c of body.codes) {
      const v = trimOrNull(c);
      if (v) codes.push(v);
    }
  }

  // Mode B: prefix + start + end (+ optional padding)
  const prefix = trimOrNull(body.prefix);
  const start = Number.parseInt(String(body.start ?? ""), 10);
  const end = Number.parseInt(String(body.end ?? ""), 10);
  const padding = Math.max(
    1,
    Math.min(6, Number.parseInt(String(body.padding ?? "2"), 10) || 2),
  );
  if (
    prefix &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end >= start
  ) {
    const total = end - start + 1;
    if (total > 500) {
      return NextResponse.json(
        { error: "ບໍ່ສາມາດສ້າງເກີນ 500 ປ້າຍຕໍ່ຄັ້ງ" },
        { status: 400 },
      );
    }
    for (let n = start; n <= end; n++) {
      codes.push(`${prefix}${String(n).padStart(padding, "0")}`);
    }
  }

  if (codes.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸລາຍການປ້າຍ ຫຼື prefix+start+end" },
      { status: 400 },
    );
  }

  // De-dup within the request
  const uniq = Array.from(new Set(codes));

  const inserted: LabelRow[] = [];
  for (const code of uniq) {
    const rows = await query<LabelRow>(
      `INSERT INTO public.wms_stocktake_label
         (session_id, label_code, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, label_code) DO NOTHING
       RETURNING label_id, session_id, label_code, note`,
      [sessionId, code, guard.session.employee_id],
    );
    if (rows[0]) inserted.push(rows[0]);
  }

  return NextResponse.json({
    ok: true,
    requested: uniq.length,
    inserted: inserted.length,
    skipped: uniq.length - inserted.length,
    labels: inserted,
  });
}

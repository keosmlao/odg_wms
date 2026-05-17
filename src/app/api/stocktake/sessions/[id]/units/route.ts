import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { requireSessionAccess, trimOrNull } from "@/lib/stocktake";

type UpdateBody = {
  line_id?: number | string;
  line_ids?: Array<number | string>;
  item_code?: string | null;
  new_unit_code?: string | null;
  note?: string | null;
};

type LineRow = {
  line_id: number;
  session_id: number;
  item_code: string;
  unit_code: string | null;
};

function sameUnit(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? "").trim().toUpperCase() === (b ?? "").trim().toUpperCase();
}

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

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const lineIds = Array.isArray(body.line_ids)
    ? body.line_ids
        .map((v) => Number.parseInt(String(v), 10))
        .filter(Number.isFinite)
    : [];
  const lineId = Number.parseInt(String(body.line_id ?? ""), 10);
  if (Number.isFinite(lineId)) lineIds.push(lineId);
  const uniqueLineIds = Array.from(new Set(lineIds));
  const itemCode = trimOrNull(body.item_code);
  if (uniqueLineIds.length === 0 && !itemCode) {
    return NextResponse.json(
      { error: "line_id ຫຼື item_code ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }

  const newUnit = trimOrNull(body.new_unit_code);
  if (newUnit && newUnit.length > 20) {
    return NextResponse.json(
      { error: "ຫົວໜ່ວຍຍາວເກີນ 20 ຕົວ" },
      { status: 400 },
    );
  }
  const note = trimOrNull(body.note);
  if (note && note.length > 200) {
    return NextResponse.json(
      { error: "ຄຳອະທິບາຍຍາວເກີນ 200 ຕົວ" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const where: string[] = ["session_id = $1"];
    const args: unknown[] = [sessionId];
    if (uniqueLineIds.length > 0) {
      args.push(uniqueLineIds);
      where.push(`line_id = ANY($${args.length})`);
    }
    if (itemCode) {
      args.push(itemCode);
      where.push(`item_code = $${args.length}`);
    }

    const cur = await client.query<LineRow>(
      `SELECT line_id, session_id, item_code, unit_code
       FROM public.wms_stocktake_line
       WHERE ${where.join(" AND ")}
       ORDER BY line_id
       FOR UPDATE`,
      args,
    );
    const lines = cur.rows;
    if (lines.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ບໍ່ພົບລາຍການກວດນັບ" },
        { status: 404 },
      );
    }
    if (uniqueLineIds.length > 0 && lines.length !== uniqueLineIds.length) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ບາງ line_id ບໍ່ຢູ່ໃນຮອບກວດນັບນີ້" },
        { status: 400 },
      );
    }

    const changed = lines.filter((line) => !sameUnit(line.unit_code, newUnit));
    if (changed.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          ok: true,
          unchanged: true,
          updated_count: 0,
          unit_code: newUnit,
        },
      );
    }

    await client.query(
      `UPDATE public.wms_stocktake_line
       SET unit_code = $1
       WHERE line_id = ANY($2)`,
      [newUnit, changed.map((line) => line.line_id)],
    );

    for (const line of changed) {
      await client.query(
        `INSERT INTO public.wms_stocktake_unit_log
           (session_id, line_id, item_code, old_unit_code, new_unit_code,
            changed_by, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          sessionId,
          line.line_id,
          line.item_code,
          line.unit_code ?? null,
          newUnit,
          guard.session.employee_id,
          note,
        ],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      updated_count: changed.length,
      line_ids: changed.map((line) => line.line_id),
      item_codes: Array.from(new Set(changed.map((line) => line.item_code))),
      new_unit_code: newUnit,
      compare_url: `/stocktake/${sessionId}/report?scope=counted&filter=variance`,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

type HistoryRow = {
  log_id: number;
  line_id: number;
  item_code: string;
  old_unit_code: string | null;
  new_unit_code: string | null;
  changed_at: string;
  changed_by_name: string | null;
  note: string | null;
};

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireSessionAccess(sessionId);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const itemCode = url.searchParams.get("item_code")?.trim() || null;
  const lineId = Number.parseInt(url.searchParams.get("line_id") ?? "", 10);

  const where: string[] = ["l.session_id = $1"];
  const params: unknown[] = [sessionId];
  if (itemCode) {
    params.push(itemCode);
    where.push(`l.item_code = $${params.length}`);
  }
  if (Number.isFinite(lineId)) {
    params.push(lineId);
    where.push(`l.line_id = $${params.length}`);
  }

  const rows = await query<HistoryRow>(
    `SELECT
       l.log_id,
       l.line_id,
       l.item_code,
       l.old_unit_code,
       l.new_unit_code,
       l.changed_at::text       AS changed_at,
       e.fullname_lo            AS changed_by_name,
       l.note
     FROM public.wms_stocktake_unit_log l
     LEFT JOIN public.odg_employee e ON e.employee_id = l.changed_by
     WHERE ${where.join(" AND ")}
     ORDER BY l.changed_at DESC, l.log_id DESC
     LIMIT 200`,
    params,
  );
  return NextResponse.json({ ok: true, history: rows });
}

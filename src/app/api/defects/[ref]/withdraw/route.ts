import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { logDefectHistory } from "@/lib/defects";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Mark a defect entry as issued out (ເບີກຈ່າຍ) — status 0 → 1. It then drops off
 * the "ຍັງບໍ່ເບີກຈ່າຍ" report and appears on the "ເບີກຈ່າຍແລ້ວ" one.
 * Mirrors the legacy `withdraw_productdf`, plus an audit round.
 *
 * POST /api/defects/<code_ref>/withdraw
 * Body: { undo?: boolean } — `undo` puts the entry back to status 0.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { ref } = await params;
  let undo = false;
  try {
    const body = (await request.json()) as { undo?: unknown };
    undo = body.undo === true;
  } catch {
    // No body → plain withdraw.
  }

  const rows = await query<{ warehouse: string | null; status: number }>(
    `SELECT warehouse, status FROM public.odg_product_defect WHERE code_ref = $1`,
    [ref],
  );
  if (rows.length === 0) return NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 });
  const current = rows[0];

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (!current.warehouse || !accessible.includes(current.warehouse))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const target = undo ? DEFECT_STATUS.pending : DEFECT_STATUS.dispatched;
  if (current.status === target) {
    return NextResponse.json(
      { error: undo ? "ລາຍການນີ້ຍັງບໍ່ໄດ້ເບີກຈ່າຍ" : "ລາຍການນີ້ເບີກຈ່າຍໄປແລ້ວ" },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE public.odg_product_defect SET status = $1 WHERE code_ref = $2`, [
      target,
      ref,
    ]);
    await logDefectHistory(client, ref, current.warehouse ?? "", session.employee_code);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, status: target });
}

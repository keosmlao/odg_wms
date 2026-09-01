import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { logDefectHistory } from "@/lib/defects";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Issue out (or un-issue) many defect entries at once.
 *
 * Almost every entry is a single serialised unit — 1,048 of 1,057 have qty 1 —
 * so issuing a batch one row at a time would mean dozens of round trips. This
 * does the whole selection in one transaction: either all of it lands or none.
 *
 * POST /api/defects/withdraw-bulk
 * Body: { refs: string[], undo?: boolean }
 */
const MAX_REFS = 500;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: { refs?: unknown; undo?: unknown };
  try {
    body = (await request.json()) as { refs?: unknown; undo?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const undo = body.undo === true;
  const refs = Array.isArray(body.refs)
    ? Array.from(new Set(body.refs.map((r) => (typeof r === "string" ? r.trim() : "")).filter(Boolean)))
    : [];
  if (refs.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ໄດ້ເລືອກລາຍການ" }, { status: 400 });
  }
  if (refs.length > MAX_REFS) {
    return NextResponse.json(
      { error: `ເລືອກໄດ້ສູງສຸດ ${MAX_REFS} ລາຍການຕໍ່ຄັ້ງ` },
      { status: 400 },
    );
  }

  // Every selected entry must exist, be in scope, and still be on the side we
  // are moving it away from — checked up front so a bad selection changes nothing.
  const found = await query<{ code_ref: string; warehouse: string | null; status: number }>(
    `SELECT code_ref, warehouse, status
     FROM public.odg_product_defect
     WHERE code_ref = ANY($1)`,
    [refs],
  );
  if (found.length !== refs.length) {
    const missing = refs.filter((r) => !found.some((f) => f.code_ref === r));
    return NextResponse.json(
      { error: `ບໍ່ພົບລາຍການ #${missing.slice(0, 5).join(", #")}` },
      { status: 404 },
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible)) {
    const denied = found.filter((f) => !f.warehouse || !accessible.includes(f.warehouse));
    if (denied.length > 0) {
      return NextResponse.json(
        { error: `ບໍ່ມີສິດເຂົ້າເຖິງສາງຂອງລາຍການ #${denied.slice(0, 5).map((d) => d.code_ref).join(", #")}` },
        { status: 403 },
      );
    }
  }

  const target = undo ? DEFECT_STATUS.pending : DEFECT_STATUS.dispatched;
  const alreadyThere = found.filter((f) => f.status === target);
  if (alreadyThere.length > 0) {
    return NextResponse.json(
      {
        error: undo
          ? `${alreadyThere.length} ລາຍການທີ່ເລືອກຍັງບໍ່ໄດ້ເບີກຈ່າຍ`
          : `${alreadyThere.length} ລາຍການທີ່ເລືອກເບີກຈ່າຍໄປແລ້ວ`,
      },
      { status: 400 },
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query(
      `UPDATE public.odg_product_defect SET status = $1 WHERE code_ref = ANY($2)`,
      [target, refs],
    );
    for (const f of found) {
      await logDefectHistory(client, f.code_ref, f.warehouse ?? "", session.employee_code);
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, changed: upd.rowCount ?? 0, status: target });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

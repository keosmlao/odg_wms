import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  SESSION_SELECT_FIELDS,
  nextSessionCode,
  trimOrNull,
  type SessionRow,
} from "@/lib/stocktake";

export async function POST(request: Request) {
  const userSession = await getSession();
  if (!userSession) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!userSession.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = trimOrNull(body.wh_code);
  if (!wh) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກສາງ" },
      { status: 400 },
    );
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const countDateRaw = trimOrNull(body.count_date);
  const countDate = countDateRaw ?? new Date().toISOString().slice(0, 10);
  const name = trimOrNull(body.name);
  const note = trimOrNull(body.note);
  // Keepers cannot start with blind=false (would let them peek SML during
  // counting). Only supervisor/manager can opt out of blind mode.
  const requestedBlind = body.blind === false ? false : true; // default TRUE
  const canDisableBlind =
    userSession.role === "manager" || userSession.role === "supervisor";
  const blind = canDisableBlind ? requestedBlind : true;

  const sessionCode = await nextSessionCode(countDate);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertRes = await client.query(
      `INSERT INTO public.wms_stocktake_session
         (session_code, wh_code, name, note, count_date, blind, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${SESSION_SELECT_FIELDS}`,
      [sessionCode, wh, name, note, countDate, blind, userSession.employee_id],
    );
    const row = insertRes.rows[0] as SessionRow;

    // Freeze the SML balance at session start so the variance report
    // does not drift as movements continue during counting.
    await client.query(
      `INSERT INTO public.wms_stocktake_snapshot
         (session_id, item_code, item_name, unit_code, snapshot_qty)
       SELECT
         $1,
         t.item_code,
         MAX(t.item_name),
         MAX(t.unit_code),
         SUM(t.qty * t.calc_flag)::numeric
       FROM public.odg_wms_trans_detail t
       WHERE (t.status = 0 OR t.status IS NULL)
         AND t.wh_code = $2
         AND t.item_code IS NOT NULL
         AND t.item_code <> ''
       GROUP BY t.item_code
       HAVING SUM(t.qty * t.calc_flag) <> 0`,
      [row.session_id, wh],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, session: row });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("create stocktake session failed:", err);
    return NextResponse.json(
      { error: "ສ້າງຮອບກວດນັບບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

type ItemRow = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  balance_qty: string | null;
};

type SessionContext = {
  session_id: number;
  wh_code: string;
  blind: boolean;
};

/**
 * Escape LIKE wildcards so user input "%" or "_" doesn't act as a wildcard.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Search items for the given stocktake session.
 *
 * Search pool = items that have ever moved in the warehouse
 * (`odg_wms_trans_detail`) — broader than the snapshot so counters can find
 * brand-new items not yet in the baseline.
 *
 * Balance shown = the frozen snapshot (`wms_stocktake_snapshot`), so the
 * counter sees the same baseline the variance report compares against.
 *
 * Blind enforcement: if `session.blind = true` AND the caller is not a
 * supervisor/manager, the `balance_qty` field is set to NULL — preventing
 * Network-tab leakage of the SML balance to the counter.
 */
export async function GET(request: Request) {
  const userSession = await getSession();
  if (!userSession) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!userSession.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const sessionIdRaw = url.searchParams.get("session_id")?.trim();
  const sessionId = Number.parseInt(sessionIdRaw ?? "", 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json(
      { error: "session_id ຈຳເປັນ" },
      { status: 400 },
    );
  }

  const ctx = (
    await query<SessionContext>(
      `SELECT session_id, wh_code, blind
       FROM public.wms_stocktake_session
       WHERE session_id = $1`,
      [sessionId],
    )
  )[0];
  if (!ctx) {
    return NextResponse.json({ error: "ບໍ່ພົບຮອບກວດນັບ" }, { status: 404 });
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(ctx.wh_code)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const canSeeBalance =
    !ctx.blind ||
    userSession.role === "supervisor" ||
    userSession.role === "manager";

  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.max(
    1,
    Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );

  // Search source: distinct items in trans_detail for the warehouse.
  // Balance source: snapshot for the session (frozen baseline).
  const rows = q
    ? await query<ItemRow>(
        `WITH hits AS (
           SELECT
             t.item_code,
             MAX(t.item_name) AS item_name,
             MAX(t.unit_code) AS unit_code
           FROM public.odg_wms_trans_detail t
           WHERE (t.status = 0 OR t.status IS NULL)
             AND t.wh_code = $1
             AND t.item_code IS NOT NULL
             AND t.item_code <> ''
             AND (t.item_code ILIKE $2 ESCAPE '\\'
                  OR t.item_name ILIKE $2 ESCAPE '\\')
           GROUP BY t.item_code
         )
         SELECT
           h.item_code,
           COALESCE(ss.item_name, h.item_name) AS item_name,
           COALESCE(ss.unit_code, h.unit_code) AS unit_code,
           ss.snapshot_qty::text                AS balance_qty
         FROM hits h
         LEFT JOIN public.wms_stocktake_snapshot ss
           ON ss.session_id = $4 AND ss.item_code = h.item_code
         ORDER BY
           CASE WHEN h.item_code ILIKE $3 ESCAPE '\\' THEN 0 ELSE 1 END,
           h.item_code
         LIMIT $5`,
        [ctx.wh_code, `%${escapeLike(q)}%`, `${escapeLike(q)}%`, sessionId, limit],
      )
    : await query<ItemRow>(
        `SELECT
           h.item_code,
           COALESCE(ss.item_name, h.item_name) AS item_name,
           COALESCE(ss.unit_code, h.unit_code) AS unit_code,
           ss.snapshot_qty::text                AS balance_qty
         FROM (
           SELECT t.item_code,
                  MAX(t.item_name) AS item_name,
                  MAX(t.unit_code) AS unit_code
           FROM public.odg_wms_trans_detail t
           WHERE (t.status = 0 OR t.status IS NULL)
             AND t.wh_code = $1
             AND t.item_code IS NOT NULL
             AND t.item_code <> ''
           GROUP BY t.item_code
         ) h
         LEFT JOIN public.wms_stocktake_snapshot ss
           ON ss.session_id = $2 AND ss.item_code = h.item_code
         ORDER BY h.item_code
         LIMIT $3`,
        [ctx.wh_code, sessionId, limit],
      );

  // Server-side blind enforcement: hide balance for keepers when blind=true.
  const items: ItemRow[] = canSeeBalance
    ? rows
    : rows.map((r) => ({ ...r, balance_qty: null }));

  return NextResponse.json({
    items,
    blind: ctx.blind,
    can_see_balance: canSeeBalance,
  });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Drill-down for ONE item on a warehouse's card:
 *   · `nodes`   — net qty per rack → location, combining the synced opening
 *     balance (per bin since migration 028) with the hand-posted entries. Each
 *     node also reports its two halves so an operator can see how much of a bin
 *     came from the sync and how much was typed in.
 *   · `unlocated` — the remainder (opening + all movements − located net), i.e.
 *     stock on rows that carry no shelf code. Normally 0.
 *   · `entries` — the raw movement history, newest first, so a wrong figure can
 *     be traced to the doc that caused it.
 *
 * Query: ?wh=&item=
 */
export type NodeRow = {
  rack_code: string | null; location_code: string | null;
  qty: string; opening: string; moved: string;
};
export type EntryRow = {
  roworder: number; doc_no: string; calc_flag: number; qty: string;
  rack_code: string | null; location_code: string | null;
  remark: string | null; user_created: string | null; created_at: string;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const item = url.searchParams.get("item")?.trim() ?? "";
  if (!wh || !item) return NextResponse.json({ error: "wh ແລະ item ຈຳເປັນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [nodes, entries, head] = await Promise.all([
    query<NodeRow>(
      `WITH n AS (
         SELECT rack_code, location_code, qty AS opening, 0::numeric AS moved
         FROM public.odg_wms_stock_card_opening
         WHERE wh_code = $1 AND item_code = $2 AND rack_code IS NOT NULL
         UNION ALL
         SELECT rack_code, location_code, 0::numeric, qty * calc_flag
         FROM public.odg_wms_stock_card_entry
         WHERE wh_code = $1 AND item_code = $2 AND rack_code IS NOT NULL
       )
       SELECT rack_code, location_code,
              SUM(opening + moved)::text AS qty,
              SUM(opening)::text         AS opening,
              SUM(moved)::text           AS moved
       FROM n
       GROUP BY rack_code, location_code
       HAVING SUM(opening + moved) <> 0
       ORDER BY rack_code, location_code NULLS FIRST`,
      [wh, item],
    ),
    query<EntryRow>(
      `SELECT e.roworder, e.doc_no, e.calc_flag, e.qty::text, e.rack_code, e.location_code,
              e.remark, e.user_created, to_char(e.created_at, 'DD-MM-YYYY HH24:MI') AS created_at
       FROM public.odg_wms_stock_card_entry e
       WHERE e.wh_code = $1 AND e.item_code = $2
       ORDER BY e.roworder DESC
       LIMIT 500`,
      [wh, item],
    ),
    query<{ opening: string; in_qty: string; out_qty: string; located: string }>(
      `SELECT COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_opening
                         WHERE wh_code = $1 AND item_code = $2), 0)::text AS opening,
              COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_entry
                         WHERE wh_code = $1 AND item_code = $2 AND calc_flag = 1), 0)::text AS in_qty,
              COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_entry
                         WHERE wh_code = $1 AND item_code = $2 AND calc_flag = -1), 0)::text AS out_qty,
              -- located spans BOTH sources: synced bins + hand-posted bins
              (COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_opening
                          WHERE wh_code = $1 AND item_code = $2 AND rack_code IS NOT NULL), 0)
             + COALESCE((SELECT SUM(qty * calc_flag) FROM public.odg_wms_stock_card_entry
                          WHERE wh_code = $1 AND item_code = $2 AND rack_code IS NOT NULL), 0))::text AS located`,
      [wh, item],
    ),
  ]);

  const h = head[0] ?? { opening: "0", in_qty: "0", out_qty: "0", located: "0" };
  const n = (v: string) => Number.parseFloat(v) || 0;
  const remaining = n(h.opening) + n(h.in_qty) - n(h.out_qty);

  return NextResponse.json({
    summary: {
      opening: n(h.opening), in_qty: n(h.in_qty), out_qty: n(h.out_qty),
      remaining, located: n(h.located), unlocated: remaining - n(h.located),
    },
    nodes,
    entries,
  });
}

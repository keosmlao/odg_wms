import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Movement analytics for one warehouse over a date range:
 *  - movers: per-item inbound/outbound totals + outbound move count (fast movers)
 *  - trend: daily in/out totals (for the bar chart)
 *
 * GET ?wh=<code>&from=&to=  → { kpi, movers, trend }
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from")?.trim() || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = url.searchParams.get("to")?.trim() || today;

  const [movers, trend] = await Promise.all([
    query<{ item_code: string; item_name: string | null; unit_code: string | null; qin: string; qout: string; outmoves: number }>(
      `SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag > 0), 0)::numeric::text AS qin,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag < 0), 0)::numeric::text AS qout,
              count(*) FILTER (WHERE calc_flag < 0)::int AS outmoves
       FROM public.odg_wms_trans_detail
       WHERE wh_code = $1 AND doc_date BETWEEN $2 AND $3
         AND item_code IS NOT NULL AND item_code <> ''
       GROUP BY item_code
       HAVING SUM(qty) FILTER (WHERE calc_flag < 0) > 0 OR SUM(qty) FILTER (WHERE calc_flag > 0) > 0
       ORDER BY COALESCE(SUM(qty) FILTER (WHERE calc_flag < 0), 0) DESC
       LIMIT 100`,
      [wh, from, to],
    ),
    query<{ d: string; inq: string; outq: string }>(
      `SELECT to_char(doc_date, 'YYYY-MM-DD') AS d,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag > 0), 0)::numeric::text AS inq,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag < 0), 0)::numeric::text AS outq
       FROM public.odg_wms_trans_detail
       WHERE wh_code = $1 AND doc_date BETWEEN $2 AND $3
       GROUP BY doc_date ORDER BY doc_date`,
      [wh, from, to],
    ),
  ]);

  const totalIn = trend.reduce((s, r) => s + (Number.parseFloat(r.inq) || 0), 0);
  const totalOut = trend.reduce((s, r) => s + (Number.parseFloat(r.outq) || 0), 0);
  return NextResponse.json({
    kpi: {
      total_in: Math.round(totalIn * 100) / 100,
      total_out: Math.round(totalOut * 100) / 100,
      active_items: movers.length,
      active_days: trend.length,
    },
    movers,
    trend,
    from,
    to,
  });
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Dead / aging stock for one warehouse: items that still hold WMS stock but have
 * not moved out for a long time. "Days idle" = days since the last outbound
 * movement (calc_flag < 0); if never issued, days since the first receipt.
 *
 * Query: ?wh=<code>&q=&limit=
 * Returns: { kpi, rows } with aging buckets.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "1000", 10) || 1000, 1), 5000);
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const all = await query<{
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    wms: string;
    last_out: string | null;
    last_in: string | null;
    days_idle: number | null;
  }>(
    `WITH stock AS (
       SELECT t.item_code,
              MAX(t.item_name) AS item_name,
              MAX(t.unit_code) AS unit_code,
              SUM(t.qty * t.calc_flag) AS bal,
              MAX(t.doc_date) FILTER (WHERE t.calc_flag < 0) AS last_out,
              MAX(t.doc_date) FILTER (WHERE t.calc_flag > 0) AS last_in,
              MIN(t.doc_date) FILTER (WHERE t.calc_flag > 0) AS first_in
       FROM public.odg_wms_trans_detail t
       WHERE t.wh_code = $1 AND t.item_code IS NOT NULL AND t.item_code <> ''
       GROUP BY t.item_code
       HAVING SUM(t.qty * t.calc_flag) > 0.0001
     )
     SELECT item_code, item_name, unit_code,
            bal::numeric::text AS wms,
            to_char(last_out, 'YYYY-MM-DD') AS last_out,
            to_char(last_in, 'YYYY-MM-DD')  AS last_in,
            (CURRENT_DATE - COALESCE(last_out, first_in))::int AS days_idle
     FROM stock
     ORDER BY days_idle DESC NULLS LAST`,
    [wh],
  );

  // Aging buckets.
  const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d91_180: 0, d180: 0 };
  let totalQty = 0;
  let idle90Items = 0;
  let idle90Qty = 0;
  for (const r of all) {
    const d = r.days_idle ?? 0;
    const qty = Number.parseFloat(r.wms) || 0;
    totalQty += qty;
    if (d <= 30) buckets.d0_30 += 1;
    else if (d <= 60) buckets.d31_60 += 1;
    else if (d <= 90) buckets.d61_90 += 1;
    else if (d <= 180) buckets.d91_180 += 1;
    else buckets.d180 += 1;
    if (d > 90) {
      idle90Items += 1;
      idle90Qty += qty;
    }
  }

  const rows = (q
    ? all.filter((r) => r.item_code.toLowerCase().includes(q) || (r.item_name ?? "").toLowerCase().includes(q))
    : all
  ).slice(0, limit);

  return NextResponse.json({
    kpi: {
      total_items: all.length,
      total_qty: Math.round(totalQty * 1e6) / 1e6,
      idle90_items: idle90Items,
      idle90_qty: Math.round(idle90Qty * 1e6) / 1e6,
      buckets,
    },
    rows,
  });
}

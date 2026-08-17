import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  MAX_LINES,
  bucketOf,
  flagsFromParam,
  groupByDoc,
  groupByItem,
  itemStockOnHand,
  pendingOutLines,
} from "@/lib/pendingOut";

/**
 * ລາຍງານສິນຄ້າຄ້າງຈ່າຍອອກສາງ — outbound documents that still owe stock, in both
 * views the report offers: by document and by item.
 *
 * Query: ?wh=<code, required>&type=req,transfer,sale&days=
 * Returns: { kpi, docs, items, lines, truncated }
 *   docs  — one row per source document (ໃບເບີກ / ໃບໂອນ / ບິນຂາຍ)
 *   items — one row per item, with WMS stock on hand and the resulting shortfall
 *   lines — the (document × item) rows behind both, for row expansion and search
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const days = Math.min(Math.max(Number.parseInt(url.searchParams.get("days") ?? "30", 10) || 30, 1), 1095);
  const flags = flagsFromParam(url.searchParams.get("type"));

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const lines = await pendingOutLines({ wh, flags, days });
  const onHand = await itemStockOnHand(wh, [...new Set(lines.map((l) => l.item_code))]);

  const docs = groupByDoc(lines);
  const items = groupByItem(lines, onHand);

  // KPI + aging spread, counted over documents (one late document = one late order).
  const buckets: Record<string, number> = {};
  let overdue = 0;
  for (const d of docs) {
    const b = bucketOf(d.aging_days);
    buckets[b] = (buckets[b] ?? 0) + 1;
    if (d.aging_days > 30) overdue += 1;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;

  return NextResponse.json({
    kpi: {
      docs: docs.length,
      items: items.length,
      remaining_qty: round(docs.reduce((s, d) => s + d.remaining, 0)),
      picking_qty: round(docs.reduce((s, d) => s + d.picking, 0)),
      shortfall_items: items.filter((i) => i.shortfall > 0.0001).length,
      overdue_docs: overdue,
      oldest_days: docs.reduce((m, d) => Math.max(m, d.aging_days), 0),
      buckets,
    },
    docs,
    items,
    lines,
    truncated: lines.length >= MAX_LINES,
  });
}

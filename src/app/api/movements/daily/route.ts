import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { flagsFromParam } from "@/lib/pendingOut";
import { billFlow, dailyStock, docLifecycle } from "@/lib/dailyMovement";

/**
 * ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ — both shapes in one call.
 *
 * Query: ?wh=<code, required>&from=YYYY-MM-DD&to=YYYY-MM-DD&type=req,transfer,sale
 * Returns: { stock: DayStock[], bills: DayBills[], totals }
 */
const MAX_DAYS = 92;
/** How far back to look for still-open documents that carry into the range. */
const CARRY_LOOKBACK_DAYS = 180;

function isDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const today = new Date().toISOString().slice(0, 10);
  let to = url.searchParams.get("to")?.trim() || today;
  let from = url.searchParams.get("from")?.trim() || shift(to, -6);
  const flags = flagsFromParam(url.searchParams.get("type"));

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: "ວັນທີ່ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (from > to) [from, to] = [to, from];
  // Cap the span so one request can never walk a year of movements.
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  if (span > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const filter = { wh, from, to, flags };
  const [stock, docs] = await Promise.all([
    dailyStock(filter),
    docLifecycle(filter, CARRY_LOOKBACK_DAYS),
  ]);
  const bills = billFlow(docs, from, to);

  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return NextResponse.json({
    from,
    to,
    stock,
    bills,
    totals: {
      opening: stock[0]?.opening ?? 0,
      closing: stock[stock.length - 1]?.closing ?? 0,
      qty_in: round(stock.reduce((s, d) => s + d.qty_in, 0)),
      qty_out: round(stock.reduce((s, d) => s + d.qty_out, 0)),
      bill_qty: round(stock.reduce((s, d) => s + d.bill_qty, 0)),
      bill_docs: stock.reduce((s, d) => s + d.bill_docs, 0),
      opened: bills.reduce((s, d) => s + d.opened, 0),
      closed: bills.reduce((s, d) => s + d.closed, 0),
      carry_in: bills[0]?.carry_in ?? 0,
      carry_out: bills[bills.length - 1]?.carry_out ?? 0,
    },
  });
}

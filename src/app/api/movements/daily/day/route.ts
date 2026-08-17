import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { flagsFromParam } from "@/lib/pendingOut";
import { dayBills, dayItems } from "@/lib/dailyMovement";

/**
 * One day's detail behind a row of the daily report: what moved (per item) and
 * which documents were raised (per bill).
 *
 * Query: ?wh=<code>&date=YYYY-MM-DD&type=
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const date = url.searchParams.get("date")?.trim() ?? "";
  const flags = flagsFromParam(url.searchParams.get("type"));
  if (!wh || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [items, bills] = await Promise.all([dayItems(wh, date), dayBills(wh, date, flags)]);
  return NextResponse.json({ date, items, bills });
}

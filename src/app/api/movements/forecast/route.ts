import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";
import { forecastSearch } from "@/lib/forecast";

/**
 * ຈຳນວນຄາດການ ຕໍ່ (ສາງ × ສິນຄ້າ) — ອ່ານຢ່າງດຽວ.
 * ສູດ ແລະ ນິຍາມແຕ່ລະຂາຢູ່ທີ່ lib/forecast.ts
 *
 * GET ?q=<ລະຫັດ ຫຼື ຊື່ສິນຄ້າ ຢ່າງໜ້ອຍ 2 ຕົວ>
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ rows: [] });

  const warehouses = await scopedWarehouses(session, url.searchParams.get("wh"));
  const rows = await forecastSearch(warehouses.map((w) => w.code), q);
  return NextResponse.json({ rows });
}

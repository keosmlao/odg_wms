import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { MAX_ITEMS, isMonth, monthRange, monthTotals, monthlyItems } from "@/lib/monthlyMovement";

/**
 * ລາຍງານການເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ.
 *
 * Query: ?wh=<code, required>&month=YYYY-MM&idle=1
 *        idle=1 → ເອົາສິນຄ້າທີ່ບໍ່ເຄື່ອນໄຫວໃນເດືອນ (ມີແຕ່ຍອດຄ້າງ) ມານຳ
 * Returns: { month, from, to, rows: MonthItemRow[], brands, totals, truncated }
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const month = url.searchParams.get("month")?.trim() || new Date().toISOString().slice(0, 7);
  const includeIdle = url.searchParams.get("idle") === "1";

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!isMonth(month)) return NextResponse.json({ error: "ເດືອນບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await monthlyItems({ wh, month, includeIdle });
  const { from, to } = monthRange(month);
  // ລາຍຊື່ຍີ່ຫໍ້ໃຫ້ຕົວກອງຢູ່ໜ້າຈໍ — ເອົາສະເພາະທີ່ມີໃນຜົນລາຍງານນີ້ຈິງ.
  const brands = [...new Set(rows.map((r) => r.brand).filter((b): b is string => !!b))].sort((a, b) =>
    a.localeCompare(b, "lo"),
  );

  return NextResponse.json({
    month,
    from,
    to,
    rows,
    brands,
    totals: monthTotals(rows),
    truncated: rows.length >= MAX_ITEMS,
  });
}

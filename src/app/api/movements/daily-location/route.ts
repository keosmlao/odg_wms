import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { locTotals, locationFlow, MAX_LOCATIONS } from "@/lib/locationMovement";

/**
 * ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ ຕາມບ່ອນເກັບ.
 *
 * Query: ?wh=<code, required>&from=YYYY-MM-DD&to=YYYY-MM-DD&idle=1
 *        idle=1 → ເອົາບ່ອນເກັບທີ່ບໍ່ເຄື່ອນໄຫວ (ມີແຕ່ຍອດຄ້າງ) ມານຳ
 * Returns: { from, to, rows: LocRow[], totals, truncated }
 */
const MAX_DAYS = 92;

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
  let from = url.searchParams.get("from")?.trim() || to;
  const includeIdle = url.searchParams.get("idle") === "1";

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!isDate(from) || !isDate(to)) return NextResponse.json({ error: "ວັນທີ່ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  if (from > to) [from, to] = [to, from];
  // ຈຳກັດຊ່ວງ ເພື່ອບໍ່ໃຫ້ຄຳຂໍດຽວແລ່ນທັງປີ.
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await locationFlow({ wh, from, to, includeIdle });
  return NextResponse.json({
    from,
    to,
    rows,
    totals: locTotals(rows),
    truncated: rows.length >= MAX_LOCATIONS,
  });
}

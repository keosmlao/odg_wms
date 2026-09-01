import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { locTotals, locationFlow } from "@/lib/locationMovement";

/**
 * Excel ຂອງລາຍງານເຄື່ອນໄຫວປະຈຳວັນ ຕາມບ່ອນເກັບ — ໜຶ່ງແຜ່ນ ໜຶ່ງແຖວຕໍ່ບ່ອນເກັບ.
 */
const MAX_DAYS = 92;

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
  if (from > to) [from, to] = [to, from];
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await locationFlow({ wh, from, to, includeIdle });
  const totals = locTotals(rows);

  const header = [
    "ຊັ້ນວາງ", "ຊື່ຊັ້ນວາງ", "ບ່ອນເກັບ", "ຊື່ບ່ອນເກັບ",
    "ຍອດຍົກມາ", "ຮັບເຂົ້າ", "ຈ່າຍອອກ", "ຄົງເຫຼືອ",
    "ຍ້າຍເຂົ້າ", "ຍ້າຍອອກ", "ລາຍການ", "ເອກະສານ",
  ];
  const body: (string | number)[][] = rows.map((r) => [
    r.rack || "—", r.rack_name ?? "", r.loc || "—", r.loc_name ?? "",
    r.opening, r.qty_in, r.qty_out, r.closing,
    r.move_in, r.move_out, r.items, r.docs,
  ]);
  body.push([
    "ລວມ", "", `${rows.length} ບ່ອນເກັບ`, "",
    totals.opening, totals.qty_in, totals.qty_out, totals.closing,
    totals.move_in, totals.move_out, "", "",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 20 },
    { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 9 }, { wch: 10 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ຕາມບ່ອນເກັບ");

  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily_location_${wh}_${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

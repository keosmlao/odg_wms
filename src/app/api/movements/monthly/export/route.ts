import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { filterRows, isMonth, monthTotals, monthlyItems } from "@/lib/monthlyMovement";

/**
 * Excel ຂອງລາຍງານເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ — ໜຶ່ງແຜ່ນ ໜຶ່ງແຖວຕໍ່ສິນຄ້າ.
 * ຮັບ q/brand ນຳ ເພື່ອໃຫ້ໄຟລ໌ອອກມາຄືກັນກັບທີ່ຜູ້ໃຊ້ກອງໄວ້ຢູ່ໜ້າຈໍ.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const month = url.searchParams.get("month")?.trim() || new Date().toISOString().slice(0, 7);
  const includeIdle = url.searchParams.get("idle") === "1";
  const q = url.searchParams.get("q") ?? "";
  const brand = url.searchParams.get("brand") ?? "";

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!isMonth(month)) return NextResponse.json({ error: "ເດືອນບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = filterRows(await monthlyItems({ wh, month, includeIdle }), q, brand);
  const totals = monthTotals(rows);

  const header = ["ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຍີ່ຫໍ້", "ຫົວໜ່ວຍ", "ຍອດຍົກມາ", "ເຂົ້າ", "ອອກ", "ຄົງເຫຼືອ", "ເອກະສານ"];
  const body: (string | number)[][] = rows.map((r) => [
    r.item_code, r.item_name ?? "", r.brand ?? "", r.unit_code ?? "",
    r.opening, r.qty_in, r.qty_out, r.closing, r.docs,
  ]);
  body.push(["ລວມ", `${rows.length} ລາຍການ`, "", "", totals.opening, totals.qty_in, totals.qty_out, totals.closing, ""]);

  const sheet = XLSX.utils.aoa_to_sheet([[`ເດືອນ`, month], [`ສາງ`, wh], [], header, ...body]);
  sheet["!cols"] = [
    { wch: 15 }, { wch: 48 }, { wch: 16 }, { wch: 10 },
    { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 10 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ລາຍເດືອນ");

  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="monthly_${wh}_${month}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { flagsFromParam } from "@/lib/pendingOut";
import { billFlow, dailyStock, docLifecycle } from "@/lib/dailyMovement";

/**
 * Excel export of ລາຍງານການເຄື່ອນໄຫວປະຈຳວັນ — one sheet per shape:
 * ຈຳນວນສິນຄ້າ (stock card) and ຈຳນວນໃບ (backlog flow).
 */
const MAX_DAYS = 92;
const CARRY_LOOKBACK_DAYS = 180;

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
  if (from > to) [from, to] = [to, from];
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > MAX_DAYS) from = shift(to, -(MAX_DAYS - 1));

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const filter = { wh, from, to, flags };
  const [stock, docs] = await Promise.all([dailyStock(filter), docLifecycle(filter, CARRY_LOOKBACK_DAYS)]);
  const bills = billFlow(docs, from, to);

  const book = XLSX.utils.book_new();

  const sHeader = ["ວັນທີ່", "ຍອດຍົກມາ", "ເປີດບິນ", "ຈຳນວນໃບເປີດ", "ຮັບເຂົ້າ", "ໃບຮັບ", "ຈ່າຍອອກ", "ໃບຈ່າຍ", "ຍົກໄປ"];
  const sBody = stock.map((d) => [d.date, d.opening, d.bill_qty, d.bill_docs, d.qty_in, d.in_docs, d.qty_out, d.out_docs, d.closing]);
  sBody.push([
    "ລວມ", stock[0]?.opening ?? 0,
    stock.reduce((s, d) => s + d.bill_qty, 0), stock.reduce((s, d) => s + d.bill_docs, 0),
    stock.reduce((s, d) => s + d.qty_in, 0), stock.reduce((s, d) => s + d.in_docs, 0),
    stock.reduce((s, d) => s + d.qty_out, 0), stock.reduce((s, d) => s + d.out_docs, 0),
    stock[stock.length - 1]?.closing ?? 0,
  ]);
  const sSheet = XLSX.utils.aoa_to_sheet([sHeader, ...sBody]);
  sSheet["!cols"] = [{ wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 9 }, { wch: 12 }, { wch: 9 }, { wch: 13 }];
  XLSX.utils.book_append_sheet(book, sSheet, "ຈຳນວນສິນຄ້າ");

  const bHeader = ["ວັນທີ່", "ໃບຄ້າງຍົກມາ", "ເປີດບິນ", "ຈ່າຍຄົບ", "ຄ້າງຍົກໄປ"];
  const bBody = bills.map((d) => [d.date, d.carry_in, d.opened, d.closed, d.carry_out]);
  bBody.push([
    "ລວມ", bills[0]?.carry_in ?? 0,
    bills.reduce((s, d) => s + d.opened, 0), bills.reduce((s, d) => s + d.closed, 0),
    bills[bills.length - 1]?.carry_out ?? 0,
  ]);
  const bSheet = XLSX.utils.aoa_to_sheet([bHeader, ...bBody]);
  bSheet["!cols"] = [{ wch: 13 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(book, bSheet, "ຈຳນວນໃບ");

  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="daily_movement_${wh}_${from}_${to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

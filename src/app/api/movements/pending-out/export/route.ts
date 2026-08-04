import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  LABEL_BY_FLAG,
  flagsFromParam,
  formatWait,
  groupByDoc,
  groupByItem,
  itemStockOnHand,
  pendingOutLines,
} from "@/lib/pendingOut";

/**
 * Excel export of ລາຍງານສິນຄ້າຄ້າງຈ່າຍອອກສາງ. Same filters as the report page
 * (?wh=&type=&days=), written as three sheets so one file answers all of it:
 * ຕາມໃບ (by document) · ຕາມສິນຄ້າ (by item) · ລາຍລະອຽດ (every doc × item line).
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

  const book = XLSX.utils.book_new();

  // ── ຕາມໃບເອກະສານ ─────────────────────────────────────────────
  const docHeader = [
    "ລຳດັບ", "ປະເພດ", "ເລກທີ່ໃບ", "ວັນທີ່ / ເວລາໃບ", "ວັນທີ່ຕ້ອງການ", "ຄ້າງມາແລ້ວ", "ຄ້າງ (ວິນາທີ)",
    "ສາງ", "ຊື່ສາງ", "ລູກຄ້າ", "ຊື່ລູກຄ້າ", "ພະນັກງານຂາຍ", "ປະເພດຂົນສົ່ງ",
    "ລາຍການ", "ສັ່ງ", "ຈ່າຍແລ້ວ", "ຢູ່ໃບເກັບ", "ຮັບຄືນ (CN)", "ຄ້າງຈ່າຍ", "ໝາຍເຫດພະນັກງານ", "ໝາຍເຫດ",
  ];
  const docBody = docs.map((d, i) => [
    i + 1, d.type_label, d.doc_no, d.doc_ts ?? d.doc_date ?? "", d.want_date ?? "",
    formatWait(d.aging_seconds), d.aging_seconds,
    d.wh_code, d.wh_name ?? "", d.cust_code ?? "", d.cust_name ?? "", d.sale_name ?? "", d.transport_name ?? "",
    d.lines, d.ordered, d.issued, d.picking, d.returned, d.remaining, d.note ?? "", d.remark ?? "",
  ]);
  const docSheet = XLSX.utils.aoa_to_sheet([docHeader, ...docBody]);
  docSheet["!cols"] = [
    { wch: 6 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 13 }, { wch: 18 }, { wch: 13 },
    { wch: 10 }, { wch: 24 }, { wch: 12 }, { wch: 34 }, { wch: 20 }, { wch: 22 },
    { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 26 }, { wch: 30 },
  ];
  if (docBody.length > 0) {
    docSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: docBody.length, c: docHeader.length - 1 } }),
    };
  }
  XLSX.utils.book_append_sheet(book, docSheet, "ຕາມໃບ");

  // ── ຕາມສິນຄ້າ ────────────────────────────────────────────────
  const itemHeader = [
    "ລຳດັບ", "ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຫົວໜ່ວຍ",
    "ຈຳນວນໃບ", "ຄ້າງຈ່າຍ", "ຢູ່ໃບເກັບ", "stock ໃນສາງ", "ຂາດ", "ຄ້າງດົນສຸດ", "ຄ້າງດົນສຸດ (ວິນາທີ)",
  ];
  const itemBody = items.map((it, i) => [
    i + 1, it.item_code, it.item_name ?? "", it.unit_code ?? "",
    it.docs, it.remaining, it.picking, it.on_hand, it.shortfall,
    formatWait(it.oldest_seconds), it.oldest_seconds,
  ]);
  const itemSheet = XLSX.utils.aoa_to_sheet([itemHeader, ...itemBody]);
  itemSheet["!cols"] = [
    { wch: 6 }, { wch: 16 }, { wch: 60 }, { wch: 10 },
    { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 },
  ];
  if (itemBody.length > 0) {
    itemSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: itemBody.length, c: itemHeader.length - 1 } }),
    };
  }
  XLSX.utils.book_append_sheet(book, itemSheet, "ຕາມສິນຄ້າ");

  // ── ລາຍລະອຽດ (doc × item) ────────────────────────────────────
  const lineHeader = [
    "ລຳດັບ", "ປະເພດ", "ເລກທີ່ໃບ", "ວັນທີ່ / ເວລາໃບ", "ຄ້າງມາແລ້ວ", "ຄ້າງ (ວິນາທີ)", "ສາງ", "ຊື່ລູກຄ້າ", "ປະເພດຂົນສົ່ງ",
    "ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຫົວໜ່ວຍ", "ສັ່ງ", "ຈ່າຍແລ້ວ", "ຢູ່ໃບເກັບ", "ຮັບຄືນ (CN)", "ຄ້າງຈ່າຍ",
  ];
  const lineBody = lines.map((l, i) => [
    i + 1, LABEL_BY_FLAG[l.trans_flag] ?? String(l.trans_flag), l.doc_no, l.doc_ts ?? l.doc_date ?? "",
    formatWait(l.aging_seconds), l.aging_seconds, l.wh_code, l.cust_name ?? "", l.transport_name ?? "",
    l.item_code, l.item_name ?? "", l.unit_code ?? "", l.ordered, l.issued, l.picking, l.returned, l.remaining,
  ]);
  const lineSheet = XLSX.utils.aoa_to_sheet([lineHeader, ...lineBody]);
  lineSheet["!cols"] = [
    { wch: 6 }, { wch: 10 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 13 }, { wch: 10 }, { wch: 30 }, { wch: 22 },
    { wch: 16 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 11 },
  ];
  if (lineBody.length > 0) {
    lineSheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lineBody.length, c: lineHeader.length - 1 } }),
    };
  }
  XLSX.utils.book_append_sheet(book, lineSheet, "ລາຍລະອຽດ");

  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `pending_out${wh ? `_${wh}` : ""}_${stamp}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

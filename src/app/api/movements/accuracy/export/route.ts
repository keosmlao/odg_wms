import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/session";
import { scopedWarehouses } from "@/lib/warehouseScope";
import { accuracyFor } from "@/lib/accuracy";

/**
 * Excel export of the accuracy report (WMS ≠ ERP), ທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດ ໃນຊີດດຽວ
 * ພ້ອມຄອລັມສາງ — ຄືກັບໜ້າຈໍທີ່ບໍ່ມີການເລືອກສາງອີກແລ້ວ.
 *
 * ໃຊ້ຜົນຈາກ cache ດຽວກັນກັບໜ້າຈໍ (SML ຊ້າ) — `?refresh=1` ຄຳນວນໃໝ່.
 *
 * GET ?wh=&q=&adj=1&refresh=1  → .xlsx
 *   adj=1 → ສະເພາະແຖວທີ່ມີ "ປັບປຸງເພີ່ມເຂົ້າ" ແລະ WMS ສູງກວ່າ ERP
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const adjOnly = url.searchParams.get("adj") === "1";
  const refresh = url.searchParams.get("refresh") === "1";

  const warehouses = await scopedWarehouses(session, url.searchParams.get("wh"));
  if (warehouses.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" }, { status: 403 });
  }

  const header = [
    "ລຳດັບ", "ລະຫັດສາງ", "ຊື່ສາງ", "ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຫົວໜ່ວຍ",
    "ERP (SML)", "ຝາກສາງ", "ປັບປຸງເພີ່ມເຂົ້າ", "WMS", "SN", "ຕ່າງ (WMS−ERP)", "ໝາຍເຫດ",
  ];
  const body: (string | number)[][] = [];
  let n = 0;
  for (const w of warehouses) {
    const entry = await accuracyFor(w.code, refresh);
    for (const r of entry.mismatched) {
      if (q && !r.item_code.toLowerCase().includes(q) && !(r.item_name ?? "").toLowerCase().includes(q)) continue;
      if (adjOnly && !(r.adj_in > 0 && r.var_wms_sml > 0)) continue;
      // ໝາຍເຫດ: ບອກວ່າສ່ວນຕ່າງອະທິບາຍໄດ້ດ້ວຍຫຍັງ.
      const note = Math.abs(r.adj_in - r.var_wms_sml) < 0.001 ? "ຕ່າງ = ປັບປຸງເພີ່ມເຂົ້າ ພໍດີ"
        : r.adj_in > 0 && r.var_wms_sml > 0 ? "ມີປັບປຸງເພີ່ມເຂົ້າ"
        : r.deposit > 0 ? "ມີເຄື່ອງຝາກສາງ"
        : "";
      body.push([
        ++n, w.code, w.name ?? "", r.item_code, r.item_name ?? "", r.unit_code ?? "",
        r.sml, r.deposit, r.adj_in, r.wms, r.sn, r.var_wms_sml, note,
      ]);
    }
  }

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 6 }, { wch: 10 }, { wch: 26 }, { wch: 16 }, { wch: 50 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 24 },
  ];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "accuracy");
  const buf = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="wms-accuracy-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

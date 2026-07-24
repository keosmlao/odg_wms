import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Excel export of the stock balance report (ຄົງເຫຼືອສິນຄ້າ).
 *
 * Mirrors the filters of /movements/balance (?wh=&q=) but ignores pagination —
 * every matching balance row is written to the sheet, capped at MAX_ROWS.
 *
 * GET /api/movements/balance/export?wh=&q=  → .xlsx attachment
 */
const MAX_ROWS = 50_000;

type ExportRow = {
  wh_code: string;
  wh_name: string | null;
  rack_code: string;
  location_code: string;
  pallet_code: string;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
};

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
  // Rack/location only apply within a chosen warehouse (same rule as the page).
  const rack = wh ? (url.searchParams.get("rack")?.trim() ?? "") : "";
  const location = wh && rack ? (url.searchParams.get("location")?.trim() ?? "") : "";
  const search = url.searchParams.get("q")?.trim() ?? "";
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // Same base filters as the balance page so the export always matches what the
  // user sees on screen.
  const args: unknown[] = [];
  // No `status` filter — see the balance page for the full rationale. status=1
  // marks the outbound (-1) leg of an internal bin relocation (trans_flag 77);
  // excluding it drops real stock reductions and inflates the balance.
  const filters = [
    "t.wh_code IS NOT NULL AND t.wh_code <> ''",
  ];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    filters.push(`t.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    filters.push(`t.wh_code = $${args.length}`);
  }
  if (rack) {
    args.push(rack);
    filters.push(`TRIM(t.shelf_code) = $${args.length}`);
  }
  if (location) {
    args.push(location);
    filters.push(`TRIM(t.shelf_code1) = $${args.length}`);
  }
  if (search) {
    args.push(`%${search}%`);
    filters.push(`(
      t.item_code ILIKE $${args.length}
      OR t.item_name ILIKE $${args.length}
      OR t.shelf_code ILIKE $${args.length}
      OR t.shelf_code1 ILIKE $${args.length}
      OR t.pallet ILIKE $${args.length}
    )`);
  }

  args.push(MAX_ROWS);
  const rows = await query<ExportRow>(
    `SELECT
       t.wh_code,
       MAX(w.name_1)                                 AS wh_name,
       COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack_code,
       COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location_code,
       COALESCE(NULLIF(TRIM(t.pallet), ''), '')      AS pallet_code,
       t.item_code,
       MAX(t.item_name)                              AS item_name,
       MAX(t.unit_code)                              AS unit_code,
       SUM(t.qty * t.calc_flag)::numeric::text       AS qty
     FROM public.odg_wms_trans_detail t
     LEFT JOIN public.ic_warehouse w ON w.code = t.wh_code
     WHERE ${filters.join(" AND ")}
     GROUP BY t.wh_code, rack_code, location_code, pallet_code, t.item_code
     HAVING SUM(t.qty * t.calc_flag) <> 0
     ORDER BY t.wh_code, rack_code, location_code, pallet_code, t.item_code
     LIMIT $${args.length}`,
    args,
  );

  const header = [
    "ລຳດັບ",
    "ລະຫັດສາງ",
    "ຊື່ສາງ",
    "ລະຫັດສິນຄ້າ",
    "ຊື່ສິນຄ້າ",
    "Rack",
    "Location",
    "Pallet",
    "ຈຳນວນ",
    "ຫົວໜ່ວຍ",
  ];
  const body = rows.map((r, i) => [
    i + 1,
    r.wh_code,
    r.wh_name ?? "",
    r.item_code,
    r.item_name ?? "",
    r.rack_code,
    r.location_code,
    r.pallet_code,
    Number.parseFloat(r.qty) || 0,
    r.unit_code ?? "",
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 6 },  // ລຳດັບ
    { wch: 10 }, // ລະຫັດສາງ
    { wch: 26 }, // ຊື່ສາງ
    { wch: 16 }, // ລະຫັດສິນຄ້າ
    { wch: 60 }, // ຊື່ສິນຄ້າ
    { wch: 12 }, // Rack
    { wch: 12 }, // Location
    { wch: 12 }, // Pallet
    { wch: 10 }, // ຈຳນວນ
    { wch: 10 }, // ຫົວໜ່ວຍ
  ];
  // Let the user filter/sort in Excel via the header dropdowns.
  if (body.length > 0) {
    sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
  }

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ຄົງເຫຼືອສິນຄ້າ");
  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `stock_balance${wh ? `_${wh}` : ""}_${stamp}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

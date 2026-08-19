import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Excel export of the defective-goods register (ports `export_data_defect`).
 * One row per entry, with up to five photo filenames spread across columns —
 * same shape the legacy report produced.
 *
 * GET /api/defects/export?status=0|1&wh=&brand=&q=&code=  → .xlsx
 * `code` narrows to a single item, which is what the item detail page exports.
 */
const MAX_ROWS = 50_000;
const PHOTO_COLUMNS = 5;

type ExportRow = {
  warehouse: string | null;
  warehouse_name: string | null;
  date_register: string | null;
  ic_code: string;
  ic_name: string | null;
  qty: string;
  unit_code: string | null;
  item_brand: string | null;
  sn: string | null;
  grade: string | null;
  remark: string | null;
  code_ref: string;
  image_urls: string[] | null;
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
  const status = url.searchParams.get("status") === "1" ? DEFECT_STATUS.dispatched : DEFECT_STATUS.pending;
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const code = url.searchParams.get("code")?.trim() ?? "";

  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [status];
  const filters = ["d.status = $1"];
  if (code) {
    args.push(code);
    filters.push(`d.ic_code = $${args.length}`);
  }
  if (Array.isArray(accessible)) {
    args.push(accessible);
    filters.push(`d.warehouse = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    filters.push(`d.warehouse = $${args.length}`);
  }
  if (brand) {
    args.push(brand);
    filters.push(`d.item_brand = $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    const p = `$${args.length}`;
    // Must match the report's own q filter in GET /api/defects — the export link
    // carries the same query string, so a search that finds rows on screen has
    // to find the same rows in the workbook.
    filters.push(
      `(d.ic_code ILIKE ${p} OR d.ic_name ILIKE ${p}
        OR d.sn ILIKE ${p} OR d.isn ILIKE ${p}
        OR EXISTS (
          SELECT 1 FROM public.sn_inventory s
          WHERE (s.sn = d.sn OR s.isn = d.sn) AND s.isn ILIKE ${p}
        ))`,
    );
  }
  args.push(MAX_ROWS);

  const rows = await query<ExportRow>(
    `WITH img AS (
       SELECT code_ref, array_agg(image_url ORDER BY line_number) AS urls
       FROM public.odg_product_defect_image
       WHERE COALESCE(image_url, '') <> ''
       GROUP BY code_ref
     )
     SELECT
       d.warehouse,
       COALESCE(dw.name_1, w.name_1) AS warehouse_name,
       to_char(d.date_register, 'DD-MM-YYYY HH24:MI') AS date_register,
       d.ic_code,
       d.ic_name,
       d.qty::numeric::text AS qty,
       d.unit_code,
       d.item_brand,
       d.sn,
       d.grade,
       d.remark,
       d.code_ref,
       img.urls AS image_urls
     FROM public.odg_product_defect d
     LEFT JOIN img ON img.code_ref = d.code_ref
     LEFT JOIN public.odg_defect_warehouse dw ON dw.code = d.warehouse
     LEFT JOIN public.ic_warehouse w ON w.code = d.warehouse
     WHERE ${filters.join(" AND ")}
     ORDER BY d.warehouse, d.date_register DESC NULLS LAST
     LIMIT $${args.length}`,
    args,
  );

  const header = [
    "ລຳດັບ",
    "ເລກອ້າງອີງ",
    "ລະຫັດສາງ",
    "ຊື່ສາງ",
    "ວັນທີບັນທຶກ",
    "ລະຫັດສິນຄ້າ",
    "ຊື່ສິນຄ້າ",
    "ຈຳນວນ",
    "ຫົວໜ່ວຍ",
    "ຍີ່ຫໍ້",
    "SN",
    "ເກຣດ",
    "ໝາຍເຫດ",
    ...Array.from({ length: PHOTO_COLUMNS }, (_, i) => `ຮູບ ${i + 1}`),
  ];
  const body = rows.map((r, i) => [
    i + 1,
    r.code_ref,
    r.warehouse ?? "",
    r.warehouse_name ?? "",
    r.date_register ?? "",
    r.ic_code,
    r.ic_name ?? "",
    Number.parseFloat(r.qty) || 0,
    r.unit_code ?? "",
    r.item_brand ?? "",
    r.sn ?? "",
    r.grade ?? "",
    r.remark ?? "",
    ...Array.from({ length: PHOTO_COLUMNS }, (_, k) => r.image_urls?.[k] ?? ""),
  ]);

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = [
    { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 26 }, { wch: 18 },
    { wch: 16 }, { wch: 60 }, { wch: 10 }, { wch: 10 }, { wch: 16 },
    { wch: 20 }, { wch: 8 }, { wch: 40 },
    ...Array.from({ length: PHOTO_COLUMNS }, () => ({ wch: 34 })),
  ];
  if (body.length > 0) {
    sheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: body.length, c: header.length - 1 },
      }),
    };
  }

  const label = status === DEFECT_STATUS.dispatched ? "ເບີກຈ່າຍແລ້ວ" : "ຍັງບໍ່ເບີກຈ່າຍ";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "ເຄື່ອງມີຕຳນິ");
  const buffer: Buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" });

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `product_defect_${status === DEFECT_STATUS.dispatched ? "dispatched" : "pending"}${code ? `_${code}` : ""}${wh ? `_${wh}` : ""}_${stamp}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Defect-Scope": encodeURIComponent(label),
    },
  });
}

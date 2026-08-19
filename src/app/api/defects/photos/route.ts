import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { defectImageUrl } from "@/lib/defects";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Photo + serial-number register for goods on the defect shelves —
 * ລາຍງານເກັບຮູບພາບ ແລະ ໝາຍເລກເຄື່ອງໃນສາງມີຕຳນິ.
 *
 * One row per entry with all of its photos attached (the legacy report emitted
 * one row per entry×photo, which repeated the entry for every image).
 *
 * GET ?wh=&status=all|0|1&photos=all|with|without&q=
 */

type PhotoQueryRow = {
  code_ref: string;
  ic_code: string;
  ic_name: string | null;
  qty: string;
  unit_code: string | null;
  item_brand: string | null;
  sn: string | null;
  remark: string | null;
  grade: string | null;
  status: number;
  warehouse: string | null;
  warehouse_name: string | null;
  date_register: string | null;
  image_urls: string[] | null;
};

export type DefectPhotoRow = Omit<PhotoQueryRow, "image_urls"> & {
  images: { image_url: string; url: string }[];
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
  const statusParam = url.searchParams.get("status") ?? "all";
  const photos = url.searchParams.get("photos") ?? "all";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "300", 10) || 300, 1),
    2000,
  );

  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [];
  const filters: string[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    filters.push(`d.warehouse = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    filters.push(`d.warehouse = $${args.length}`);
  }
  if (statusParam === "0" || statusParam === "1") {
    args.push(statusParam === "1" ? DEFECT_STATUS.dispatched : DEFECT_STATUS.pending);
    filters.push(`d.status = $${args.length}`);
  }
  if (q) {
    args.push(`%${q}%`);
    filters.push(
      `(d.ic_code ILIKE $${args.length} OR d.ic_name ILIKE $${args.length} OR d.sn ILIKE $${args.length})`,
    );
  }
  if (photos === "with") filters.push("img.n > 0");
  if (photos === "without") filters.push("COALESCE(img.n, 0) = 0");

  args.push(limit);

  const rows = await query<PhotoQueryRow>(
    `WITH img AS (
       SELECT code_ref,
              COUNT(*)::int AS n,
              array_agg(image_url ORDER BY line_number) AS urls
       FROM public.odg_product_defect_image
       WHERE COALESCE(image_url, '') <> ''
       GROUP BY code_ref
     )
     SELECT
       d.code_ref,
       d.ic_code,
       d.ic_name,
       d.qty::numeric::text AS qty,
       d.unit_code,
       d.item_brand,
       d.sn,
       d.remark,
       d.grade,
       d.status,
       d.warehouse,
       COALESCE(dw.name_1, w.name_1) AS warehouse_name,
       to_char(d.date_register, 'DD-MM-YYYY HH24:MI') AS date_register,
       img.urls AS image_urls
     FROM public.odg_product_defect d
     LEFT JOIN img ON img.code_ref = d.code_ref
     LEFT JOIN public.odg_defect_warehouse dw ON dw.code = d.warehouse
     LEFT JOIN public.ic_warehouse w ON w.code = d.warehouse
     ${filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : ""}
     ORDER BY d.date_register DESC NULLS LAST, d.roworder DESC
     LIMIT $${args.length}`,
    args,
  );

  const out: DefectPhotoRow[] = rows.map(({ image_urls, ...r }) => ({
    ...r,
    images: (image_urls ?? []).map((image_url) => ({ image_url, url: defectImageUrl(image_url) })),
  }));

  return NextResponse.json({
    kpi: {
      entries: out.length,
      images: out.reduce((sum, r) => sum + r.images.length, 0),
      no_photo: out.filter((r) => r.images.length === 0).length,
      no_sn: out.filter((r) => !r.sn).length,
    },
    rows: out,
  });
}

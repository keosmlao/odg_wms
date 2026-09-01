import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  MAX_IMAGES_PER_UPLOAD,
  MAX_IMAGE_BYTES,
  defectImageFilename,
  deleteDefectImage,
  nextDefectCodeRef,
  readUploadForm,
  saveDefectImage,
} from "@/lib/defects";
import {
  DEFECT_STATUS,
  isDefectGrade,
  type DefectSummaryRow,
} from "@/lib/defects-shared";

/**
 * Defective-goods balance report (ລາຍງານຄົງເຫຼືອເຄື່ອງມີຕຳນິ) and registration.
 *
 * GET  ?status=0|1&wh=&brand=&q=&group=warehouse|item
 *        status 0 = ຍັງບໍ່ເບີກຈ່າຍ (default), 1 = ເບີກຈ່າຍແລ້ວ.
 *        group  = warehouse (default, one row per item+warehouse) or item
 *                 (one row per item, summed across warehouses — the legacy
 *                 report's default view).
 * POST multipart/form-data — register one defect entry plus its photos.
 */

type SummaryQueryRow = DefectSummaryRow & { total_qty: string };

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
  const byWarehouse = (url.searchParams.get("group") ?? "warehouse") !== "item";

  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [status];
  const filters = ["d.status = $1"];
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
    // Serial search covers both numbers. `odg_product_defect.isn` exists but is
    // empty on all 1,699 legacy rows, so matching it alone would find nothing
    // historic — the EXISTS resolves an entry's stored serial back through
    // sn_inventory (keyed by either column, both UNIQUE) to reach its ISN.
    filters.push(
      `(d.ic_code ILIKE ${p} OR d.ic_name ILIKE ${p}
        OR d.sn ILIKE ${p} OR d.isn ILIKE ${p}
        OR EXISTS (
          SELECT 1 FROM public.sn_inventory s
          WHERE (s.sn = d.sn OR s.isn = d.sn) AND s.isn ILIKE ${p}
        ))`,
    );
  }

  // Grouping key: item+warehouse, or item alone (totals across warehouses).
  const groupCols = byWarehouse ? "d.ic_code, d.warehouse" : "d.ic_code";
  const warehouseSelect = byWarehouse
    ? "d.warehouse, MAX(w.name_1) AS warehouse_name"
    : "NULL::text AS warehouse, NULL::text AS warehouse_name";

  const rows = await query<SummaryQueryRow>(
    `WITH img AS (
       SELECT code_ref, COUNT(*)::int AS n
       FROM public.odg_product_defect_image
       GROUP BY code_ref
     )
     SELECT
       d.ic_code,
       MAX(d.ic_name)                                   AS ic_name,
       SUM(d.qty)::numeric::text                        AS qty,
       MAX(d.unit_code)                                 AS unit_code,
       MAX(d.item_brand)                                AS item_brand,
       ${warehouseSelect},
       COUNT(*)::int                                    AS entries,
       to_char(MAX(d.date_register), 'DD-MM-YYYY HH24:MI') AS last_register,
       COALESCE(SUM(img.n), 0)::int                     AS images,
       COUNT(*) FILTER (WHERE d.grade = 'A')::int       AS grade_a,
       COUNT(*) FILTER (WHERE d.grade = 'B')::int       AS grade_b,
       COUNT(*) FILTER (WHERE d.grade = 'C')::int       AS grade_c,
       COUNT(*) FILTER (WHERE COALESCE(d.grade, '') = '')::int AS grade_none,
       SUM(SUM(d.qty)) OVER ()::numeric::text           AS total_qty
     FROM public.odg_product_defect d
     LEFT JOIN public.ic_warehouse w ON w.code = d.warehouse
     LEFT JOIN img ON img.code_ref = d.code_ref
     WHERE ${filters.join(" AND ")}
     GROUP BY ${groupCols}
     ORDER BY MAX(d.date_register) DESC NULLS LAST`,
    args,
  );

  const totalQty = rows.length > 0 ? Number.parseFloat(rows[0].total_qty) || 0 : 0;
  const totalEntries = rows.reduce((sum, r) => sum + r.entries, 0);

  return NextResponse.json({
    kpi: {
      groups: rows.length,
      entries: totalEntries,
      total_qty: totalQty,
      images: rows.reduce((sum, r) => sum + r.images, 0),
      grade_c: rows.reduce((sum, r) => sum + r.grade_c, 0),
    },
    rows: rows.map(({ total_qty: _total, ...r }) => r),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const upload = await readUploadForm(request);
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: upload.status });
  }
  const form = upload.form;

  const str = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  const itemCode = str("item_code");
  const warehouse = str("warehouse");
  const grade = str("grade");
  const sn = str("sn");
  // Sent when the entry was filled from a serial scan. Storing it makes an
  // ISN searchable directly instead of via a join back through sn_inventory.
  const isn = str("isn");
  const remark = str("remark");
  const qty = Number.parseFloat(str("qty"));

  if (!itemCode) return NextResponse.json({ error: "ກະລຸນາເລືອກສິນຄ້າ" }, { status: 400 });
  if (!warehouse) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "ຈຳນວນຕ້ອງໃຫຍ່ກວ່າ 0" }, { status: 400 });
  }
  if (!isDefectGrade(grade)) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກເກຣດ (A/B/C)" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(warehouse)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  // The warehouse must be one that holds a defect shelf.
  const whRow = await query<{ code: string }>(
    `SELECT code FROM public.odg_defect_warehouse WHERE code = $1`,
    [warehouse],
  );
  if (whRow.length === 0) {
    return NextResponse.json({ error: "ສາງນີ້ບໍ່ມີບ່ອນເກັບເຄື່ອງມີຕຳນິ" }, { status: 400 });
  }

  // Name / unit / brand come from the item master, not the client.
  const itemRow = await query<{
    name_1: string | null;
    unit_code: string | null;
    item_brand: string | null;
  }>(
    `SELECT name_1, COALESCE(NULLIF(unit_standard, ''), unit_cost) AS unit_code, item_brand
     FROM public.ic_inventory WHERE code = $1`,
    [itemCode],
  );
  if (itemRow.length === 0) {
    return NextResponse.json({ error: `ບໍ່ພົບສິນຄ້າ ${itemCode}` }, { status: 400 });
  }
  const item = itemRow[0];

  // Collect + validate the photos before opening the transaction.
  const uploads = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_IMAGES_PER_UPLOAD);
  for (const f of uploads) {
    if (f.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `ຮູບ ${f.name} ໃຫຍ່ເກີນ ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB` },
        { status: 400 },
      );
    }
    if (!defectImageFilename(itemCode, 0, f.name)) {
      return NextResponse.json({ error: `ຮູບ ${f.name} ບໍ່ຮອງຮັບ` }, { status: 400 });
    }
  }

  const client = await pool.connect();
  const written: string[] = [];
  try {
    await client.query("BEGIN");
    const codeRef = await nextDefectCodeRef(client);

    await client.query(
      `INSERT INTO public.odg_product_defect
         (ic_code, ic_name, unit_code, qty, item_brand, sn, isn, remark,
          date_register, warehouse, status, code_ref, grade)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, LOCALTIMESTAMP(0), $9, $10, $11, $12)`,
      [
        itemCode,
        item.name_1,
        item.unit_code,
        qty,
        item.item_brand,
        sn || null,
        isn || null,
        remark || null,
        warehouse,
        DEFECT_STATUS.pending,
        codeRef,
        grade,
      ],
    );

    for (const [index, file] of uploads.entries()) {
      const filename = defectImageFilename(itemCode, index, file.name);
      if (!filename) continue;
      await saveDefectImage(filename, new Uint8Array(await file.arrayBuffer()));
      written.push(filename);
      await client.query(
        `INSERT INTO public.odg_product_defect_image
           (ic_code, image_url, status, line_number, code_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [itemCode, filename, index, codeRef],
      );
    }

    // Round 1 = the original registration.
    await client.query(
      `INSERT INTO public.odg_product_defect_history (code_ref, round, warehouse, user_created)
       VALUES ($1, 1, $2, $3)`,
      [codeRef, warehouse, session.employee_code],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, code_ref: codeRef, images: written.length });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // The rows are gone; drop the orphaned files too.
    await Promise.all(written.map((f) => deleteDefectImage(f)));
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

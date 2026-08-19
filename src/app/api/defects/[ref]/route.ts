import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { defectImageUrl, logDefectHistory } from "@/lib/defects";
import {
  isDefectGrade,
  type DefectEntry,
  type DefectImage,
} from "@/lib/defects-shared";

/**
 * A single defect entry, keyed by `code_ref`.
 *
 * GET   → the entry plus its photos and edit history.
 * PATCH → update qty / sn / warehouse / grade / remark, appending an audit round
 *         (mirrors the legacy `update_productdf`).
 */

type HistoryRow = { round: number; warehouse: string | null; user_created: string | null; at: string | null };

async function loadEntry(ref: string): Promise<DefectEntry | null> {
  type Row = Omit<DefectEntry, "photos"> & {
    image_urls: string[] | null;
    image_lines: number[] | null;
  };
  const rows = await query<Row>(
    `WITH img AS (
       SELECT code_ref,
              COUNT(*)::int AS n,
              array_agg(image_url ORDER BY line_number)  AS urls,
              array_agg(line_number ORDER BY line_number) AS lines
       FROM public.odg_product_defect_image
       WHERE COALESCE(image_url, '') <> '' AND code_ref = $1
       GROUP BY code_ref
     )
     SELECT
       d.code_ref,
       d.ic_code,
       d.ic_name,
       d.qty::numeric::text AS qty,
       d.unit_code,
       d.item_brand,
       d.warehouse,
       w.name_1 AS warehouse_name,
       d.sn,
       d.remark,
       d.grade,
       d.status,
       to_char(d.date_register, 'DD-MM-YYYY HH24:MI') AS date_register,
       COALESCE(img.n, 0) AS images,
       img.urls  AS image_urls,
       img.lines AS image_lines
     FROM public.odg_product_defect d
     LEFT JOIN public.ic_warehouse w ON w.code = d.warehouse
     LEFT JOIN img ON img.code_ref = d.code_ref
     WHERE d.code_ref = $1`,
    [ref],
  );
  const row = rows[0];
  if (!row) return null;
  const { image_urls, image_lines, ...rest } = row;
  return {
    ...rest,
    photos: (image_urls ?? []).map((image_url, i) => ({
      line_number: image_lines?.[i] ?? i,
      image_url,
      url: defectImageUrl(image_url),
    })),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { ref } = await params;
  const entry = await loadEntry(ref);
  if (!entry) return NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (!entry.warehouse || !accessible.includes(entry.warehouse))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [images, history] = await Promise.all([
    query<{ line_number: number; image_url: string }>(
      `SELECT line_number, image_url
       FROM public.odg_product_defect_image
       WHERE code_ref = $1 AND COALESCE(image_url, '') <> ''
       ORDER BY line_number`,
      [ref],
    ),
    query<HistoryRow>(
      `SELECT round, warehouse, user_created,
              to_char(create_date_time_now, 'DD-MM-YYYY HH24:MI') AS at
       FROM public.odg_product_defect_history
       WHERE code_ref = $1
       ORDER BY round`,
      [ref],
    ),
  ]);

  const withUrls: DefectImage[] = images.map((i) => ({ ...i, url: defectImageUrl(i.image_url) }));
  return NextResponse.json({ entry, images: withUrls, history });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { ref } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const qty = Number.parseFloat(str(body.qty));
  const warehouse = str(body.warehouse);
  const grade = str(body.grade);
  const sn = str(body.sn);
  const remark = str(body.remark);

  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: "ຈຳນວນຕ້ອງໃຫຍ່ກວ່າ 0" }, { status: 400 });
  }
  if (!warehouse) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!isDefectGrade(grade)) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກເກຣດ (A/B/C)" }, { status: 400 });
  }

  const current = await loadEntry(ref);
  if (!current) return NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 });

  // Both the entry's current warehouse and the new one must be in scope, so an
  // entry can't be moved into or out of a warehouse the user can't see.
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible)) {
    if (!current.warehouse || !accessible.includes(current.warehouse)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    if (!accessible.includes(warehouse)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງປາຍທາງ" }, { status: 403 });
    }
  }

  const whRow = await query<{ code: string }>(
    `SELECT code FROM public.odg_defect_warehouse WHERE code = $1`,
    [warehouse],
  );
  if (whRow.length === 0) {
    return NextResponse.json({ error: "ສາງນີ້ບໍ່ມີບ່ອນເກັບເຄື່ອງມີຕຳນິ" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE public.odg_product_defect
         SET qty = $1, sn = $2, warehouse = $3, remark = $4, grade = $5
       WHERE code_ref = $6`,
      [qty, sn || null, warehouse, remark || null, grade, ref],
    );
    await logDefectHistory(client, ref, warehouse, session.employee_code);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, entry: await loadEntry(ref) });
}

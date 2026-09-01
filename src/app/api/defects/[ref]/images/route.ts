import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  MAX_IMAGES_PER_UPLOAD,
  MAX_IMAGE_BYTES,
  defectImageFilename,
  defectImageUrl,
  deleteDefectImage,
  nextDefectImageLine,
  readUploadForm,
  saveDefectImage,
} from "@/lib/defects";
import type { DefectImage } from "@/lib/defects-shared";

/**
 * Photos of one defect entry (ຮູບພາບເຄື່ອງມີຕຳນິ).
 *
 * POST   multipart `files` — append photos (legacy `save_more_image`).
 * DELETE ?line=<line_number> — remove one photo, row and file (legacy
 *        `delete_pic_defect`).
 */

async function guard(ref: string) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 }) };
  }
  if (!session.role) {
    return { error: NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 }) };
  }
  const rows = await query<{ ic_code: string; warehouse: string | null }>(
    `SELECT ic_code, warehouse FROM public.odg_product_defect WHERE code_ref = $1`,
    [ref],
  );
  if (rows.length === 0) {
    return { error: NextResponse.json({ error: "ບໍ່ພົບລາຍການ" }, { status: 404 }) };
  }
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (!rows[0].warehouse || !accessible.includes(rows[0].warehouse))) {
    return { error: NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 }) };
  }
  return { entry: rows[0] };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const g = await guard(ref);
  if (g.error) return g.error;
  const itemCode = g.entry.ic_code;

  const upload = await readUploadForm(request);
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: upload.status });
  }
  const form = upload.form;

  const uploads = form
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0)
    .slice(0, MAX_IMAGES_PER_UPLOAD);
  if (uploads.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີຮູບໃຫ້ອັບໂຫຼດ" }, { status: 400 });
  }
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
  const added: DefectImage[] = [];
  try {
    await client.query("BEGIN");
    let line = await nextDefectImageLine(client, ref);
    for (const file of uploads) {
      const filename = defectImageFilename(itemCode, line, file.name);
      if (!filename) continue;
      await saveDefectImage(filename, new Uint8Array(await file.arrayBuffer()));
      written.push(filename);
      await client.query(
        `INSERT INTO public.odg_product_defect_image
           (ic_code, image_url, status, line_number, code_ref)
         VALUES ($1, $2, 0, $3, $4)`,
        [itemCode, filename, line, ref],
      );
      added.push({ line_number: line, image_url: filename, url: defectImageUrl(filename) });
      line += 1;
    }
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, images: added });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    await Promise.all(written.map((f) => deleteDefectImage(f)));
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ ref: string }> },
) {
  const { ref } = await params;
  const g = await guard(ref);
  if (g.error) return g.error;

  const line = Number.parseInt(new URL(request.url).searchParams.get("line") ?? "", 10);
  if (!Number.isInteger(line)) {
    return NextResponse.json({ error: "ຕ້ອງລະບຸ line" }, { status: 400 });
  }

  // Delete the row first: if the file is already missing the listing still heals.
  const removed = await query<{ image_url: string }>(
    `DELETE FROM public.odg_product_defect_image
     WHERE code_ref = $1 AND line_number = $2
     RETURNING image_url`,
    [ref, line],
  );
  if (removed.length === 0) return NextResponse.json({ error: "ບໍ່ພົບຮູບ" }, { status: 404 });
  await deleteDefectImage(removed[0].image_url);

  return NextResponse.json({ ok: true });
}

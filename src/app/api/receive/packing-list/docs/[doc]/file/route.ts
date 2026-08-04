import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ດາວໂຫຼດໄຟລ໌ຕົ້ນສະບັບຂອງໃບ packing (Excel ທີ່ນຳເຂົ້າ ຫຼື PDF ທີ່ແນບ).
 *   GET ?id=<wms_packing_list_file.roworder>
 */
export async function GET(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const { doc } = await ctx.params;
  const id = Number.parseInt(new URL(request.url).searchParams.get("id") ?? "", 10);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  const rows = await query<{
    file_name: string | null; mime_type: string | null; content: Buffer | null; wh_code: string;
  }>(
    `SELECT f.file_name, f.mime_type, f.content, h.wh_code
       FROM public.wms_packing_list_file f
       JOIN public.wms_packing_list h ON h.doc_no = f.doc_no
      WHERE f.roworder = $1 AND f.doc_no = $2`,
    [id, doc],
  );
  const file = rows[0];
  if (!file || !file.content) return NextResponse.json({ error: "ບໍ່ພົບໄຟລ໌" }, { status: 404 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(file.wh_code)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const name = file.file_name ?? `${doc}.bin`;
  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

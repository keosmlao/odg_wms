import { NextResponse } from "next/server";
import { open, stat } from "node:fs/promises";
import { getSession } from "@/lib/session";
import { resolveDefectImagePath, sniffImageContentType } from "@/lib/defects";

/**
 * Serve a defect photo out of the shared upload folder.
 *
 * The folder is outside the Next.js `public/` tree (it belongs to the legacy
 * Flask app), so it can't be served statically — this handler streams it after
 * checking the session and confining the path to the upload root.
 *
 * The content type comes from the file's magic bytes, not its name: four legacy
 * photos are stored as `..._0_jpg` with no dot, and a filename is not evidence of
 * what a file holds. A file that is not a recognised image is refused.
 *
 * Photos are immutable once written (uploads always get a fresh filename), so
 * responses carry a strong ETag and honour If-None-Match, making repeat views of
 * a gallery 304s instead of re-sending megabytes.
 *
 * GET /api/defects/images/<image_url>
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  // Next has already decoded the route segment; decoding again would corrupt a
  // filename that legitimately contains a '%'.
  const { name } = await params;
  const full = resolveDefectImagePath(name);
  if (!full) return NextResponse.json({ error: "ຊື່ໄຟລ໌ບໍ່ຖືກຕ້ອງ" }, { status: 400 });

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(full);
  } catch {
    return NextResponse.json({ error: "ບໍ່ພົບຮູບ" }, { status: 404 });
  }
  if (!info.isFile()) return NextResponse.json({ error: "ບໍ່ພົບຮູບ" }, { status: 404 });

  const etag = `"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, max-age=86400" },
    });
  }

  // Read the header first to decide the type, then the rest — a file that isn't
  // an image is refused without its contents ever being sent.
  let bytes: Buffer;
  let contentType: string | null;
  const handle = await open(full, "r");
  try {
    const head = Buffer.alloc(Math.min(16, info.size));
    if (head.length > 0) await handle.read(head, 0, head.length, 0);
    contentType = sniffImageContentType(head);
    if (!contentType) {
      return NextResponse.json({ error: "ໄຟລ໌ນີ້ບໍ່ແມ່ນຮູບ" }, { status: 415 });
    }
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      ETag: etag,
      "Last-Modified": new Date(info.mtimeMs).toUTCString(),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

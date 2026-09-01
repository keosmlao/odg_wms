import "server-only";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";
import type { DefectEntry } from "@/lib/defects-shared";

/**
 * Defective-goods register (ສິນຄ້າມີຕຳນິ) — shared server helpers.
 *
 * Ported from the legacy Flask app (`odg/stock.py`), which reads and writes the
 * same four tables. Both apps run against one database, so the storage contract
 * is fixed and must not drift:
 *
 *   odg_product_defect          one row per registered defect entry, keyed by
 *                               `code_ref` (a varchar holding a decimal counter).
 *                               `status` 0 = ຍັງບໍ່ເບີກຈ່າຍ, 1 = ເບີກຈ່າຍແລ້ວ.
 *   odg_product_defect_image    photos of an entry; `line_number` is 0-based and
 *                               `image_url` is a bare filename under the shared
 *                               upload folder (see `defectUploadDir`).
 *   odg_product_defect_history  one row per edit round (append-only audit).
 *   odg_defect_warehouse        the warehouses that hold a defect shelf.
 */

/**
 * Shelf codes that hold defective stock. In the SML shelf master every
 * warehouse's defect shelf ends in `2` (name_1 = "ສະພາບຕຳນິ"); a handful of
 * older Donnoktiew shelves are listed explicitly. Mirrors `Start_Get_Defect_Sml`.
 */
export const EXTRA_DEFECT_SHELVES = ["120107", "120207", "120307", "120407"];

/**
 * Folder holding the defect photos, inside this project so the app owns its own
 * storage and carries no dependency on where the legacy Flask app is installed.
 * Created on first upload; override with DEFECT_UPLOAD_DIR.
 *
 * It sits beside `public/` rather than inside it on purpose: photos are served
 * through /api/defects/images/<name>, which checks the session first. Under
 * `public/` they would be world-readable to anyone holding the filename.
 *
 * Photos registered by the Flask app before this change stay in its own
 * `static/upload/` and are not read from here — the two apps no longer share a
 * folder, so a photo taken in one does not appear in the other.
 */
export function defectUploadDir(): string {
  return process.env.DEFECT_UPLOAD_DIR ?? path.join(process.cwd(), "uploads", "defects");
}

/** Extensions accepted for NEW uploads. Reading is decided by content, below. */
const ALLOWED_IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);

/**
 * Content type from the file's own magic bytes rather than its name.
 *
 * The filename is not evidence of what a file contains, and in this data it is
 * not even reliable: four legacy photos are named `..._0_jpg` with no dot, so an
 * extension allowlist refused real JPEGs. Sniffing serves those correctly and is
 * the stricter check besides — a file must actually *be* an image to be sent.
 * Returns null for anything unrecognised.
 */
export function sniffImageContentType(head: Uint8Array): string | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return null;
}

/**
 * Resolve a stored `image_url` to an absolute path inside the upload folder.
 *
 * `image_url` comes from the database and is rendered into a URL, so it is
 * treated as untrusted. Path confinement is the security control: the value must
 * be a bare filename and must still resolve inside the upload root. The file's
 * type is checked separately, from its bytes, once it is open.
 */
export function resolveDefectImagePath(imageUrl: string): string | null {
  const name = imageUrl.trim();
  if (!name || name === "." || name === "..") return null;
  if (name !== path.basename(name)) return null;
  // Reject anything that could be read as a path or a Windows drive/stream.
  if (/[\\/:*?"<>|\0]/.test(name)) return null;
  const root = path.resolve(defectUploadDir());
  const full = path.resolve(root, name);
  if (path.dirname(full) !== root) return null;
  return full;
}

/**
 * Build the on-disk filename for a new photo, keeping the legacy
 * `<item>_<line>_<original>` shape so the Flask app's listings stay readable.
 * Anything that could escape the folder or collide is stripped.
 */
export function defectImageFilename(
  itemCode: string,
  lineNumber: number,
  originalName: string,
): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_IMAGE_EXT.has(ext)) return null;
  const stem = path
    .basename(originalName, path.extname(originalName))
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .slice(0, 60);
  const safeItem = itemCode.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
  // A random suffix keeps two uploads of "photo.jpg" for the same item apart.
  const salt = Math.random().toString(36).slice(2, 8);
  return `${safeItem}_${lineNumber}_${stem}_${salt}${ext}`;
}

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGES_PER_UPLOAD = 20;

/**
 * Ceiling on the whole multipart body — every photo in the request plus the
 * text fields — as opposed to MAX_IMAGE_BYTES, which is per photo.
 *
 * `middleware.ts` matches every path, so Next clones the request body to hand to
 * it and caps that clone at `experimental.proxyClientMaxBodySize` (default 10MB,
 * unset in next.config.ts). Past the cap it ends the stream early and only logs
 * a warning: the handler is then given a multipart body whose closing boundary
 * never arrives, `formData()` throws, and the cause is invisible to the caller.
 *
 * So the size has to be checked here, before the parse, to say what is actually
 * wrong. Raise `proxyClientMaxBodySize` and this together or neither — a larger
 * value here alone just moves the failure back to the silent truncation.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const asMb = (bytes: number) => Math.max(1, Math.round(bytes / 1024 / 1024));

/**
 * Read a multipart upload, reporting a too-large body as such instead of as a
 * parse error. Returns the form, or the message and status to reply with.
 */
export async function readUploadForm(
  request: Request,
): Promise<{ ok: true; form: FormData } | { ok: false; error: string; status: number }> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      // Worded to fit one oversized photo as well as several small ones, since
      // only the total is known here.
      error:
        `ຂໍ້ມູນທີ່ສົ່ງ ${asMb(declared)}MB ໃຫຍ່ເກີນ ${asMb(MAX_UPLOAD_BYTES)}MB ` +
        `— ກະລຸນາອັບໜ້ອຍຮູບລົງຕໍ່ເທື່ອ ຫຼື ຫຼຸດຂະໜາດຮູບ`,
      status: 413,
    };
  }
  try {
    return { ok: true, form: await request.formData() };
  } catch {
    // A truncated body lands here as well as a genuinely malformed one, so the
    // message names the likely cause rather than asserting one.
    return {
      ok: false,
      error:
        `ອ່ານຮູບບໍ່ໄດ້ — ອາດຍ້ອນຮູບລວມກັນໃຫຍ່ເກີນ ${asMb(MAX_UPLOAD_BYTES)}MB ຫຼື ການເຊື່ອມຕໍ່ຂາດ`,
      status: 400,
    };
  }
}

/** Write one photo into the upload folder. */
export async function saveDefectImage(filename: string, bytes: Uint8Array): Promise<void> {
  const dir = defectUploadDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, filename), bytes);
}

/** Best-effort delete; a missing file is not an error (the row still goes). */
export async function deleteDefectImage(imageUrl: string): Promise<void> {
  const full = resolveDefectImagePath(imageUrl);
  if (!full) return;
  await unlink(full).catch(() => {});
}

/**
 * Allocate the next `code_ref`. The column is a varchar counter with no
 * sequence behind it, so the legacy `max(code_ref)+1` is racy — we take a
 * transaction-scoped advisory lock first, which serialises concurrent inserts
 * without blocking anything else. Must run inside a transaction.
 */
const CODE_REF_LOCK_KEY = 528_4001;

export async function nextDefectCodeRef(client: PoolClient): Promise<string> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CODE_REF_LOCK_KEY]);
  const res = await client.query<{ code_ref: string }>(
    `SELECT COALESCE(MAX(code_ref::bigint), 0)::bigint + 1 AS code_ref
     FROM public.odg_product_defect
     WHERE code_ref ~ '^[0-9]+$'`,
  );
  return res.rows[0].code_ref;
}

/** Next 0-based image line number for an entry. */
export async function nextDefectImageLine(
  client: PoolClient,
  codeRef: string,
): Promise<number> {
  const res = await client.query<{ line: number }>(
    `SELECT COALESCE(MAX(line_number), -1) + 1 AS line
     FROM public.odg_product_defect_image
     WHERE code_ref = $1`,
    [codeRef],
  );
  return res.rows[0].line;
}

/**
 * Append an audit round for an entry. Round 1 is the original registration;
 * every later edit increments it.
 *
 * The casts are required, not cosmetic: in `INSERT ... SELECT` Postgres does not
 * infer a parameter's type from the target column, so a bare `$1` in the SELECT
 * list resolves to `text` while the same `$1` in `WHERE code_ref = $1` resolves
 * to `varchar` — which fails with "inconsistent types deduced for parameter $1".
 */
export async function logDefectHistory(
  client: PoolClient,
  codeRef: string,
  warehouse: string,
  user: string,
): Promise<void> {
  await client.query(
    `INSERT INTO public.odg_product_defect_history (code_ref, round, warehouse, user_created)
     SELECT $1::varchar, COALESCE(MAX(round), 0) + 1, $2::varchar, $3::varchar
     FROM public.odg_product_defect_history
     WHERE code_ref = $1::varchar`,
    [codeRef, warehouse, user],
  );
}

/** Public URL that serves a stored photo through our own route handler. */
export function defectImageUrl(imageUrl: string): string {
  return `/api/defects/images/${encodeURIComponent(imageUrl)}`;
}

/**
 * The individual entries of one item — the detail page's table and
 * GET /api/defects/lines both read through here so they can't drift apart.
 *
 * `scope` is the session's accessible warehouses (`null` = all). Passing `wh`
 * narrows to one warehouse; omitting it returns every warehouse in scope.
 */
export async function loadDefectEntries(opts: {
  code: string;
  wh?: string;
  status: number;
  scope: string[] | null;
}): Promise<DefectEntry[]> {
  const args: unknown[] = [opts.code, opts.status];
  const filters = ["d.ic_code = $1", "d.status = $2"];
  if (Array.isArray(opts.scope)) {
    args.push(opts.scope);
    filters.push(`d.warehouse = ANY($${args.length})`);
  }
  if (opts.wh) {
    args.push(opts.wh);
    filters.push(`d.warehouse = $${args.length}`);
  }

  type Row = Omit<DefectEntry, "photos"> & {
    image_urls: string[] | null;
    image_lines: number[] | null;
  };

  // Photos are aggregated in the same query so the caller never has to fan out
  // one request per row to show thumbnails.
  const rows = await query<Row>(
    `WITH img AS (
       SELECT code_ref,
              COUNT(*)::int AS n,
              array_agg(image_url ORDER BY line_number)  AS urls,
              array_agg(line_number ORDER BY line_number) AS lines
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
     WHERE ${filters.join(" AND ")}
     ORDER BY d.date_register DESC NULLS LAST, d.roworder DESC`,
    args,
  );

  return rows.map(({ image_urls, image_lines, ...r }) => ({
    ...r,
    photos: (image_urls ?? []).map((image_url, i) => ({
      line_number: image_lines?.[i] ?? i,
      image_url,
      url: defectImageUrl(image_url),
    })),
  }));
}

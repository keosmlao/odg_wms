import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  CHECK,
  PACKING_FILE_KIND,
  PACKING_MAX_FILE_BYTES,
  PACKING_STATUS,
  checkPackingRows,
  genPackingDocNo,
  parsePackingSheet,
  type PackingRawRow,
} from "@/lib/packingList";
import { matchPackingLines } from "@/lib/packingMatch";

/**
 * ນຳເຂົ້າໃບ packing (ຂັ້ນທຳອິດຂອງການຮັບສິນຄ້າ).
 *
 * ໃບ packing ຈິງຂອງຜູ້ສະໜອງ **ບໍ່ມີລະຫັດ/ຊື່ SML** — ສະນັ້ນມີ 2 ທາງ:
 *   ① ທາງຫຼັກ: ສົ່ງ `lines` (JSON) ທີ່ມາຈາກລາຍການຄ້າງຮັບຂອງ PO ໃນ SML
 *      ພ້ອມຈຳນວນທີ່ພະນັກງານອ່ານຈາກໃບ packing — ໄຟລ໌ເປັນພຽງຫຼັກຖານແນບ
 *   ② ທາງເສີມ: ສົ່ງ `file` ເປັນ Excel ທີ່ມີລະຫັດ SML (ເຊັ່ນ template ຂອງລະບົບ)
 *      ແລ້ວໃຫ້ລະບົບ parse ເອົາລາຍການ
 *
 *   POST multipart/form-data
 *     lines       — JSON [{po_no, item_code, qty, item_name?, unit_code?}] (ທາງ ①)
 *     file        — Excel/CSV ທີ່ຈະ parse ເປັນລາຍການ (ທາງ ②)
 *     attachment  — PDF ຫຼື ໄຟລ໌ອ້າງອີງ (ແນບໄດ້ຫຼາຍໄຟລ໌)
 *     wh          — ສາງທີ່ຮັບ (ບັງຄັບ)
 *     doc_date    — ວັນທີ່ຮັບ (default = ມື້ນີ້)
 *     ref_no      — ເລກໃບ packing ຂອງຜູ້ສະໜອງ
 *     po          — ເລກ PO ຕັ້ງຕົ້ນ ເມື່ອໃນໄຟລ໌ບໍ່ມີຄໍລຳ PO
 *     remark
 *
 * ບັນທຶກເປັນ draft ສະເໝີ (ເປັນຫຼັກຖານ) — ແຕ່ໃບທີ່ມີແຖວບລັອກ (ເຊັ່ນ PO ຍັງບໍ່
 * ອະນຸມັດ) ຈະຢືນຢັນ/ສ້າງໃບກວດນັບບໍ່ໄດ້ຈົນກວ່າຈະແກ້ໃຫ້ຖືກ.
 */
const SHEET_EXT = /\.(xlsx|xls|csv)$/i;

/** ຫົວຄໍລຳຂອງ template — ຕ້ອງກົງກັບ HEADER_MAP ໃນ src/lib/packingList.ts */
const TEMPLATE_HEADER = ["ໃບສັ່ງຊື້", "ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຫົວໜ່ວຍ", "ຈຳນວນ"];

type PoLineRow = {
  po_no: string; item_code: string; item_name: string | null;
  unit_code: string | null; remaining: string; wh_code: string | null; wh_name: string | null;
};

/**
 * GET → ດາວໂຫຼດ **template Excel** ສຳລັບ mapping ໃບ packing ຂອງຜູ້ສະໜອງ.
 *
 *   ?po=<PO>[,<PO2>...]  → ຕື່ມລາຍການຄ້າງຮັບຂອງ PO ນັ້ນມາໃຫ້ເລີຍ
 *                          (ລະຫັດ · ຊື່ · ຫົວໜ່ວຍ ດຶງຈາກ SML — ຢ່າແກ້)
 *   ບໍ່ມີ po            → template ເປົ່າ + ຕົວຢ່າງ
 *
 * ວິທີໃຊ້: ໂຫຼດ → ຕື່ມຄໍລຳ "ຈຳນວນ" ຕາມໃບ packing ຈິງ → ອັບກັບຄືນ (ແນບ PDF ນຳ).
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const pos = Array.from(new Set(
    url.searchParams.getAll("po").flatMap((v) => v.split(",")).map((v) => v.trim().toUpperCase()).filter(Boolean),
  ));
  const wh = (url.searchParams.get("wh") ?? "").trim();

  let lines: PoLineRow[] = [];
  if (pos.length > 0) {
    const accessible = accessibleWarehouses(session);
    lines = await query<PoLineRow>(
      `SELECT p.doc_no AS po_no, p.item_code,
              COALESCE(inv.name_1, NULLIF(p.item_name,'')) AS item_name,
              COALESCE(inv.unit_standard, p.unit_code) AS unit_code,
              p.qty_balance::text AS remaining,
              w.code AS wh_code, w.name_1 AS wh_name
         FROM public.odg_po_remain p
         JOIN public.ic_warehouse w ON w.name_1 = p.warehouse
         LEFT JOIN public.ic_inventory inv ON inv.code = p.item_code
        WHERE p.doc_no = ANY($1) AND p.qty_balance > 0
          AND p.item_code NOT LIKE '97%'
          ${wh ? "AND w.code = $2" : ""}
        ORDER BY p.doc_no, p.item_code`,
      wh ? [pos, wh] : [pos],
    );
    if (Array.isArray(accessible)) lines = lines.filter((l) => !l.wh_code || accessible.includes(l.wh_code));
  }

  const aoa: (string | number)[][] = [TEMPLATE_HEADER];
  if (lines.length > 0) {
    for (const l of lines) {
      // ຈຳນວນປະວ່າງໄວ້ — ໃຫ້ຜູ້ໃຊ້ຕື່ມຕາມໃບ packing ຈິງ
      aoa.push([l.po_no, l.item_code, l.item_name ?? "", l.unit_code ?? "", ""]);
    }
  } else {
    aoa.push(["POH26050054", "130104-0288", "(ຊື່ຈາກ SML — ບໍ່ຕ້ອງແກ້)", "ອັນ", 10]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 46 }, { wch: 10 }, { wch: 12 }];

  const guide = XLSX.utils.aoa_to_sheet([
    ["ວິທີໃຊ້ template ໃບ packing"],
    [],
    ["1", "ໂຫຼດ template ຕໍ່ 1 ໃບ packing (ລະບຸ PO ເພື່ອໃຫ້ດຶງລາຍການ SML ມາໃຫ້ເລີຍ)"],
    ["2", "ຕື່ມຄໍລຳ ຈຳນວນ ຕາມໃບ packing ຈິງຂອງຜູ້ສະໜອງ — ແຖວທີ່ບໍ່ໄດ້ຮັບ ໃຫ້ລຶບ ຫຼື ປະວ່າງ"],
    ["3", "ຢ່າແກ້ ລະຫັດສິນຄ້າ / ຊື່ສິນຄ້າ — ຕ້ອງເປັນຂອງ SML ເທົ່ານັ້ນ"],
    ["4", "1 ແຖວ = 1 ສິນຄ້າ ຂອງ 1 PO; ໃສ່ຫຼາຍ PO ໃນໄຟລ໌ດຽວໄດ້ (ຕ້ອງເປັນສາງດຽວກັນ)"],
    ["5", "ນຳເຂົ້າທີ່ ຮັບສິນຄ້າເຂົ້າສາງ → ໃບ packing, ແນບ PDF ຕົ້ນສະບັບນຳ"],
    [],
    ["ກົດ", "PO ຕ້ອງອະນຸມັດແລ້ວ (approve_status = 1) ຈຶ່ງຮັບເຂົ້າໄດ້"],
    ["", "ຈຳນວນເກີນຄ້າງຮັບ / ສິນຄ້າບໍ່ຢູ່ໃນ PO = ເຕືອນ (ຮັບໄດ້ ແຕ່ໃຫ້ກວດຄືນ)"],
  ]);
  guide["!cols"] = [{ wch: 6 }, { wch: 86 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "packing");
  XLSX.utils.book_append_sheet(wb, guide, "ວິທີໃຊ້");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const name = pos.length > 0 ? `packing-template-${pos.join("_")}.xlsx` : "packing-template.xlsx";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = String(form.get("wh") ?? "").trim();
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const docDate = String(form.get("doc_date") ?? "").trim();
  if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) {
    return NextResponse.json({ error: "ວັນທີ່ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  /** preview=1 → ອ່ານ · ກວດ · ແນະນຳ ໃຫ້ເບິ່ງ ໂດຍ **ບໍ່ບັນທຶກ** */
  const preview = String(form.get("preview") ?? "") === "1"
    || new URL(request.url).searchParams.get("preview") === "1";
  const refNo = String(form.get("ref_no") ?? "").trim();
  const fallbackPo = String(form.get("po") ?? "").trim();
  const remark = String(form.get("remark") ?? "").trim();

  const sheetIn = form.get("file");
  const sheet = sheetIn instanceof File && sheetIn.size > 0 ? sheetIn : null;
  const attachments = form.getAll("attachment").filter((f): f is File => f instanceof File && f.size > 0);
  const linesJson = String(form.get("lines") ?? "").trim();

  for (const f of [...(sheet ? [sheet] : []), ...attachments]) {
    if (f.size > PACKING_MAX_FILE_BYTES) {
      return NextResponse.json({ error: `ໄຟລ໌ ${f.name} ໃຫຍ່ເກີນ 10MB` }, { status: 400 });
    }
  }

  // ① ລາຍການມາຈາກໜ້າຈໍ (PO ໃນ SML) — ໄຟລ໌ທັງໝົດເປັນຫຼັກຖານແນບເທົ່ານັ້ນ
  let parsed: { rows: PackingRawRow[]; skipped: number };
  let parsedFromFile = false;
  if (linesJson) {
    type LineIn = { po_no?: unknown; item_code?: unknown; qty?: unknown; item_name?: unknown; unit_code?: unknown };
    let raw: LineIn[];
    try {
      raw = JSON.parse(linesJson) as LineIn[];
    } catch {
      return NextResponse.json({ error: "ຂໍ້ມູນລາຍການບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    }
    const rows: PackingRawRow[] = [];
    for (let i = 0; i < (Array.isArray(raw) ? raw.length : 0); i++) {
      const l = raw[i];
      const code = String(l.item_code ?? "").trim();
      const qty = Number.parseFloat(String(l.qty ?? ""));
      if (!code || !Number.isFinite(qty) || qty <= 0) continue;
      rows.push({
        src_row: i + 1,
        po_no: String(l.po_no ?? "").trim().toUpperCase(),
        raw_item_code: code,
        item_name: String(l.item_name ?? "").trim(),
        unit_code: String(l.unit_code ?? "").trim(),
        qty,
      });
    }
    if (rows.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການທີ່ຈະບັນທຶກ" }, { status: 400 });
    parsed = { rows, skipped: 0 };
  } else {
    // ② parse ຈາກ Excel (ຕ້ອງມີລະຫັດ SML ໃນໄຟລ໌ — ເຊັ່ນ template ຂອງລະບົບ)
    if (!sheet) {
      return NextResponse.json({ error: "ບໍ່ມີລາຍການ ແລະ ບໍ່ມີໄຟລ໌ Excel ທີ່ຈະອ່ານ" }, { status: 400 });
    }
    if (!SHEET_EXT.test(sheet.name)) {
      return NextResponse.json({ error: "ໄຟລ໌ລາຍການຕ້ອງເປັນ .xlsx / .xls / .csv" }, { status: 400 });
    }
    try {
      parsed = parsePackingSheet(Buffer.from(await sheet.arrayBuffer()), fallbackPo);
    } catch {
      return NextResponse.json({ error: "ອ່ານໄຟລ໌ Excel ບໍ່ໄດ້" }, { status: 400 });
    }
    parsedFromFile = true;
    if (parsed.rows.length === 0) {
      return NextResponse.json(
        { error: "ບໍ່ພົບລາຍການໃນໄຟລ໌ — ຕ້ອງມີຄໍລຳ ລະຫັດສິນຄ້າ ແລະ ຈຳນວນ" },
        { status: 400 },
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const checked = await checkPackingRows(client, wh, parsed.rows);

    // ── ໂໝດເບິ່ງກ່ອນ (preview): ບໍ່ບັນທຶກຫຍັງ — ພຽງອ່ານ · ກວດ · ແນະນຳ ──
    if (preview) {
      const matched = await matchPackingLines(
        client,
        wh,
        checked.rows.map((r, i) => ({
          id: String(i + 1),
          text: r.src_text ?? r.item_name ?? "",
          qty: r.qty ?? 0,
          item_code: r.item_code,
          supplier_item_code: r.raw_item_code,
        })),
        { supplierCode: checked.suppliers[0]?.code ?? null },
      );
      await client.query("ROLLBACK");
      const poTotals = new Map<string, { po_no: string; lines: number; qty: number }>();
      for (const m of matched.lines) {
        for (const a of m.allocations) {
          const e = poTotals.get(a.po_no) ?? { po_no: a.po_no, lines: 0, qty: 0 };
          e.lines++; e.qty += a.qty; poTotals.set(a.po_no, e);
        }
      }
      return NextResponse.json({
        ok: true,
        preview: true,
        summary: {
          rows_read: parsed.rows.length + parsed.skipped,
          lines: checked.rows.length,
          skipped: parsed.skipped,
          errors: checked.errors,
          warns: checked.warns,
          pos: Array.from(new Set(checked.rows.map((r) => r.po_no).filter(Boolean))),
          attachments: attachments.length,
        },
        lines: checked.rows.map((r, i) => ({
          src_row: r.src_row,
          supplier_item_code: r.raw_item_code,
          src_text: r.src_text ?? r.item_name,
          qty: r.qty,
          po_no: r.po_no,
          item_code: matched.lines[i]?.item_code ?? r.item_code,
          item_name: matched.lines[i]?.item_name ?? r.item_name,
          unit_code: r.unit_code,
          allocations: matched.lines[i]?.allocations ?? [],
          unallocated: matched.lines[i]?.unallocated ?? 0,
          candidates: matched.lines[i]?.candidates ?? [],
          confident: matched.lines[i]?.confident ?? false,
          check_status: r.check_status,
          check_note: matched.lines[i]?.note || r.check_note,
        })),
        po_summary: Array.from(poTotals.values()).sort((a, b) => a.po_no.localeCompare(b.po_no)),
        unresolved: matched.lines.filter((m) => !m.item_code).length,
        over: matched.lines.filter((m) => m.unallocated > 0).length,
      });
    }

    const docNo = await genPackingDocNo(client);
    const totalQty = checked.rows.reduce((s, r) => s + (r.qty ?? 0), 0);
    const supplier = checked.suppliers[0] ?? { code: null, name: null };

    await client.query(
      `INSERT INTO public.wms_packing_list
         (doc_no, doc_date, wh_code, ref_no, supplier_code, supplier_name, status,
          line_count, total_qty, error_count, warn_count, remark, creator_code, create_date_time_now)
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())`,
      [
        docNo, docDate || null, wh, refNo || null, supplier.code, supplier.name,
        PACKING_STATUS.draft, checked.rows.length, totalQty, checked.errors, checked.warns,
        remark || null, session.employee_code,
      ],
    );

    for (let i = 0; i < checked.rows.length; i++) {
      const r = checked.rows[i];
      await client.query(
        `INSERT INTO public.wms_packing_list_detail
           (doc_no, line_order, src_row, po_no, item_code, raw_item_code, item_name,
            unit_code, qty, check_status, check_note, src_text, create_date_time_now)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())`,
        [
          docNo, i + 1, r.src_row, r.po_no || null, r.item_code, r.raw_item_code || null,
          r.item_name || null, r.unit_code || null, r.qty ?? 0, r.check_status, r.check_note || null,
          r.src_text || null,
        ],
      );
    }

    // ໄຟລ໌ຕົ້ນສະບັບ — ເກັບໄວ້ເປັນຫຼັກຖານອ້າງອີງ
    if (sheet) {
      await client.query(
        `INSERT INTO public.wms_packing_list_file
           (doc_no, kind, file_name, mime_type, file_size, content, uploader_code, create_date_time_now)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
        [
          docNo, parsedFromFile ? PACKING_FILE_KIND.excel : PACKING_FILE_KIND.attachment,
          sheet.name, sheet.type || null, sheet.size, Buffer.from(await sheet.arrayBuffer()), session.employee_code,
        ],
      );
    }
    for (const f of attachments) {
      await client.query(
        `INSERT INTO public.wms_packing_list_file
           (doc_no, kind, file_name, mime_type, file_size, content, uploader_code, create_date_time_now)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now())`,
        [docNo, PACKING_FILE_KIND.attachment, f.name, f.type || null, f.size, Buffer.from(await f.arrayBuffer()), session.employee_code],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      doc_no: docNo,
      summary: {
        rows_read: parsed.rows.length + parsed.skipped,
        lines: checked.rows.length,
        skipped: parsed.skipped,
        errors: checked.errors,
        warns: checked.warns,
        pos: Array.from(new Set(checked.rows.map((r) => r.po_no).filter(Boolean))),
        attachments: attachments.length,
      },
      lines: checked.rows.map((r) => ({
        src_row: r.src_row, po_no: r.po_no, item_code: r.item_code, raw_item_code: r.raw_item_code,
        item_name: r.item_name, unit_code: r.unit_code, qty: r.qty,
        ordered: r.ordered, remaining: r.remaining, is_isn: r.is_isn,
        check_status: r.check_status, check_note: r.check_note,
      })),
      blocked: checked.errors > 0,
      block_hint: checked.errors > 0 ? "ມີແຖວທີ່ຕ້ອງແກ້ (ເຊັ່ນ PO ຍັງບໍ່ອະນຸມັດ) — ຍັງສ້າງໃບກວດນັບບໍ່ໄດ້" : null,
      check_legend: { ok: CHECK.ok, warn: CHECK.warn, block: CHECK.block },
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ນຳເຂົ້າບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

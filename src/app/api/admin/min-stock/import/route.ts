import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";
import {
  clearMinStockRules,
  listMinStockRules,
  upsertMinStockRules,
  type MinStockInput,
} from "@/lib/minStock";

/**
 * ນຳເຂົ້າ / ດາວໂຫຼດ ຄ່າ min/max ດ້ວຍ Excel.
 *   GET  ?wh=<code> → template .xlsx (ມີກົດທີ່ຕັ້ງໄວ້ແລ້ວຢູ່ໃນນັ້ນ ໃຫ້ແກ້ແລ້ວອັບກັບ)
 *   POST FormData { file, wh, mode? }  mode=replace → ລົບກົດເກົ່າຂອງສາງກ່ອນ
 *
 * ຮັບສະເພາະລະຫັດທີ່ມີໃນ ic_inventory — ພິມຜິດ 1 ຕົວຈະກາຍເປັນກົດຜີທີ່ບໍ່ມີວັນຕົງ
 * ກັບສິນຄ້າຈິງ ແລະ ຈະຄ້າງຢູ່ໃນລາຍງານ "ຕ່ຳກວ່າຂັ້ນຕ່ຳ" ຕະຫຼອດໄປ.
 */
type RawRow = (string | number | boolean | null | undefined)[];
type RowError = { row: number; message: string };
type ColKey = "code" | "name" | "min" | "max" | "note";

const HEADER_MAP: Record<string, ColKey> = {
  // ລາວ
  "ລະຫັດ": "code",
  "ລະຫັດສິນຄ້າ": "code",
  "ຊື່": "name",
  "ຊື່ສິນຄ້າ": "name",
  "ລາຍຊື່": "name",
  "ຂັ້ນຕ່ຳ": "min",
  "ຂັ້ນຕໍ່າ": "min",
  "ຈຳນວນຂັ້ນຕ່ຳ": "min",
  "ຂັ້ນສູງ": "max",
  "ຈຳນວນຂັ້ນສູງ": "max",
  "ໝາຍເຫດ": "note",
  "ຫມາຍເຫດ": "note",
  // English
  code: "code",
  item_code: "code",
  itemcode: "code",
  name: "name",
  item_name: "name",
  itemname: "name",
  min: "min",
  min_qty: "min",
  minqty: "min",
  minimum: "min",
  max: "max",
  max_qty: "max",
  maxqty: "max",
  maximum: "max",
  note: "note",
  remark: "note",
};

function normalizeHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function parseNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function detectHeader(firstRow: RawRow): {
  hasHeader: boolean;
  cols: { code: number; name: number; min: number; max: number; note: number };
} {
  const map: Partial<Record<ColKey, number>> = {};
  for (let i = 0; i < firstRow.length; i++) {
    const mapped = HEADER_MAP[trim(firstRow[i])] ?? HEADER_MAP[normalizeHeader(firstRow[i])];
    if (mapped && map[mapped] === undefined) map[mapped] = i;
  }
  if (map.code !== undefined && map.min !== undefined) {
    return {
      hasHeader: true,
      cols: {
        code: map.code,
        name: map.name ?? -1,
        min: map.min,
        max: map.max ?? -1,
        note: map.note ?? -1,
      },
    };
  }
  // ບໍ່ມີຫົວຕາຕະລາງ — ຖືວ່າລຽງຕາມ template: ລະຫັດ, ຊື່, ຂັ້ນຕ່ຳ, ຂັ້ນສູງ, ໝາຍເຫດ
  return { hasHeader: false, cols: { code: 0, name: 1, min: 2, max: 3, note: 4 } };
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "ໄຟລ໌ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const whCode = trim(formData.get("wh"));
  if (!whCode) return NextResponse.json({ error: "ຕ້ອງເລືອກສາງ" }, { status: 400 });
  const replace = trim(formData.get("mode")) === "replace";

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "ກະລຸນາເລືອກໄຟລ໌ Excel" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "ໄຟລ໌ວ່າງເປົ່າ" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: "ໄຟລ໌ໃຫຍ່ເກີນ 5MB" }, { status: 400 });

  let rows: RawRow[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return NextResponse.json({ error: "ໄຟລ໌ບໍ່ມີ sheet" }, { status: 400 });
    rows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheetName], {
      header: 1, blankrows: false, defval: null, raw: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? `ບໍ່ສາມາດອ່ານໄຟລ໌: ${err.message}` : "ບໍ່ສາມາດອ່ານໄຟລ໌" },
      { status: 400 },
    );
  }
  if (rows.length === 0) return NextResponse.json({ error: "ໄຟລ໌ບໍ່ມີຂໍ້ມູນ" }, { status: 400 });

  const detection = detectHeader(rows[0]);
  const dataRows = detection.hasHeader ? rows.slice(1) : rows;
  const { code: cCode, min: cMin, max: cMax, note: cNote } = detection.cols;

  const errors: RowError[] = [];
  const byItem = new Map<string, MinStockInput>();

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNumber = detection.hasHeader ? i + 2 : i + 1;
    const itemCode = trim(r[cCode]);
    const min = parseNum(r[cMin]);
    const max = cMax >= 0 ? parseNum(r[cMax]) : null;
    const note = cNote >= 0 ? trim(r[cNote]) || null : null;

    if (!itemCode && min === null) continue; // ແຖວຫວ່າງ
    if (!itemCode) { errors.push({ row: rowNumber, message: "ບໍ່ມີລະຫັດສິນຄ້າ" }); continue; }
    if (itemCode.length > 100) { errors.push({ row: rowNumber, message: "ລະຫັດຍາວເກີນ 100 ຕົວ" }); continue; }
    if (min === null) { errors.push({ row: rowNumber, message: `${itemCode}: ຂັ້ນຕ່ຳບໍ່ຖືກຕ້ອງ` }); continue; }
    if (min < 0) { errors.push({ row: rowNumber, message: `${itemCode}: ຂັ້ນຕ່ຳຕິດລົບ` }); continue; }
    if (max !== null && max < min) { errors.push({ row: rowNumber, message: `${itemCode}: ຂັ້ນສູງນ້ອຍກວ່າຂັ້ນຕ່ຳ` }); continue; }

    // ແຖວຊ້ຳໃນໄຟລ໌ດຽວກັນ — ເອົາແຖວທ້າຍສຸດ
    byItem.set(itemCode, { item_code: itemCode, min_qty: min, max_qty: max, note: note?.slice(0, 200) ?? null });
  }

  // ຕັດລະຫັດທີ່ບໍ່ມີໃນຄັງສິນຄ້າອອກ
  const codes = [...byItem.keys()];
  let unknown: string[] = [];
  if (codes.length > 0) {
    const found = await query<{ code: string }>(
      `SELECT code FROM public.ic_inventory WHERE code = ANY($1)`,
      [codes],
    );
    const ok = new Set(found.map((f) => f.code));
    unknown = codes.filter((c) => !ok.has(c));
    for (const c of unknown) {
      byItem.delete(c);
      errors.push({ row: 0, message: `${c}: ບໍ່ພົບລະຫັດນີ້ໃນຄັງສິນຄ້າ` });
    }
  }

  const valid = [...byItem.values()];
  if (valid.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ບໍ່ມີແຖວທີ່ຖືກຕ້ອງ",
        summary: { rows_read: dataRows.length, rows_valid: 0, rows_invalid: errors.length, saved: 0, cleared: 0 },
        errors: errors.slice(0, 100),
      },
      { status: 400 },
    );
  }

  let cleared = 0;
  try {
    if (replace) cleared = await clearMinStockRules(whCode);
    const saved = await upsertMinStockRules(whCode, valid, guard.session.employee_code ?? null);
    return NextResponse.json({
      ok: true,
      summary: { rows_read: dataRows.length, rows_valid: valid.length, rows_invalid: errors.length, saved, cleared },
      errors: errors.slice(0, 100),
      rules: await listMinStockRules(whCode),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ" }, { status: 400 });
  }
}

/** Template .xlsx — ມີກົດປັດຈຸບັນຂອງສາງໃສ່ໄວ້ ເພື່ອໃຫ້ແກ້ແລ້ວອັບກັບຄືນໄດ້ເລີຍ. */
export async function GET(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const whCode = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!whCode) return NextResponse.json({ error: "ຕ້ອງລະບຸ ?wh=" }, { status: 400 });

  const rules = await listMinStockRules(whCode);
  const header = ["ລະຫັດສິນຄ້າ", "ຊື່ສິນຄ້າ", "ຂັ້ນຕ່ຳ", "ຂັ້ນສູງ", "ໝາຍເຫດ"];
  const body: (string | number | null)[][] = rules.length
    ? rules.map((r) => [r.item_code, r.item_name ?? "", r.min_qty, r.max_qty, r.note ?? ""])
    : [["110101-0001", "ຕົວຢ່າງສິນຄ້າ", 5, 40, "ຂາຍໄວ"]];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = [{ wch: 18 }, { wch: 44 }, { wch: 10 }, { wch: 10 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, ws, "min-max");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="min-stock-${whCode}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

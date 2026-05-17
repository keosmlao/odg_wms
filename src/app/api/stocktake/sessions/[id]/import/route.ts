import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";
import { requireSessionAccess } from "@/lib/stocktake";

type RawRow = (string | number | boolean | null | undefined)[];

type ParsedRow = {
  row_index: number;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: number;
  team: string;
};

type RowError = { row: number; message: string };

type ColKey = "code" | "name" | "unit" | "qty" | "team";

const HEADER_MAP: Record<string, ColKey> = {
  // Lao
  "ລະຫັດ": "code",
  "ລະຫັດສິນຄ້າ": "code",
  "ລາຍຊື່": "name",
  "ຊື່": "name",
  "ຊື່ສິນຄ້າ": "name",
  "ຫົວໜ່ວຍ": "unit",
  "ຫົວຫນ່ວຍ": "unit",
  "ໜ່ວຍ": "unit",
  "ຫນ່ວຍ": "unit",
  "ຈຳນວນ": "qty",
  "ຈຳນວນທີກວດນັບ": "qty",
  "ຈຳນວນທີ່ກວດນັບ": "qty",
  "ທີມ": "team",
  // English
  code: "code",
  item_code: "code",
  itemcode: "code",
  name: "name",
  item_name: "name",
  itemname: "name",
  unit: "unit",
  uom: "unit",
  unit_code: "unit",
  unitcode: "unit",
  qty: "qty",
  quantity: "qty",
  team: "team",
  label: "team",
  label_code: "team",
  labelcode: "team",
};

function normalizeHeader(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function trim(v: unknown): string {
  return String(v ?? "").trim();
}

function detectHeader(firstRow: RawRow): {
  hasHeader: boolean;
  cols: { code: number; name: number; unit: number; qty: number; team: number };
} {
  const map: Partial<Record<ColKey, number>> = {};
  for (let i = 0; i < firstRow.length; i++) {
    const key = normalizeHeader(firstRow[i]);
    const mapped = HEADER_MAP[String(firstRow[i] ?? "").trim()] ?? HEADER_MAP[key];
    if (mapped && map[mapped] === undefined) map[mapped] = i;
  }
  const found = Object.keys(map).length;
  if (found >= 3) {
    return {
      hasHeader: true,
      cols: {
        code: map.code ?? 0,
        name: map.name ?? 1,
        unit: map.unit ?? -1,
        qty: map.qty ?? 2,
        team: map.team ?? 3,
      },
    };
  }
  // No header — assume default column order: code, name, unit, qty, team
  return {
    hasHeader: false,
    cols: { code: 0, name: 1, unit: 2, qty: 3, team: 4 },
  };
}

function parseQty(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const guard = await requireSessionAccess(sessionId, { mustBeOpen: true });
  if (!guard.ok) return guard.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "ໄຟລ໌ບໍ່ຖືກຕ້ອງ" },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກໄຟລ໌ Excel" },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "ໄຟລ໌ວ່າງເປົ່າ" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json(
      { error: "ໄຟລ໌ໃຫຍ່ເກີນ 5MB" },
      { status: 400 },
    );
  }

  let rows: RawRow[];
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json(
        { error: "ໄຟລ໌ບໍ່ມີ sheet" },
        { status: 400 },
      );
    }
    const sheet = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
      header: 1,
      blankrows: false,
      defval: null,
      raw: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `ບໍ່ສາມາດອ່ານໄຟລ໌: ${err.message}`
            : "ບໍ່ສາມາດອ່ານໄຟລ໌",
      },
      { status: 400 },
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "ໄຟລ໌ບໍ່ມີຂໍ້ມູນ" }, { status: 400 });
  }

  const detection = detectHeader(rows[0]);
  const dataRows = detection.hasHeader ? rows.slice(1) : rows;
  const { code: cCode, name: cName, unit: cUnit, qty: cQty, team: cTeam } =
    detection.cols;

  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const rowNumber = detection.hasHeader ? i + 2 : i + 1;
    const itemCode = trim(r[cCode]);
    const team = trim(r[cTeam]);
    const qty = parseQty(r[cQty]);
    const itemName = trim(r[cName]) || null;
    const unitCode = cUnit >= 0 ? trim(r[cUnit]) || null : null;

    if (!itemCode && !team && qty === null) continue; // fully blank
    if (!itemCode) {
      errors.push({ row: rowNumber, message: "ບໍ່ມີລະຫັດ" });
      continue;
    }
    if (!team) {
      errors.push({ row: rowNumber, message: "ບໍ່ມີທີມ/ປ້າຍ" });
      continue;
    }
    if (qty === null) {
      errors.push({ row: rowNumber, message: "ຈຳນວນບໍ່ຖືກຕ້ອງ" });
      continue;
    }
    if (qty === 0) {
      errors.push({ row: rowNumber, message: "ຈຳນວນເປັນສູນ" });
      continue;
    }
    if (itemCode.length > 40) {
      errors.push({ row: rowNumber, message: "ລະຫັດຍາວເກີນ 40 ຕົວ" });
      continue;
    }
    if (team.length > 40) {
      errors.push({ row: rowNumber, message: "ປ້າຍຍາວເກີນ 40 ຕົວ" });
      continue;
    }
    if (unitCode && unitCode.length > 20) {
      errors.push({ row: rowNumber, message: "ຫົວໜ່ວຍຍາວເກີນ 20 ຕົວ" });
      continue;
    }
    parsed.push({
      row_index: rowNumber,
      item_code: itemCode,
      item_name: itemName ? itemName.slice(0, 200) : null,
      unit_code: unitCode,
      qty,
      team,
    });
  }

  if (parsed.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ບໍ່ມີແຖວທີ່ຖືກຕ້ອງ",
        summary: {
          rows_read: dataRows.length,
          rows_valid: 0,
          rows_invalid: errors.length,
          labels_created: 0,
          labels_existing: 0,
          lines_inserted: 0,
          lines_skipped_duplicate: 0,
        },
        errors: errors.slice(0, 100),
      },
      { status: 400 },
    );
  }

  // Sum duplicate (team, code) within the upload.
  const merged = new Map<string, ParsedRow>();
  for (const p of parsed) {
    const key = `${p.team}\x00${p.item_code}`;
    const ex = merged.get(key);
    if (ex) {
      ex.qty += p.qty;
      if (!ex.item_name && p.item_name) ex.item_name = p.item_name;
      if (!ex.unit_code && p.unit_code) ex.unit_code = p.unit_code;
    } else {
      merged.set(key, { ...p });
    }
  }
  const mergedRows = Array.from(merged.values());
  const uniqueTeams = Array.from(new Set(mergedRows.map((r) => r.team)));

  const client = await pool.connect();
  let labelsCreated = 0;
  let labelsExisting = 0;
  let linesInserted = 0;
  let linesSkippedDuplicate = 0;

  try {
    await client.query("BEGIN");

    // Upsert labels — track which were newly inserted vs already existed.
    const labelIdByCode = new Map<string, number>();
    for (const teamCode of uniqueTeams) {
      const ins = await client.query<{ label_id: number }>(
        `INSERT INTO public.wms_stocktake_label
           (session_id, label_code, created_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, label_code) DO NOTHING
         RETURNING label_id`,
        [sessionId, teamCode, guard.session.employee_id],
      );
      if (ins.rows[0]) {
        labelIdByCode.set(teamCode, ins.rows[0].label_id);
        labelsCreated++;
      } else {
        const sel = await client.query<{ label_id: number }>(
          `SELECT label_id FROM public.wms_stocktake_label
           WHERE session_id = $1 AND label_code = $2`,
          [sessionId, teamCode],
        );
        if (!sel.rows[0]) throw new Error(`label lookup failed: ${teamCode}`);
        labelIdByCode.set(teamCode, sel.rows[0].label_id);
        labelsExisting++;
      }
    }

    // Insert lines — skip those that conflict with existing (label_id, item_code, NULL, NULL).
    for (const row of mergedRows) {
      const labelId = labelIdByCode.get(row.team);
      if (!labelId) continue;
      const ins = await client.query<{ line_id: number }>(
        `INSERT INTO public.wms_stocktake_line
           (session_id, label_id, item_code, item_name, unit_code, qty, counted_by)
         SELECT $1::int, $2::int, $3::varchar, $4::varchar, $5::varchar, $6::numeric, $7::int
         WHERE NOT EXISTS (
           SELECT 1 FROM public.wms_stocktake_line
           WHERE label_id = $2::int
             AND item_code = $3::varchar
             AND rack_code IS NULL
             AND location_code IS NULL
         )
         RETURNING line_id`,
        [
          sessionId,
          labelId,
          row.item_code,
          row.item_name,
          row.unit_code,
          row.qty,
          guard.session.employee_id,
        ],
      );
      if (ins.rows[0]) {
        linesInserted++;
      } else {
        linesSkippedDuplicate++;
        errors.push({
          row: row.row_index,
          message: `${row.item_code} @ ${row.team} ມີໃນປ້າຍແລ້ວ — ຂ້າມ`,
        });
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ",
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    summary: {
      rows_read: dataRows.length,
      rows_valid: parsed.length,
      rows_invalid: errors.length - linesSkippedDuplicate,
      labels_created: labelsCreated,
      labels_existing: labelsExisting,
      lines_inserted: linesInserted,
      lines_skipped_duplicate: linesSkippedDuplicate,
    },
    errors: errors.slice(0, 100),
  });
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = Number.parseInt(id, 10);
  if (!Number.isFinite(sessionId)) {
    return NextResponse.json({ error: "id ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const guard = await requireSessionAccess(sessionId);
  if (!guard.ok) return guard.response;

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["ລະຫັດ", "ລາຍຊື່", "ຫົວໜ່ວຍ", "ຈຳນວນທີກວດນັບ", "ທີມ"],
    ["IT-0001", "ຕົວຢ່າງສິນຄ້າ", "PCS", 10, "A01"],
    ["IT-0002", "ຕົວຢ່າງສິນຄ້າ 2", "BOX", 5, "A01"],
    ["IT-0003", "ຕົວຢ່າງສິນຄ້າ 3", "PCS", 7, "A02"],
  ]);
  ws["!cols"] = [
    { wch: 16 },
    { wch: 36 },
    { wch: 10 },
    { wch: 16 },
    { wch: 10 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "ກວດນັບ");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const filename = `stocktake-import-template-${guard.row.session_code}.xlsx`;
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

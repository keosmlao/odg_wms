import { basename, resolve } from "node:path";
import pg from "pg";
import XLSX from "xlsx";

const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/import-samsung-serials.mjs <xlsx-file>");
  process.exit(2);
}

const filePath = resolve(input);
const sourceFile = basename(filePath);
const workbook = XLSX.readFile(filePath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
if (!sheet) throw new Error("Excel file does not contain a worksheet");

const rows = XLSX.utils.sheet_to_json(sheet, {
  header: 1,
  defval: null,
  raw: false,
});

const MONTHS = new Map([
  ["JANUARY", 1],
  ["FEBRUARY", 2],
  ["MARCH", 3],
  ["APRIL", 4],
  ["MAY", 5],
  ["JUNE", 6],
  ["JUN", 6],
  ["JULY", 7],
  ["AUGUST", 8],
  ["SEPTEMBER", 9],
  ["OCTOBER", 10],
  ["NOVEMBER", 11],
  ["DECEMBER", 12],
]);

function text(value) {
  if (value == null) return null;
  const result = String(value).trim();
  return result || null;
}

function requiredText(value, label, rowNumber) {
  const result = text(value);
  if (!result) throw new Error(`Row ${rowNumber}: missing ${label}`);
  return result;
}

function integer(value, label, rowNumber) {
  const result = Number.parseInt(requiredText(value, label, rowNumber), 10);
  if (!Number.isInteger(result)) {
    throw new Error(`Row ${rowNumber}: invalid ${label}`);
  }
  return result;
}

function decimal(value, rowNumber) {
  const raw = text(value);
  if (!raw) return 1;
  const result = Number(raw.replaceAll(",", ""));
  if (!Number.isFinite(result)) {
    throw new Error(`Row ${rowNumber}: invalid quantity`);
  }
  return result;
}

const records = rows.slice(1).map((row, index) => {
  const sourceRow = index + 2;
  const year = integer(row[0], "year", sourceRow);
  const monthName = requiredText(row[1], "month", sourceRow);
  const month = MONTHS.get(monthName.toUpperCase());
  if (!month) throw new Error(`Row ${sourceRow}: invalid month "${monthName}"`);
  const day = integer(row[2], "day", sourceRow);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  const isValidDate =
    parsedDate.getUTCFullYear() === year &&
    parsedDate.getUTCMonth() === month - 1 &&
    parsedDate.getUTCDate() === day;
  const recordDate = isValidDate
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;

  return [
    sourceFile,
    sourceRow,
    recordDate,
    year,
    month,
    monthName,
    day,
    requiredText(row[3], "serial number", sourceRow).toUpperCase(),
    requiredText(row[4], "product name", sourceRow),
    text(row[5]),
    text(row[6]),
    decimal(row[7], sourceRow),
    text(row[8]),
    text(row[9]),
    text(row[10]),
  ];
});

const useSsl = (process.env.DATABASE_SSL ?? "false").toLowerCase() === "true";
const client = new pg.Client({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

const columns = [
  "source_file",
  "source_row",
  "record_date",
  "record_year",
  "record_month",
  "month_name",
  "record_day",
  "serial_no",
  "product_name",
  "bill_no",
  "week_label",
  "quantity",
  "quarter_label",
  "note",
  "claim_note",
];

await client.connect();
try {
  await client.query("BEGIN");
  let affected = 0;
  const chunkSize = 500;

  for (let offset = 0; offset < records.length; offset += chunkSize) {
    const chunk = records.slice(offset, offset + chunkSize);
    const values = [];
    const placeholders = chunk.map((record) => {
      const params = record.map((value) => {
        values.push(value);
        return `$${values.length}`;
      });
      return `(${params.join(", ")})`;
    });

    const result = await client.query(
      `INSERT INTO public.wms_samsung_serial (${columns.join(", ")})
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (source_file, source_row) DO UPDATE SET
         record_date = EXCLUDED.record_date,
         record_year = EXCLUDED.record_year,
         record_month = EXCLUDED.record_month,
         month_name = EXCLUDED.month_name,
         record_day = EXCLUDED.record_day,
         serial_no = EXCLUDED.serial_no,
         product_name = EXCLUDED.product_name,
         bill_no = EXCLUDED.bill_no,
         week_label = EXCLUDED.week_label,
         quantity = EXCLUDED.quantity,
         quarter_label = EXCLUDED.quarter_label,
         note = EXCLUDED.note,
         claim_note = EXCLUDED.claim_note,
         imported_at = CURRENT_TIMESTAMP`,
      values,
    );
    affected += result.rowCount ?? 0;
  }

  const itemCodeResult = await client.query(
    `UPDATE public.wms_samsung_serial samsung
     SET item_code = inventory.item_code
     FROM public.sn_inventory inventory
     WHERE samsung.source_file = $1
       AND inventory.sn = samsung.serial_no
       AND samsung.item_code IS DISTINCT FROM inventory.item_code`,
    [sourceFile],
  );

  await client.query("COMMIT");
  console.log(`Imported ${affected.toLocaleString("en-US")} rows from ${sourceFile}`);
  console.log(
    `Stored item codes for ${(itemCodeResult.rowCount ?? 0).toLocaleString("en-US")} rows`,
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}

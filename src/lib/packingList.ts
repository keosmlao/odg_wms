import type { PoolClient } from "pg";
import * as XLSX from "xlsx";
import { needsIsnSql } from "@/lib/isnScope";

/**
 * WMS packing list (ໃບ packing) — ຈຸດເລີ່ມຕົ້ນຂອງການຮັບສິນຄ້າເຂົ້າສາງ.
 *
 *   ໄຟລ໌ Excel/PDF ຂອງຜູ້ສະໜອງ → import → ກວດສອບ (ສິນຄ້າ · PO · ການອະນຸມັດ)
 *   → ໃບກວດນັບ (wms_product_receive doc_type=2) → ຮັບເຂົ້າ WMS
 *
 * ກົດການກວດສອບ: PO ທີ່ຍັງບໍ່ອະນຸມັດ (ic_trans.approve_status <> 1) = ບລັອກ,
 * ສ່ວນອື່ນ (ເກີນຄ້າງຮັບ · ສິນຄ້າບໍ່ຢູ່ໃນ PO · ຄົນລະສາງ) = ເຕືອນເທົ່ານັ້ນ.
 */

/** wms_packing_list.status */
export const PACKING_STATUS = {
  draft: 0, // ນຳເຂົ້າແລ້ວ — ຍັງບໍ່ໄດ້ຢືນຢັນ
  verified: 1, // ກວດສອບຜ່ານ — ພ້ອມສ້າງໃບກວດນັບ
  used: 5, // ສ້າງໃບກວດນັບແລ້ວ
  cancelled: 9,
} as const;

/** wms_packing_list_file.kind */
export const PACKING_FILE_KIND = {
  excel: 1, // ໄຟລ໌ທີ່ parse ເອົາລາຍການ
  attachment: 2, // PDF ຫຼື ໄຟລ໌ອ້າງອີງອື່ນ
} as const;

/** wms_packing_list_detail.check_status */
export const CHECK = {
  ok: 0,
  warn: 1,
  block: 2,
} as const;

export const PACKING_MAX_FILE_BYTES = 10 * 1024 * 1024;

/** ໜຶ່ງແຖວດິບຈາກໄຟລ໌ (ຍັງບໍ່ໄດ້ກວດ). */
export type PackingRawRow = {
  src_row: number;
  po_no: string;
  raw_item_code: string;
  item_name: string;
  unit_code: string;
  qty: number | null;
  /** ຄຳອະທິບາຍຕົ້ນສະບັບ (ລາຍການ + ຂະໜາດ + ຍີ່ຫໍ້) — ໃຊ້ຈັບຄູ່ກັບ SML */
  src_text?: string;
  /** ລະຫັດ SML ທີ່ຈັບຄູ່ໄວ້ແລ້ວ (ຈາກການແກ້ດ້ວຍມື) */
  mapped_item_code?: string | null;
};

/** ແຖວທີ່ກວດສອບແລ້ວ — ພ້ອມຜົນ + ຂໍ້ມູນອ້າງອີງຈາກ PO. */
export type PackingCheckedRow = PackingRawRow & {
  item_code: string | null;
  supplier_code: string | null;
  ordered: number | null;
  remaining: number | null;
  is_isn: boolean;
  check_status: number;
  check_note: string;
};

// ─────────────────────────── Excel parsing ───────────────────────────

type ColKey =
  | "po" | "code" | "name" | "name_en" | "unit" | "qty" | "size" | "brand"
  | "pcs_box" | "boxes" | "box_size";
type RawCell = string | number | boolean | null | undefined;

/**
 * ຫົວຖັນ Excel → ຊື່ຄໍລຳພາຍໃນ. **ຄີພາສາໄທໃນນີ້ແມ່ນຂໍ້ມູນ ບໍ່ແມ່ນຂໍ້ຄວາມ UI** —
 * ມັນຄືຫົວຖັນຈິງທີ່ຜູ້ສະໜອງໄທສົ່ງມາ. ຢ່າແປເປັນລາວ ບໍ່ດັ່ງນັ້ນ import ຈະຈັບຄູ່ບໍ່ໄດ້.
 */
const HEADER_MAP: Record<string, ColKey> = {
  // PO — ພາສາໄທໃຊ້ຫົວ 2 ຊັ້ນ "เลขที่" + "ใบสั่งซื้อ" (ຕ້ອງລວມ 2 ແຖວຈຶ່ງແຍກຈາກ
  // "เลขที่"+"ทะเบียนรถ" ໄດ້) — ຢ່າ map "เลขที่" ດ່ຽວໆ.
  po: "po", pono: "po", po_no: "po", ponumber: "po", purchaseorder: "po",
  bill: "po", billno: "po", bill_no: "po", order: "po", orderno: "po",
  "ໃບສັ່ງຊື້": "po", "ເລກໃບສັ່ງຊື້": "po", "ເລກpo": "po", "ໃບສັ່ງ": "po",
  "ใบสั่งซื้อ": "po", "เลขที่ใบสั่งซื้อ": "po", "เลขทีใบสั่งซื้อ": "po",
  // ລະຫັດສິນຄ້າ
  code: "code", itemcode: "code", item_code: "code", productcode: "code",
  sku: "code", partno: "code", partnumber: "code", model: "code",
  "ລະຫັດ": "code", "ລະຫັດສິນຄ້າ": "code", "ລະຫັດເຄື່ອງ": "code", "ລະຫັດສິນຄ້າ:": "code",
  "รหัส": "code", "รหัสสินค้า": "code",
  // ຊື່ / ຄຳອະທິບາຍສິນຄ້າ
  name: "name", itemname: "name", item_name: "name", productname: "name",
  description: "name", desc: "name", detail: "name", listofgood: "name", "(listofgood)": "name",
  "ລາຍຊື່": "name", "ຊື່": "name", "ຊື່ສິນຄ້າ": "name", "ລາຍລະອຽດ": "name", "ລາຍການ": "name",
  "รายการ": "name", "รายการสินค้า": "name", "ชื่อสินค้า": "name", "รายละเอียด": "name",
  // ໃບຈັດຕຽມສົ່ງອອກ: ຊື່ 2 ພາສາ + ຂໍ້ມູນຫຸ້ມຫໍ່
  "ชื่อสินค้า(ไทย)": "name", "ชื่อสินค้าไทย": "name",
  "ชื่อสินค้า(อังกฤษ)": "name_en", "ชื่อสินค้าอังกฤษ": "name_en", "englishname": "name_en",
  "จำนวนชิ้น": "qty", "จํานวนชิ้น": "qty", "จำนวนชิน": "qty",
  "ชิ้น/กล่อง": "pcs_box", "ชิ้นกล่อง": "pcs_box", "pcs/box": "pcs_box",
  "จำนวนกล่อง": "boxes", "จํานวนกล่อง": "boxes", "boxes": "boxes", "ctns": "boxes",
  "ขนาดกล่อง": "box_size", "boxsize": "box_size",
  // ຂະໜາດ / ຍີ່ຫໍ້ — ໃຊ້ຕໍ່ທ້າຍຄຳອະທິບາຍ ເພື່ອຈັບຄູ່ໃຫ້ຊັດຂຶ້ນ
  size: "size", "(size)": "size", "ຂະໜາດ": "size", "ขนาด": "size",
  brand: "brand", "(brand)": "brand", "ຍີ່ຫໍ້": "brand", "ตราสินค้า": "brand", "ยี่ห้อ": "brand",
  // ຫົວໜ່ວຍ
  unit: "unit", uom: "unit", unitcode: "unit", unit_code: "unit",
  "ຫົວໜ່ວຍ": "unit", "ຫົວຫນ່ວຍ": "unit", "ໜ່ວຍ": "unit", "ຫນ່ວຍ": "unit", "หน่วย": "unit",
  // ຈຳນວນ
  qty: "qty", quantity: "qty", "q'ty": "qty", qty_: "qty", amount: "qty",
  ctn: "qty", carton: "qty", pcs: "qty",
  "ຈຳນວນ": "qty", "ຈຳນວນເຄື່ອງ": "qty", "ຈຳນວນສິນຄ້າ": "qty", "ຈຳນວນທີ່ສົ່ງ": "qty", "ຈຳນວນສົ່ງ": "qty",
  "จำนวน": "qty", "จำนวนที่จัดส่ง": "qty", "ที่จัดส่ง": "qty", "จํานวน": "qty",
};

/** ຮູບແບບເລກ PO ຂອງ ERP: POH26050054 / POT26060089 */
const PO_PATTERN = /\bPO[A-Z]?\d{6,12}\b/gi;

function normHeader(v: unknown): string {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/[.:*]+$/, "");
}

function txt(v: unknown): string {
  return String(v ?? "").trim();
}

/** normalize ຂໍ້ຄວາມຜູ້ສະໜອງ ເພື່ອໃຊ້ເປັນກຸນແຈ alias (ຕັດຊ່ອງວ່າງ/ວັກຕອນອອກ). */
export function normAliasText(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[\s ]+/g, "").replace(/[·.,:;()"']/g, "").slice(0, 400);
}

export function parseQty(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number.parseFloat(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * ຊອກແຖວ header ພາຍໃນ 15 ແຖວທຳອິດ (ໃບ packing ມັກມີຫົວເລື່ອງຢູ່ເທິງ).
 * ຮອງຮັບ header 2 ຊັ້ນ (ເຊັ່ນ "เลขที่" ເທິງ / "ใบสั่งซื้อ" ລຸ່ມ) ໂດຍລວມຂໍ້ຄວາມ
 * ຂອງ 2 ແຖວຕໍ່ຄໍລຳ. ຄືນຕຳແໜ່ງຄໍລຳ + ແຖວທຳອິດຂອງຂໍ້ມູນ.
 */
function findHeader(rows: RawCell[][]): { dataStart: number; cols: Partial<Record<ColKey, number>> } | null {
  const limit = Math.min(rows.length, 15);
  for (let r = 0; r < limit; r++) {
    const cols: Partial<Record<ColKey, number>> = {};
    const next = rows[r + 1] ?? [];
    let usedNext = false;
    const width = Math.max(rows[r].length, next.length);
    for (let c = 0; c < width; c++) {
      const top = normHeader(rows[r][c]);
      const below = normHeader(next[c]);
      // ລວມ 2 ຊັ້ນກ່ອນ (ຊັດເຈນກວ່າ) ແລ້ວຄ່ອຍລອງແຕ່ລະຊັ້ນ
      const key = HEADER_MAP[top + below] ?? HEADER_MAP[top] ?? HEADER_MAP[below];
      if (!key || cols[key] !== undefined) continue;
      cols[key] = c;
      if (!HEADER_MAP[top] && (HEADER_MAP[top + below] || HEADER_MAP[below])) usedNext = true;
    }
    // ຕ້ອງມີຢ່າງໜ້ອຍ "ລະຫັດ/ຊື່" ຄູ່ກັບ "ຈຳນວນ" ຈຶ່ງຖືວ່າເປັນ header
    if (cols.qty !== undefined && (cols.code !== undefined || cols.name !== undefined || cols.name_en !== undefined)) {
      // ຄໍລຳຫົວໜ່ວຍມັກຢູ່ຂວາຂອງ "ຈຳນວນ" ໂດຍບໍ່ມີຫົວຄໍລຳ
      if (cols.unit === undefined) {
        const u = cols.qty + 1;
        const taken = Object.values(cols).includes(u);
        if (!taken && !normHeader(rows[r][u]) && !normHeader(next[u])) cols.unit = u;
      }
      return { dataStart: r + (usedNext ? 2 : 1), cols };
    }
  }
  return null;
}

/** ຮູບແບບ "ລະຫັດຂອງຜູ້ສະໜອງ" ເຊັ່ນ A10000712322 · A100005107AA */
const SUPPLIER_CODE = /^[A-Za-z][A-Za-z0-9-]{4,}$/;

/**
 * ບາງໃບ packing ມີຄໍລຳລະຫັດຜູ້ສະໜອງ **ໂດຍບໍ່ມີຫົວຄໍລຳ** (ເຊັ່ນໃບຈັດຕຽມສົ່ງອອກ).
 * ຫາໃຫ້ໂດຍເບິ່ງວ່າຄໍລຳໃດມີຄ່າຮູບແບບລະຫັດເປັນສ່ວນຫຼາຍ.
 */
function detectCodeColumn(rows: RawCell[][], start: number, taken: number[]): number | undefined {
  const width = Math.max(...rows.slice(start, start + 25).map((r) => r?.length ?? 0), 0);
  let best: { col: number; hits: number } | null = null;
  for (let c = 0; c < width; c++) {
    if (taken.includes(c)) continue;
    let hits = 0;
    let seen = 0;
    for (let r = start; r < Math.min(rows.length, start + 25); r++) {
      const v = txt(rows[r]?.[c]);
      if (!v) continue;
      seen++;
      if (SUPPLIER_CODE.test(v) && /\d/.test(v)) hits++;
    }
    if (seen >= 3 && hits / seen >= 0.6 && (!best || hits > best.hits)) best = { col: c, hits };
  }
  return best?.col;
}

/** ດຶງເລກ PO ທຸກຕົວທີ່ປາກົດຢູ່ໃນ sheet (ໃຊ້ເປັນຄ່າ default ເມື່ອບໍ່ມີຄໍລຳ PO). */
function scanPoNumbers(rows: RawCell[][], upToRow: number): string[] {
  const found = new Set<string>();
  for (let r = 0; r < Math.min(rows.length, upToRow); r++) {
    for (const cell of rows[r]) {
      const m = String(cell ?? "").match(PO_PATTERN);
      if (m) m.forEach((x) => found.add(x.toUpperCase()));
    }
  }
  return Array.from(found);
}

export type ParsedSheet = {
  rows: PackingRawRow[];
  /** PO ທີ່ພົບໃນຫົວເອກະສານ (ໃຊ້ເມື່ອບໍ່ມີຄໍລຳ PO ໃນຕາຕະລາງ) */
  header_pos: string[];
  skipped: number;
};

/**
 * Parse ໄຟລ໌ Excel/CSV ເປັນແຖວ packing list.
 * `fallbackPo` ໃຊ້ເມື່ອແຖວນັ້ນບໍ່ມີເລກ PO ໃນຕົວມັນເອງ.
 */
export function parsePackingSheet(buffer: Buffer, fallbackPo = ""): ParsedSheet {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], header_pos: [], skipped: 0 };
  // blankrows: ເກັບແຖວວ່າງໄວ້ ເພື່ອໃຫ້ src_row ກົງກັບເລກແຖວຈິງໃນໄຟລ໌
  const grid = XLSX.utils.sheet_to_json<RawCell[]>(wb.Sheets[sheetName], {
    header: 1,
    blankrows: true,
    defval: "",
  });

  const head = findHeader(grid);
  // ບໍ່ພົບ header → ໃຊ້ລຳດັບຄໍລຳມາດຕະຖານ: PO · ລະຫັດ · ຊື່ · ໜ່ວຍ · ຈຳນວນ
  const cols: Partial<Record<ColKey, number>> = head?.cols ?? { po: 0, code: 1, name: 2, unit: 3, qty: 4 };
  const startRow = head ? head.dataStart : 0;
  const headerPos = scanPoNumbers(grid, startRow);
  // ຄໍລຳລະຫັດຜູ້ສະໜອງທີ່ບໍ່ມີຫົວຄໍລຳ
  if (head && cols.code === undefined) {
    const found = detectCodeColumn(grid, startRow, Object.values(cols).filter((v): v is number => v !== undefined));
    if (found !== undefined) cols.code = found;
  }

  const rows: PackingRawRow[] = [];
  let skipped = 0;
  for (let r = startRow; r < grid.length; r++) {
    const g = grid[r];
    const at = (k: ColKey) => (cols[k] === undefined ? "" : txt(g[cols[k]!]));
    const rawCode = at("code");
    const name = at("name") || at("name_en");
    const qty = parseQty(cols.qty === undefined ? null : g[cols.qty]);

    const poCell = at("po");
    const poMatch = (poCell || g.map((x) => String(x ?? "")).join(" ")).match(PO_PATTERN);
    const po = (poMatch ? poMatch[0] : poCell).toUpperCase().trim();

    // ແຖວວ່າງ → ຂ້າມ · ແຖວຫົວກຸ່ມ ("หมวด…", "สินค้ามีภาษี") = ບໍ່ມີທັງຈຳນວນ ແລະ PO
    if (!rawCode && !name) continue;
    if (!qty && !po) { skipped++; continue; }

    // ຂໍ້ຄວາມຕົ້ນສະບັບ (ຊື່ 2 ພາສາ + ຂະໜາດ/ຍີ່ຫໍ້) ໃຊ້ຈັບຄູ່ກັບ SML
    const srcText = [at("name_en"), at("name"), at("size"), at("brand")]
      .map((s) => s.trim())
      .filter((s) => s && s !== "-")
      .join(" · ");

    rows.push({
      src_row: r + 1,
      po_no: po || fallbackPo.toUpperCase().trim() || (headerPos.length === 1 ? headerPos[0] : ""),
      raw_item_code: rawCode,
      item_name: name,
      unit_code: at("unit"),
      qty,
      src_text: srcText || name,
    });
  }
  return { rows, header_pos: headerPos, skipped };
}

// ─────────────────────────── Validation ───────────────────────────

type ItemInfo = { code: string; name_1: string | null; unit_code: string | null; is_isn: number | null };
type PoInfo = {
  doc_no: string;
  approve_status: number | null;
  cust_code: string | null;
  cust_name: string | null;
  wh_codes: string | null;
};
type PoLine = { po_no: string; item_code: string; ordered: string; remaining: string };

/** ຫັກຍອດ WMS ທີ່ຮັບແລ້ວ — ອີງ ref_doc_no ຂອງແຖວ, ບໍ່ມີຈຶ່ງໃຊ້ຂອງ header. */
const RECEIVED_PO = `COALESCE(NULLIF(TRIM(rd.ref_doc_no), ''), rh.ref_doc_no)`;

export type CheckResult = {
  rows: PackingCheckedRow[];
  errors: number;
  warns: number;
  suppliers: { code: string | null; name: string | null }[];
  pos: string[];
};

/**
 * ກວດແຕ່ລະແຖວທຽບກັບ ERP: ສິນຄ້າມີແທ້ບໍ່ · PO ມີແທ້ບໍ່ · PO ອະນຸມັດແລ້ວບໍ່ ·
 * ຢູ່ໃນສາງນີ້ບໍ່ · ຈຳນວນເກີນຄ້າງຮັບບໍ່.
 */
export async function checkPackingRows(
  client: PoolClient,
  whCode: string,
  raw: PackingRawRow[],
  supplierCode: string | null = null,
): Promise<CheckResult> {
  // ຈັບຄູ່ຈາກ alias ກ່ອນ — ໃຊ້ໄດ້ 2 ກຸນແຈ:
  //   ① ລະຫັດຂອງຜູ້ສະໜອງ (ເຊັ່ນ A10000712322) — ແນ່ນອນທີ່ສຸດ
  //   ② ຂໍ້ຄວາມຊື່ສິນຄ້າ — ໃຊ້ເມື່ອໄຟລ໌ບໍ່ມີລະຫັດ
  const aliasKeys = Array.from(new Set(
    raw.filter((r) => !r.mapped_item_code)
      .flatMap((r) => [normAliasText(r.raw_item_code), normAliasText(r.src_text ?? r.item_name)])
      .filter(Boolean),
  ));
  const aliasMap = new Map<string, string>();
  if (aliasKeys.length > 0) {
    const a = await client.query<{ source_text_norm: string; item_code: string }>(
      `SELECT DISTINCT ON (source_text_norm) source_text_norm, item_code
         FROM public.wms_packing_item_alias
        WHERE source_text_norm = ANY($1)
          AND (supplier_code IS NULL OR $2::text IS NULL OR supplier_code = $2)
        ORDER BY source_text_norm, (supplier_code = $2) DESC NULLS LAST, hits DESC`,
      [aliasKeys, supplierCode],
    );
    for (const row of a.rows) aliasMap.set(row.source_text_norm, row.item_code);
  }
  /**
   * ລະຫັດ SML ທີ່ຈະໃຊ້: ຈັບຄູ່ດ້ວຍມື → ລະຫັດໃນໄຟລ໌ທີ່ເປັນລະຫັດ SML ຢູ່ແລ້ວ →
   * alias ຈາກລະຫັດຜູ້ສະໜອງ → alias ຈາກຊື່.  ລະຫັດຜູ້ສະໜອງທີ່ຍັງບໍ່ໄດ້ຈັບຄູ່
   * ຈະຄືນເປັນລະຫັດເດີມ ແລ້ວຈຶ່ງຖືກລາຍງານວ່າ "ບໍ່ພົບໃນ SML".
   */
  const resolveCode = (r: PackingRawRow): string => {
    const manual = (r.mapped_item_code ?? "").trim();
    if (manual) return manual;
    const rawCode = r.raw_item_code.trim();
    const byCode = rawCode ? aliasMap.get(normAliasText(rawCode)) : undefined;
    if (byCode) return byCode;
    const byText = aliasMap.get(normAliasText(r.src_text ?? r.item_name));
    if (byText) return byText;
    return rawCode;
  };

  const itemCodes = Array.from(new Set(raw.map(resolveCode).filter(Boolean)));
  const poNos = Array.from(new Set(raw.map((r) => r.po_no.trim()).filter(Boolean)));

  const [itemRes, poRes, lineRes] = await Promise.all([
    itemCodes.length
      ? client.query<ItemInfo>(
          `SELECT i.code, i.name_1, i.unit_standard AS unit_code,
                  (CASE WHEN ${needsIsnSql("i")} THEN 1 ELSE 0 END) AS is_isn
             FROM public.ic_inventory i WHERE i.code = ANY($1)`,
          [itemCodes],
        )
      : Promise.resolve({ rows: [] as ItemInfo[] }),
    poNos.length
      ? client.query<PoInfo>(
          `SELECT t.doc_no, t.approve_status, t.cust_code,
                  (SELECT MAX(p.cust_name) FROM public.odg_po_remain p WHERE p.doc_no = t.doc_no) AS cust_name,
                  (SELECT string_agg(DISTINCT d.wh_code, ',')
                     FROM public.ic_trans_detail d
                    WHERE d.doc_no = t.doc_no AND d.trans_flag = 6) AS wh_codes
             FROM public.ic_trans t
            WHERE t.trans_flag = 6 AND t.doc_no = ANY($1)`,
          [poNos],
        )
      : Promise.resolve({ rows: [] as PoInfo[] }),
    poNos.length
      ? client.query<PoLine>(
          `SELECT d.doc_no AS po_no, d.item_code,
                  SUM(d.qty)::text AS ordered,
                  (COALESCE((SELECT SUM(p.qty_balance) FROM public.odg_po_remain p
                              WHERE p.doc_no = d.doc_no AND p.item_code = d.item_code), 0)
                   - COALESCE((SELECT SUM(rd.qty)
                                 FROM public.wms_product_receive rh
                                 JOIN public.wms_product_receive_detail rd ON rd.doc_no = rh.doc_no
                                WHERE ${RECEIVED_PO} = d.doc_no AND rd.item_code = d.item_code
                                  AND (rh.status = 0 OR rh.status IS NULL)), 0))::text AS remaining
             FROM public.ic_trans_detail d
            WHERE d.trans_flag = 6 AND d.doc_no = ANY($1)
            GROUP BY d.doc_no, d.item_code`,
          [poNos],
        )
      : Promise.resolve({ rows: [] as PoLine[] }),
  ]);

  const items = new Map(itemRes.rows.map((i) => [i.code, i]));
  const pos = new Map(poRes.rows.map((p) => [p.doc_no, p]));
  const poLines = new Map(lineRes.rows.map((l) => [`${l.po_no}|${l.item_code}`, l]));

  const rows: PackingCheckedRow[] = [];
  let errors = 0;
  let warns = 0;

  for (const r of raw) {
    const notes: string[] = [];
    let status: number = CHECK.ok;
    const bad = (msg: string) => { notes.push(msg); status = CHECK.block; };
    const warn = (msg: string) => { notes.push(msg); if (status !== CHECK.block) status = CHECK.warn; };

    const code = resolveCode(r);
    const item = items.get(code);
    const po = r.po_no ? pos.get(r.po_no) : undefined;

    // ① ຈຳນວນ
    if (r.qty === null || r.qty <= 0) bad("ຈຳນວນບໍ່ຖືກຕ້ອງ");

    // ② ສິນຄ້າ — ຕ້ອງຈັບຄູ່ໄດ້ກັບລະຫັດ SML
    if (!code) bad("ຍັງບໍ່ໄດ້ຈັບຄູ່ກັບລະຫັດສິນຄ້າ SML");
    else if (!item) bad(`ຍັງບໍ່ໄດ້ຈັບຄູ່ລະຫັດຜູ້ສະໜອງ ${code} ກັບສິນຄ້າ SML`);
    else if (code.startsWith("97")) bad("ສິນຄ້າກຸ່ມ 97 ບໍ່ຮັບເຂົ້າສາງ");

    // ③ PO — ຕ້ອງມີ ແລະ ຕ້ອງອະນຸມັດແລ້ວ
    if (!r.po_no) bad("ບໍ່ມີເລກ PO");
    else if (!po) bad(`ບໍ່ພົບໃບສັ່ງຊື້ ${r.po_no}`);
    else if ((po.approve_status ?? 0) !== 1) bad(`ໃບສັ່ງຊື້ ${r.po_no} ຍັງບໍ່ອະນຸມັດ`);

    // ④ ສາງ · ສິນຄ້າຢູ່ໃນ PO · ຈຳນວນທຽບຄ້າງຮັບ (ເຕືອນເທົ່ານັ້ນ)
    let ordered: number | null = null;
    let remaining: number | null = null;
    if (po && item) {
      const whList = (po.wh_codes ?? "").split(",").map((w) => w.trim()).filter(Boolean);
      if (whList.length > 0 && !whList.includes(whCode)) {
        warn(`PO ນີ້ເປັນຂອງສາງ ${whList.join("/")} ບໍ່ແມ່ນ ${whCode}`);
      }
      const line = poLines.get(`${r.po_no}|${code}`);
      if (!line) {
        warn(`ສິນຄ້າ ${code} ບໍ່ຢູ່ໃນ PO ${r.po_no}`);
      } else {
        ordered = Number.parseFloat(line.ordered) || 0;
        remaining = Number.parseFloat(line.remaining) || 0;
        if (remaining <= 0) warn(`PO ${r.po_no} ຮັບຄົບແລ້ວສຳລັບສິນຄ້ານີ້`);
        else if ((r.qty ?? 0) > remaining + 1e-6) {
          warn(`ຈຳນວນ ${r.qty} ເກີນຄ້າງຮັບ ${remaining}`);
        }
      }
    }

    if (status === CHECK.block) errors++;
    else if (status === CHECK.warn) warns++;

    rows.push({
      ...r,
      item_code: item ? item.code : null,
      // ລະຫັດ · ຊື່ · ຫົວໜ່ວຍ ຖືເອົາ SML (ic_inventory) ເປັນຫຼັກ —
      // ຄ່າໃນໄຟລ໌ຜູ້ສະໜອງໃຊ້ພຽງເພື່ອ match ແລະ ເກັບໄວ້ໃນ raw_item_code.
      item_name: item?.name_1 || r.item_name || "",
      unit_code: item?.unit_code || r.unit_code || "",
      supplier_code: po?.cust_code ?? null,
      ordered,
      remaining,
      is_isn: (item?.is_isn ?? 0) === 1,
      check_status: status,
      check_note: notes.join(" · "),
    });
  }

  const supMap = new Map<string, { code: string | null; name: string | null }>();
  for (const p of poRes.rows) {
    if (p.cust_code && !supMap.has(p.cust_code)) supMap.set(p.cust_code, { code: p.cust_code, name: p.cust_name });
  }

  return { rows, errors, warns, suppliers: Array.from(supMap.values()), pos: poNos };
}

/** ສ້າງເລກໃບ packing: PK<YYMMDD>-<seq5> */
export async function genPackingDocNo(client: PoolClient): Promise<string> {
  const r = await client.query<{ doc_no: string }>(
    `SELECT 'PK' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
            lpad(nextval('public.wms_packing_list_doc_seq')::text, 5, '0') AS doc_no`,
  );
  return r.rows[0].doc_no;
}

/** ຮັບໄດ້ທັງ pool ແລະ client ໃນ transaction. */
export type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/**
 * ໃບສັ່ງຊື້ທີ່ຍັງບໍ່ອະນຸມັດ (ຫຼື ບໍ່ມີໃນລະບົບ) ໃນບັນດາ PO ທີ່ສົ່ງມາ —
 * ໃຊ້ເປັນດ່ານກັນຢູ່ຂັ້ນໃບກວດນັບ. ຄືນ array ວ່າງ = ອະນຸມັດຄົບທຸກໃບ.
 */
export async function unapprovedPos(db: Queryable, poNos: string[]): Promise<string[]> {
  if (poNos.length === 0) return [];
  const r = await db.query(
    `SELECT po.po_no AS doc_no
       FROM unnest($1::text[]) AS po(po_no)
       LEFT JOIN public.ic_trans t ON t.doc_no = po.po_no AND t.trans_flag = 6
      WHERE t.doc_no IS NULL OR COALESCE(t.approve_status, 0) <> 1`,
    [poNos],
  );
  return r.rows.map((x) => String(x.doc_no));
}

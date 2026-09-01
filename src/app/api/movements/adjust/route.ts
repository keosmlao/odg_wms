import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { getIsnInfo, getMaxIsnSeq, isnYearCode } from "@/lib/receive";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";
import { lockBins } from "@/lib/binLock";

/** trans_flag for WMS-internal stock adjustments in odg_wms_trans_detail. */
const ADJUST_TRANS_FLAG = 99;

const REASONS = new Set(["count", "damaged", "lost", "found", "other"]);

/**
 * What one line does. The client says it explicitly; omitting it keeps the old
 * behaviour (serial payload present → count by serial, else count by qty).
 *
 *   qty         ປັບສະເພາະຈຳນວນ WMS ຢູ່ບ່ອນນີ້ ຕາມຈຳນວນໃໝ່ທີ່ປ້ອນ — ບໍ່ແຕະ SN ເລີຍ
 *               (ໃຊ້ໄດ້ກັບສິນຄ້າ serial ຄືກັນ: ແກ້ຈຳນວນທີ່ຜິດ ໂດຍບໍ່ຍ້າຍ SN).
 *   sn_count    ນັບຕາມ SN ຢູ່ບ່ອນນີ້ — ເອົາອອກ / ເພີ່ມ / generate; ຈຳນວນມາຈາກ SN.
 *   sn_move     ຍ້າຍ SN ຈາກ ຈຸດທີ 1 → ຈຸດທີ 2 ໂດຍບໍ່ແຕະຈຳນວນ WMS. ຈຸດທີ 2 ຕ້ອງມີ
 *               ຈຳນວນ WMS ຮອງຮັບ SN ທີ່ຈະຍ້າຍເຂົ້າຢູ່ກ່ອນແລ້ວ (ລັອກໄວ້).
 *   qty_sn_move ຍ້າຍທັງ SN ແລະ ຈຳນວນ: ຈຸດທີ 1 ຫຼຸດ n, ຈຸດທີ 2 ເພີ່ມ n (n = ຈຳນວນ SN
 *               ທີ່ລະບຸ) — ຈຸດທີ 2 ບໍ່ຕ້ອງມີຈຳນວນຢູ່ກ່ອນ.
 */
const LINE_MODES = new Set(["qty", "sn_count", "sn_move", "qty_sn_move"]);
type LineMode = "qty" | "sn_count" | "sn_move" | "qty_sn_move";

/** doc_ref stamped on the sn_trans_detail legs of a location move (see DELETE). */
const SN_MOVE_REF = "sn-move";

type AdjustLineInput = {
  item_code?: unknown;
  item_name?: unknown;
  unit_code?: unknown;
  counted_qty?: unknown;
  mode?: unknown; // LineMode — omitted = legacy inference
  // Location is per-line (product-first flow): each line adjusts its own node.
  // Falls back to the document-level shelf/shelf1/pallet when omitted.
  rack?: unknown;
  location?: unknown;
  pallet?: unknown;
  // Serialized items adjust by serial, not by free qty:
  serials_remove?: unknown; // ISN/SN to take out (missing/damaged)
  serials_add?: unknown; // existing ISN/SN found to add
  serials_generate?: unknown; // number of brand-new ISN to generate & add
  // Move modes — ຈຸດທີ 2 (destination) + the serials that travel there.
  to_rack?: unknown;
  to_location?: unknown;
  to_pallet?: unknown;
  serials_move?: unknown;
};

type AdjustBody = {
  wh_code?: unknown;
  shelf_code?: unknown;
  shelf_code1?: unknown;
  pallet?: unknown;
  reason?: unknown;
  note?: unknown;
  lines?: unknown;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

/** Human-readable storage node, for error messages. */
function nodeLabel(n: { shelf: string; shelf1: string; pallet: string }): string {
  const parts = [n.shelf, n.shelf1].filter(Boolean);
  if (n.pallet) parts.push(`pallet:${n.pallet}`);
  return parts.length ? parts.join(" / ") : "ສາງລວມ";
}

/**
 * Post a stock adjustment.
 *
 * A line does one of three things (`mode`, see LINE_MODES): adjust the WMS qty
 * at a node, move serials from ຈຸດທີ 1 to ຈຸດທີ 2 without touching qty, or move
 * serials AND their qty together. A move writes a net-zero ±n pair inside the
 * same warehouse — the same shape trans_flag 77 uses — which the daily-movement
 * report already recognises as an internal relocation and excludes.
 *
 * For each counting line the server recomputes the current balance at the
 * (wh, rack, location, pallet) node, derives delta = counted - before, and —
 * when delta != 0 — writes:
 *   1. a balancing movement into `odg_wms_trans_detail` (calc_flag ±1,
 *      trans_flag 99) so the balance the app shows updates immediately, and
 *   2. a detail line into the existing `wms_product_adj_stock_detail`.
 * A single `wms_product_adj_stock` header ties all lines together (one doc_no).
 *
 * Location mapping into the legacy adj-stock tables (which only have
 * shelf_code + box_code, no warehouse): shelf_code <- our location code
 * (which embeds the rack prefix), box_code <- pallet. Warehouse is preserved on
 * the trans_detail rows and echoed into the header remark.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  let body: AdjustBody;
  try {
    body = (await request.json()) as AdjustBody;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  // Document-level location — kept only as a fallback for lines that omit their
  // own node (product-first flow sends the node per line).
  const docShelf = str(body.shelf_code); // rack
  const docShelf1 = str(body.shelf_code1); // location
  const docPallet = str(body.pallet);
  const reason = str(body.reason) || "count";
  const note = str(body.note);

  if (!wh) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  }
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: "ເຫດຜົນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ປັບປຸງ" }, { status: 400 });
  }

  // Per-warehouse policy: when the ADJUST menu has SN off, adjust by qty only —
  // ignore serial add/remove/generate for every line.
  const snOn = await warehouseSnEnabled(wh, "adjust");

  // Normalise + validate lines. Location is per-line now, so the dedupe key is
  // item_code + node — the same item may be adjusted at two different nodes, but
  // not twice at the same one.
  const seen = new Set<string>();
  const lines: {
    item_code: string;
    item_name: string | null;
    unit_code: string;
    mode: LineMode;
    shelf: string; // rack — ຈຸດທີ 1: the node counted, or a move's source
    shelf1: string; // location
    pallet: string;
    counted: number;
    serialsRemove: string[];
    serialsAdd: string[];
    serialsGenerate: number;
    // Move modes only — ຈຸດທີ 2 (destination) + the serials that travel there.
    toShelf: string;
    toShelf1: string;
    toPallet: string;
    serialsMove: string[];
  }[] = [];
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? Array.from(new Set(v.map((x) => str(x)).filter(Boolean))) : [];
  for (const raw of body.lines as AdjustLineInput[]) {
    const item_code = str(raw.item_code);
    if (!item_code) continue;
    // Per-line node, falling back to the document-level values.
    const shelf = raw.rack !== undefined ? str(raw.rack) : docShelf;
    const shelf1 = raw.location !== undefined ? str(raw.location) : docShelf1;
    const pallet = raw.pallet !== undefined ? str(raw.pallet) : docPallet;

    const rawMode = str(raw.mode);
    if (rawMode && !LINE_MODES.has(rawMode)) {
      return NextResponse.json({ error: `ຮູບແບບການປັບປຸງຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` }, { status: 400 });
    }
    let serialsRemove = snOn ? strArr(raw.serials_remove) : [];
    let serialsAdd = snOn ? strArr(raw.serials_add) : [];
    let serialsGenerate = snOn ? Math.max(0, Math.round(num(raw.serials_generate) ?? 0)) : 0;
    let serialsMove = snOn ? strArr(raw.serials_move) : [];
    // No explicit mode (older clients) → infer it from the payload, as before.
    const mode: LineMode =
      (rawMode as LineMode) ||
      (serialsMove.length > 0
        ? "qty_sn_move"
        : serialsRemove.length + serialsAdd.length + serialsGenerate > 0
          ? "sn_count"
          : "qty");
    const isMove = mode === "sn_move" || mode === "qty_sn_move";
    // SN off for this warehouse → there are no serials to move; qty is all there is.
    if (isMove && !snOn) {
      return NextResponse.json(
        { error: `ສາງ ${wh} ປິດການໃຊ້ SN ຢູ່ໜ້າປັບປຸງ — ຍ້າຍ SN ບໍ່ໄດ້` },
        { status: 400 },
      );
    }
    // ໂໝດຈຳນວນລ້ວນບໍ່ແຕະ SN ເລີຍ — ໃຊ້ໄດ້ກັບສິນຄ້າ serial ຄືກັນ.
    if (mode === "qty") {
      serialsRemove = [];
      serialsAdd = [];
      serialsGenerate = 0;
      serialsMove = [];
    }
    if (mode === "sn_count") serialsMove = [];

    const toShelf = isMove ? str(raw.to_rack) : "";
    const toShelf1 = isMove ? str(raw.to_location) : "";
    const toPallet = isMove ? str(raw.to_pallet) : "";
    if (isMove) {
      if (serialsMove.length === 0) {
        return NextResponse.json({ error: `${item_code}: ຍັງບໍ່ໄດ້ເລືອກ SN ທີ່ຈະຍ້າຍ` }, { status: 400 });
      }
      if (!toShelf && !toShelf1 && !toPallet) {
        return NextResponse.json({ error: `${item_code}: ກະລຸນາເລືອກ ຈຸດທີ 2 (ປາຍທາງ)` }, { status: 400 });
      }
      if (toShelf === shelf && toShelf1 === shelf1 && toPallet === pallet) {
        return NextResponse.json(
          { error: `${item_code}: ຈຸດທີ 2 ຄືກັນກັບ ຈຸດທີ 1 — ບໍ່ມີຫຍັງໃຫ້ຍ້າຍ` },
          { status: 400 },
        );
      }
    }
    const key = `${item_code}\u0000${shelf}\u0000${shelf1}\u0000${pallet}`;
    // A move's key carries ຈຸດທີ 2 too, so it never collides with a count of the
    // same item at the source node.
    const dedupeKey = isMove ? `mv\u0000${key}\u0000${toShelf}\u0000${toShelf1}\u0000${toPallet}` : key;
    if (seen.has(dedupeKey)) {
      return NextResponse.json(
        { error: `ສິນຄ້າ ${item_code} ຊ້ຳກັນຢູ່ບ່ອນຈັດເກັບດຽວກັນ` },
        { status: 400 },
      );
    }
    seen.add(dedupeKey);
    const isSerial = serialsRemove.length > 0 || serialsAdd.length > 0 || serialsGenerate > 0;
    // Non-serial lines need a counted qty; serial lines derive it from the serials,
    // and move lines from the serials that travel.
    const counted = isSerial || isMove ? 0 : num(raw.counted_qty);
    if (!isSerial && !isMove && (counted === null || counted < 0)) {
      // SN off + a serial-only line with no counted qty → nothing to adjust; skip.
      if (!snOn) continue;
      return NextResponse.json(
        { error: `ຈຳນວນຂອງ ${item_code} ບໍ່ຖືກຕ້ອງ` },
        { status: 400 },
      );
    }
    lines.push({
      item_code,
      item_name: str(raw.item_name) || null,
      unit_code: str(raw.unit_code),
      mode,
      shelf,
      shelf1,
      pallet,
      counted: counted ?? 0,
      serialsRemove,
      serialsAdd,
      serialsGenerate,
      toShelf,
      toShelf1,
      toPallet,
      serialsMove,
    });
  }

  if (lines.length === 0) {
    return NextResponse.json({ error: "ບໍ່ມີລາຍການໃຫ້ປັບປຸງ" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Generate a doc_no. Reuse the legacy table's roworder sequence as a serial
    // (gaps are harmless); format ADJ<YYMMDD>-<seq5>.
    const codeRes = await client.query<{ doc_no: string }>(
      `SELECT 'ADJ' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
              lpad(nextval('public.wms_product_adj_stock_roworder_seq')::text, 5, '0') AS doc_no`,
    );
    const docNo = codeRes.rows[0].doc_no;

    const posted: {
      item_code: string;
      before_qty: string;
      counted_qty: number;
      delta_qty: string;
    }[] = [];
    let changed = 0;
    let snGenerated = 0;
    let snMoved = 0;
    let snHeaderDone = false;
    const user = session.employee_code;
    const yearCode = isnYearCode(new Date().getFullYear());

    // Serial-ledger header (sn_trans), created lazily on first serial activity.
    async function ensureSnHeader() {
      if (snHeaderDone) return;
      await client.query(
        `INSERT INTO public.sn_trans
           (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, 0, 'ADJ', $4)`,
        [ADJUST_TRANS_FLAG, docNo, user, wh],
      );
      snHeaderDone = true;
    }
    // sn_trans_detail row for one serial (calc_flag +1 add / -1 remove).
    // `docRef` = SN_MOVE_REF marks the two legs of a location move, which the
    // void route restores by putting the serial back instead of flipping status.
    async function snLedger(
      itemCode: string,
      itemName: string | null,
      serial: string,
      isn: string | null,
      cf: 1 | -1,
      node: { shelf: string; shelf1: string; pallet: string },
      opts?: { docRef?: string; whCode?: string },
    ) {
      await client.query(
        `INSERT INTO public.sn_trans_detail
           (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse,
            item_name, doc_ref, calc_flag, rack, location, pallet, isn)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ADJUST_TRANS_FLAG, docNo, user, itemCode, serial, opts?.whCode ?? wh, itemName, opts?.docRef ?? reason, cf, node.shelf || null, node.shelf1 || null, node.pallet || null, isn],
      );
    }

    /** WMS balance of one item at one node, inside this transaction. */
    async function nodeBalance(
      itemCode: string,
      node: { shelf: string; shelf1: string; pallet: string },
      whCode = wh,
    ) {
      const res = await client.query<{ bal: string }>(
        `SELECT COALESCE(SUM(t.qty * t.calc_flag), 0)::numeric::text AS bal
         FROM public.odg_wms_trans_detail t
         WHERE (t.status = 0 OR t.status IS NULL)
           AND t.wh_code = $1
           AND COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') = $2
           AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
           AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $4
           AND t.item_code = $5`,
        [whCode, node.shelf, node.shelf1, node.pallet, itemCode],
      );
      return Number.parseFloat(res.rows[0].bal) || 0;
    }

    /** One balancing stock leg (calc_flag ±1) at a node. */
    async function stockLeg(
      line: { item_code: string; item_name: string | null; unit_code: string },
      node: { shelf: string; shelf1: string; pallet: string },
      qty: number,
      cf: 1 | -1,
      whCode = wh,
    ) {
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name,
            qty, unit_code, shelf_code, shelf_code1, wh_code, user_created,
            status, calc_flag, doc_time, pallet)
         VALUES
           ($1, CURRENT_DATE, $2, $3, $4, $5,
            $6, $7, $8, $9, $10, $11,
            0, $12, to_char(now(), 'HH24:MI'), $13)`,
        [ADJUST_TRANS_FLAG, docNo, reason, line.item_code, line.item_name, Math.abs(qty), line.unit_code || null, node.shelf || null, node.shelf1 || null, whCode, user, cf, node.pallet || null],
      );
    }

    /**
     * Legacy adjustment detail line (audit / history). The legacy table has only
     * shelf_code + box_code, so map location→shelf_code (fall back to rack) and
     * pallet→box_code, per line.
     */
    async function legacyDetail(
      line: { item_code: string; unit_code: string },
      node: { shelf: string; shelf1: string; pallet: string },
      before: number,
      after: number,
      diff: number,
    ) {
      await client.query(
        `INSERT INTO public.wms_product_adj_stock_detail
           (doc_no, item_code, unit_code, box_code, shelf_code,
            qty, current_qty, diff_qty)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [docNo, line.item_code, line.unit_code, node.pallet, node.shelf1 || node.shelf, after, before, diff],
      );
    }

    for (const line of lines) {
      // This line's node (per-line location) — ຈຸດທີ 1 when the line is a move.
      const { shelf, shelf1, pallet } = line;
      const from = { shelf, shelf1, pallet };
      const isMoveLine = line.mode === "sn_move" || line.mode === "qty_sn_move";

      // ຈັບກຸນແຈບ່ອນເກັບກ່ອນອ່ານຍອດ — ສອງຄົນນັບບ່ອນດຽວກັນພ້ອມກັນ ຈະອ່ານ
      // "before" ອັນດຽວກັນ ແລ້ວຂຽນ delta ທັງສອງ = ປັບຊ້ຳສອງເທື່ອ
      // (ເບິ່ງ lib/binLock.ts). ໃນຮອບກວດນັບ ຄົນນັບພ້ອມກັນເປັນເລື່ອງປົກກະຕິ.
      // ແຖວຍ້າຍແຕະສອງບ່ອນ ຈຶງລັອກທັງ ຈຸດທີ 1 ແລະ ຈຸດທີ 2 ພ້ອມກັນ —
      // lockBins ຮຽງ key ໃຫ້ກ່ອນ ຈຶງບໍ່ deadlock ກັນເອງ.
      await lockBins(client, [
        { wh, rack: shelf, location: shelf1, pallet, item_code: line.item_code },
        ...(isMoveLine
          ? [{ wh, rack: line.toShelf, location: line.toShelf1, pallet: line.toPallet, item_code: line.item_code }]
          : []),
      ]);

      // ── ຍ້າຍ SN ຈາກ ຈຸດທີ 1 → ຈຸດທີ 2 ─────────────────────────────────────
      // sn_move     : ຍ້າຍສະເພາະ SN, ຈຳນວນ WMS ບໍ່ຂຶ້ນລົງ → ຈຸດທີ 2 ຕ້ອງມີຈຳນວນ
      //               WMS ຮອງຮັບ SN ທັງໝົດທີ່ຈະໄປຢູ່ນັ້ນ (ລັອກ).
      // qty_sn_move : ຍ້າຍທັງ SN ແລະ ຈຳນວນ (ຈຸດທີ 1 −n, ຈຸດທີ 2 +n) → ຈຸດທີ 2
      //               ບໍ່ຕ້ອງມີຈຳນວນຢູ່ກ່ອນ.
      if (isMoveLine) {
        const to = { shelf: line.toShelf, shelf1: line.toShelf1, pallet: line.toPallet };
        const moveQty = line.mode === "qty_sn_move";
        const codes = line.serialsMove;

        // Every serial must be in stock AT ຈຸດທີ 1 right now. Keyed by roworder —
        // ISN-only rows carry no sn, so sn is not a usable key.
        const snRes = await client.query<{ roworder: number; sn: string | null; isn: string | null }>(
          `SELECT s.roworder, s.sn, s.isn
             FROM public.sn_inventory s
            WHERE s.wh_code = $1 AND s.item_code = $2 AND COALESCE(s.status, 0) = 0
              AND COALESCE(NULLIF(TRIM(s.rack), ''), '')     = $3
              AND COALESCE(NULLIF(TRIM(s.location), ''), '') = $4
              AND COALESCE(NULLIF(TRIM(s.pallet), ''), '')   = $5
              AND (s.isn = ANY($6) OR s.sn = ANY($6))`,
          [wh, line.item_code, shelf, shelf1, pallet, codes],
        );
        const found = new Set<string>();
        for (const r of snRes.rows) {
          if (r.sn) found.add(r.sn);
          if (r.isn) found.add(r.isn);
        }
        const missing = codes.filter((c) => !found.has(c));
        if (missing.length > 0) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: `ບໍ່ພົບ SN ${missing[0]} ຂອງ ${line.item_code} ຢູ່ ຈຸດທີ 1 (${nodeLabel(from)})` },
            { status: 400 },
          );
        }
        if (snRes.rows.length !== codes.length) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: `${line.item_code}: ລະຫັດ SN ຊ້ຳກັນຫຼາຍແຖວ — ກວດ SN ທີ່ເລືອກອີກຄັ້ງ` },
            { status: 400 },
          );
        }

        const n = snRes.rows.length;
        const beforeFrom = await nodeBalance(line.item_code, from);
        const beforeTo = await nodeBalance(line.item_code, to);

        if (moveQty) {
          // ຈຳນວນຂອງຈຸດທີ 1 ຈະຖືກຫຼຸດ — ຫ້າມໃຫ້ຕິດລົບ.
          if (beforeFrom - n < -1e-6) {
            await client.query("ROLLBACK");
            return NextResponse.json(
              {
                error: `${line.item_code}: ຈຸດທີ 1 (${nodeLabel(from)}) ມີຈຳນວນ WMS ${beforeFrom} ແຕ່ຈະຍ້າຍ ${n} — ຈະຕິດລົບ`,
              },
              { status: 400 },
            );
          }
        } else {
          // ບໍ່ແຕະຈຳນວນ → ຈຸດທີ 2 ຕ້ອງມີຈຳນວນ WMS ຮອງຮັບ SN ທີ່ຈະໄປຢູ່ນັ້ນ.
          const cnt = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n
               FROM public.sn_inventory s
              WHERE s.wh_code = $1 AND s.item_code = $2 AND COALESCE(s.status, 0) = 0
                AND COALESCE(NULLIF(TRIM(s.rack), ''), '')     = $3
                AND COALESCE(NULLIF(TRIM(s.location), ''), '') = $4
                AND COALESCE(NULLIF(TRIM(s.pallet), ''), '')   = $5`,
            [wh, line.item_code, to.shelf, to.shelf1, to.pallet],
          );
          const snAtTo = Number.parseInt(cnt.rows[0]?.n ?? "0", 10) || 0;
          if (beforeTo - (snAtTo + n) < -1e-6) {
            await client.query("ROLLBACK");
            return NextResponse.json(
              {
                error: `${line.item_code}: ຈຸດທີ 2 (${nodeLabel(to)}) ມີຈຳນວນ WMS ${beforeTo} ແຕ່ຈະມີ SN ${snAtTo + n} — ຍ້າຍບໍ່ໄດ້ໃນໂໝດ "ຍ້າຍສະເພາະ SN". ໃຫ້ໃຊ້ໂໝດ "ຍ້າຍ SN + ຈຳນວນ" ຫຼື ປັບຈຳນວນຈຸດທີ 2 ກ່ອນ`,
              },
              { status: 400 },
            );
          }
        }

        await ensureSnHeader();
        for (const r of snRes.rows) {
          // Canonical serial id: the real SN when it has one, else the ISN
          // (~32k rows are ISN-only with sn empty, not NULL).
          const id = (r.sn ?? "").trim() || (r.isn ?? "").trim();
          await client.query(
            `UPDATE public.sn_inventory
                SET rack = $1, location = $2, pallet = $3, user_mapping = $4
              WHERE roworder = $5`,
            [to.shelf || null, to.shelf1 || null, to.pallet || null, user, r.roworder],
          );
          // Net-zero pair in the serial ledger: out of ຈຸດທີ 1, into ຈຸດທີ 2.
          await snLedger(line.item_code, line.item_name, id, r.isn, -1, from, { docRef: SN_MOVE_REF });
          await snLedger(line.item_code, line.item_name, id, r.isn, 1, to, { docRef: SN_MOVE_REF });
        }

        if (moveQty) {
          await stockLeg(line, from, n, -1);
          await stockLeg(line, to, n, 1);
        }

        const d = moveQty ? n : 0;
        await legacyDetail(line, from, beforeFrom, beforeFrom - d, -d);
        await legacyDetail(line, to, beforeTo, beforeTo + d, d);

        snMoved += n;
        changed += 1;
        posted.push({
          item_code: line.item_code,
          before_qty: String(beforeFrom),
          counted_qty: beforeFrom - d,
          delta_qty: String(-d),
        });
        continue;
      }

      // Recompute current balance at the node inside the transaction.
      const before = await nodeBalance(line.item_code, from);
      const isSerial = line.serialsRemove.length > 0 || line.serialsAdd.length > 0 || line.serialsGenerate > 0;

      let delta: number;
      // Serials dragged in from another node: they change THIS node's balance but
      // carry their own ±1 pair, so they are kept out of `delta`.
      let relocatedQty = 0;
      let added = 0;
      if (isSerial) {
        await ensureSnHeader();

        // a) Remove ISN that are missing/damaged → flip sn_inventory to issued.
        for (const isn of line.serialsRemove) {
          const r = await client.query(
            `UPDATE public.sn_inventory SET status = 1, user_mapping = $1
             WHERE wh_code = $2 AND item_code = $3 AND (isn = $4 OR sn = $4) AND COALESCE(status, 0) = 0`,
            [user, wh, line.item_code, isn],
          );
          if ((r.rowCount ?? 0) === 0) {
            await client.query("ROLLBACK");
            return NextResponse.json({ error: `ບໍ່ພົບ SN ${isn} ຂອງ ${line.item_code} ໃນສາງ` }, { status: 400 });
          }
          await snLedger(line.item_code, line.item_name, isn, isn, -1, { shelf, shelf1, pallet });
        }

        // b) Add a scanned serial. Three cases, and they are NOT the same for the
        //    stock balance:
        //      · already in stock at this exact node → no-op.
        //      · in stock at ANOTHER node → this is a MOVE, not a find: it needs
        //        −1 where it was and +1 here, or the warehouse total inflates by
        //        one for every serial dragged in (the old bug).
        //      · not in stock (brand new, or previously issued) → a genuine find:
        //        counts toward the line's delta.
        for (const isn of line.serialsAdd) {
          const cur = await client.query<{
            roworder: number; wh_code: string; rack: string; location: string; pallet: string;
          }>(
            `SELECT s.roworder, s.wh_code,
                    COALESCE(NULLIF(TRIM(s.rack), ''), '')     AS rack,
                    COALESCE(NULLIF(TRIM(s.location), ''), '') AS location,
                    COALESCE(NULLIF(TRIM(s.pallet), ''), '')   AS pallet
               FROM public.sn_inventory s
              WHERE s.item_code = $1 AND (s.isn = $2 OR s.sn = $2) AND COALESCE(s.status, 0) = 0
              LIMIT 1`,
            [line.item_code, isn],
          );
          const at = cur.rows[0];
          if (
            at && at.wh_code === wh && at.rack === shelf && at.location === shelf1 && at.pallet === pallet
          ) {
            continue; // already in stock here → nothing changes
          }
          const upd = await client.query(
            `UPDATE public.sn_inventory
               SET status = 0, rack = $1, location = $2, pallet = $3, wh_code = $4,
                   item_name = COALESCE(item_name, $5), user_mapping = $6
             WHERE item_code = $7 AND (isn = $8 OR sn = $8)`,
            [shelf || null, shelf1 || null, pallet || null, wh, line.item_name, user, line.item_code, isn],
          );
          if ((upd.rowCount ?? 0) === 0) {
            await client.query(
              `INSERT INTO public.sn_inventory
                 (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
               VALUES ($1, $1, 1, 0, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [isn, line.item_code, line.item_name, line.unit_code || null, wh, shelf || null, shelf1 || null, pallet || null, user],
            );
          }
          if (at) {
            // Move: a self-contained ±1 pair, so it stays out of the line delta.
            const oldNode = { shelf: at.rack, shelf1: at.location, pallet: at.pallet };
            await snLedger(line.item_code, line.item_name, isn, isn, -1, oldNode, { docRef: SN_MOVE_REF, whCode: at.wh_code });
            await snLedger(line.item_code, line.item_name, isn, isn, 1, from, { docRef: SN_MOVE_REF });
            await stockLeg(line, oldNode, 1, -1, at.wh_code);
            await stockLeg(line, from, 1, 1);
            relocatedQty += 1;
            snMoved += 1;
          } else {
            await snLedger(line.item_code, line.item_name, isn, isn, 1, from);
            added += 1;
          }
        }

        // c) Generate brand-new ISN (item must have an ISN category).
        if (line.serialsGenerate > 0) {
          const inf = (await getIsnInfo(client, [line.item_code])).get(line.item_code);
          if (!inf?.is_isn || !inf.category) {
            await client.query("ROLLBACK");
            return NextResponse.json({ error: `${line.item_code}: generate ISN ບໍ່ໄດ້ (ບໍ່ມີ category/ບໍ່ແມ່ນ serial)` }, { status: 400 });
          }
          const prefix = `${inf.category}${yearCode}`;
          const maxseq = await getMaxIsnSeq(client, prefix);
          await client.query(
            `INSERT INTO public.sn_inventory
               (sn, isn, qty, status, item_code, item_name, unit_code, wh_code, rack, location, pallet, user_mapping)
             SELECT $1 || lpad(($2::bigint + g)::text, 7, '0'), $1 || lpad(($2::bigint + g)::text, 7, '0'),
                    1, 0, $3, $4, $5, $6, $7, $8, $9, $10
             FROM generate_series(1, $11) g`,
            [prefix, maxseq, line.item_code, line.item_name, line.unit_code || null, wh, shelf || null, shelf1 || null, pallet || null, user, line.serialsGenerate],
          );
          await client.query(
            `INSERT INTO public.sn_trans_detail
               (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
             SELECT $1, $2, CURRENT_DATE, $3, $4, $5 || lpad(($6::bigint + g)::text, 7, '0'), 1, $7, $8, $9, 1, $10, $11, $12, $5 || lpad(($6::bigint + g)::text, 7, '0')
             FROM generate_series(1, $13) g`,
            [ADJUST_TRANS_FLAG, docNo, user, line.item_code, prefix, maxseq, wh, line.item_name, reason, shelf || null, shelf1 || null, pallet || null, line.serialsGenerate],
          );
          snGenerated += line.serialsGenerate;
        }

        delta = added + line.serialsGenerate - line.serialsRemove.length;
      } else {
        delta = Math.round((line.counted - before) * 1e6) / 1e6;
        if (delta === 0) {
          posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: line.counted, delta_qty: "0" });
          continue;
        }
      }

      // What this node ends up holding: the counted delta plus any serial that
      // was relocated in (whose own ±1 pair is already written).
      const nodeDelta = Math.round((delta + relocatedQty) * 1e6) / 1e6;
      const counted = before + nodeDelta;

      // Balancing movement — only when the counted qty changed (serial swap = 0).
      if (delta !== 0) {
        await stockLeg(line, from, delta, delta > 0 ? 1 : -1);
      }

      await legacyDetail(line, from, before, counted, nodeDelta);

      changed += 1;
      posted.push({ item_code: line.item_code, before_qty: String(before), counted_qty: counted, delta_qty: String(nodeDelta) });
    }

    if (changed === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "ບໍ່ມີການປ່ຽນແປງ — ຈຳນວນທີ່ໃສ່ກົງກັບຍອດປະຈຸບັນທັງໝົດ" },
        { status: 400 },
      );
    }

    // WMS stock-movement header (odg_wms_trans) — one per adjustment doc. Every
    // other flag (receive 1, issue 72, relocate 77, …) writes one; adjustments
    // did not, leaving 31 docs of flag-99 detail with no header at all.
    await client.query(
      `INSERT INTO public.odg_wms_trans
         (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
      [ADJUST_TRANS_FLAG, docNo, reason, wh, user],
    );

    // Header (one per submit). Legacy table has no wh_code → keep it in remark.
    const remark = `[${wh}] ${note}`.trim();
    await client.query(
      `INSERT INTO public.wms_product_adj_stock
         (doc_no, doc_date, doc_time, doc_type, remark, create_datetime, creator_code, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, now(), $4, 0)`,
      [docNo, reason, remark, session.employee_code],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, adjust_code: docNo, changed, sn_generated: snGenerated, sn_moved: snMoved, lines: posted });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { getIsnInfo } from "@/lib/receive";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";
import { lockBins } from "@/lib/binLock";

/**
 * ຍ້າຍບ່ອນເກັບ (relocate) — ຍ້າຍສິນຄ້າໜຶ່ງລາຍການ ຈາກ node ໜຶ່ງ (rack/location/pallet)
 * ໄປອີກ node ໜຶ່ງ ພາຍໃນສາງດຽວກັນ. ສິນຄ້າ serial (is_isn=1) ຕ້ອງລະບຸ SN ໃຫ້ຄົບ qty —
 * SN ຈະຍ້າຍໄປນຳ node ໃໝ່ອັດຕະໂນມັດ.
 *
 * ບໍ່ແມ່ນ Adjust (ນັບ/ປັບປຸງ stock) — ນີ້ແມ່ນການຍ້າຍລ້ວນໆ, ຍອດທັງສາງບໍ່ປ່ຽນ,
 * ບໍ່ມີ ERP posting (ຄືກັນກັບ pallet-move.ts). ໃຊ້ trans_flag 77 ("ຍ້າຍບ່ອນເກັບ") —
 * ຄ່ານີ້ຖືກ dailyMovement.ts/locationMovement.ts/monthlyMovement.ts ຮູ້ຈັກ ແລະ
 * ຕັດອອກຈາກລາຍງານເຄື່ອນໄຫວແທ້ຢູ່ແລ້ວ (ອອກແບບໄວ້ລ່ວງໜ້າ ແຕ່ບໍ່ມີໜ້າໃດຂຽນມາກ່ອນ).
 *
 * ນະໂຍບາຍ SN ຕໍ່ສາງ: ໃຊ້ flag ດຽວກັນກັບ "ຍ້າຍ pallet" (`sn_pallet`) ເພາະທັງສອງ
 * ເປັນການຍ້າຍບ່ອນເກັບພາຍໃນສາງແບບດຽວກັນ — ຍັງບໍ່ໄດ້ເພີ່ມ flag ແຍກ (ຕ້ອງການ
 * migration ຄໍລຳໃໝ່ ຖ້າຢາກແຍກໃນອະນາຄົດ).
 */
const RELOCATE_FLAG = 77;
const DOC_REF = "relocate";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

type Node = { rack: string; location: string; pallet: string };
function sameNode(a: Node, b: Node): boolean {
  return a.rack === b.rack && a.location === b.location && a.pallet === b.pallet;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const wh = str(body.wh_code);
  const item_code = str(body.item_code);
  const item_name = str(body.item_name) || null;
  const unit_code = str(body.unit_code) || null;
  const from: Node = { rack: str(body.from_rack), location: str(body.from_location), pallet: str(body.from_pallet) };
  const to: Node = { rack: str(body.to_rack), location: str(body.to_location), pallet: str(body.to_pallet) };
  const qty = num(body.qty);
  const serials = Array.isArray(body.serials) ? (body.serials as unknown[]).map(str).filter(Boolean) : [];

  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  if (!item_code) return NextResponse.json({ error: "ກະລຸນາເລືອກສິນຄ້າ" }, { status: 400 });
  if (qty === null || qty <= 0) return NextResponse.json({ error: "ຈຳນວນຕ້ອງຫຼາຍກວ່າ 0" }, { status: 400 });
  if (sameNode(from, to)) {
    return NextResponse.json({ error: "ຈຸດທີ 2 ຄືກັນກັບ ຈຸດທີ 1 — ບໍ່ມີຫຍັງໃຫ້ຍ້າຍ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const user = session.employee_code;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ຈັບກຸນແຈທັງສອງບ່ອນກ່ອນອ່ານຍອດ (ເບິ່ງ lib/binLock.ts — ຮຽງ key ໃຫ້ກ່ອນ ຈຶ່ງບໍ່
    // deadlock ກັນເອງ ເມື່ອສອງຄົນຍ້າຍສວນທາງກັນ).
    await lockBins(client, [
      { wh, rack: from.rack, location: from.location, pallet: from.pallet, item_code },
      { wh, rack: to.rack, location: to.location, pallet: to.pallet, item_code },
    ]);

    const balRes = await client.query<{ bal: string }>(
      `SELECT COALESCE(SUM(qty * calc_flag), 0)::numeric::text AS bal
       FROM public.odg_wms_trans_detail
       WHERE (status = 0 OR status IS NULL) AND wh_code = $1
         AND COALESCE(NULLIF(TRIM(shelf_code), ''), '')  = $2
         AND COALESCE(NULLIF(TRIM(shelf_code1), ''), '') = $3
         AND COALESCE(NULLIF(TRIM(pallet), ''), '')      = $4
         AND item_code = $5`,
      [wh, from.rack, from.location, from.pallet, item_code],
    );
    const before = Number.parseFloat(balRes.rows[0]?.bal ?? "0") || 0;
    if (qty > before + 1e-6) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: `ຈຸດທີ 1 ມີຈຳນວນ ${before} ແຕ່ຈະຍ້າຍ ${qty} — ຈະຕິດລົບ` }, { status: 400 });
    }

    const isnInfo = (await getIsnInfo(client, [item_code])).get(item_code);
    const serialized = isnInfo?.is_isn ?? false;
    const moveSerials = serialized && (await warehouseSnEnabled(wh, "pallet", client));

    if (moveSerials) {
      if (serials.length !== Math.round(qty)) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `ສິນຄ້ານີ້ຕ້ອງເລືອກ SN ໃຫ້ຄົບ ${qty} ໜ່ວຍ (ຕອນນີ້ເລືອກ ${serials.length})` },
          { status: 400 },
        );
      }
      const found = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM public.sn_inventory
         WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($1) AND item_code = $2 AND wh_code = $3
           AND COALESCE(NULLIF(TRIM(rack), ''), '')     = $4
           AND COALESCE(NULLIF(TRIM(location), ''), '') = $5
           AND COALESCE(NULLIF(TRIM(pallet), ''), '')   = $6
           AND COALESCE(status, 0) = 0`,
        [serials, item_code, wh, from.rack, from.location, from.pallet],
      );
      if ((Number.parseInt(found.rows[0]?.n ?? "0", 10) || 0) !== serials.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "ບາງ SN ບໍ່ຢູ່ ຈຸດທີ 1 ຫຼື ຖືກຍ້າຍໄປແລ້ວ" }, { status: 400 });
      }
    }

    const docNo = (
      await client.query<{ doc_no: string }>(
        `SELECT 'MOV' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
                lpad(nextval('public.odg_wms_trans_roworder_seq')::text, 5, '0') AS doc_no`,
      )
    ).rows[0].doc_no;

    await client.query(
      `INSERT INTO public.odg_wms_trans (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
      [RELOCATE_FLAG, docNo, DOC_REF, wh, user],
    );

    // ຍອດ WMS: −1 ຈຸດທີ 1 / +1 ຈຸດທີ 2. ຄູ່ນີ້ ±1 ຢູ່ສາງດຽວກັນ = ຍອດທັງສາງບໍ່ປ່ຽນ
    // (ຄືທີ່ dailyMovement.ts ຄາດໄວ້ສຳລັບ trans_flag 77).
    for (const cf of [-1, 1] as const) {
      const node = cf < 0 ? from : to;
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
            shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, to_char(now(), 'HH24:MI'), $13)`,
        [RELOCATE_FLAG, docNo, DOC_REF, item_code, item_name, qty, unit_code, node.rack || null, node.location || null, wh, user, cf, node.pallet || null],
      );
    }

    // SN: ledger ຄູ່ (∓1) + ຍ້າຍ sn_inventory ໄປ node ໃໝ່ (ຄົງ status=0, ໃນສາງດຽວກັນ).
    if (moveSerials && serials.length > 0) {
      await client.query(
        `INSERT INTO public.sn_trans (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, 'MOV', $5)`,
        [RELOCATE_FLAG, docNo, user, serials.length, wh],
      );
      for (const cf of [-1, 1] as const) {
        const node = cf < 0 ? from : to;
        await client.query(
          `INSERT INTO public.sn_trans_detail
             (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
           SELECT $1, $2, CURRENT_DATE, $3, $4, COALESCE(NULLIF(inv.sn, ''), inv.isn), 1, $5, $6, $7, $8, $9, $10, $11, inv.isn
           FROM public.sn_inventory inv
           WHERE COALESCE(NULLIF(inv.sn, ''), inv.isn) = ANY($12) AND inv.item_code = $4 AND inv.wh_code = $5
             AND COALESCE(NULLIF(TRIM(inv.rack), ''), '')     = $13
             AND COALESCE(NULLIF(TRIM(inv.location), ''), '') = $14
             AND COALESCE(NULLIF(TRIM(inv.pallet), ''), '')   = $15
             AND COALESCE(inv.status, 0) = 0`,
          [
            RELOCATE_FLAG, docNo, user, item_code, wh, item_name, DOC_REF, cf,
            node.rack || null, node.location || null, node.pallet || null,
            serials, from.rack, from.location, from.pallet,
          ],
        );
      }
      await client.query(
        `UPDATE public.sn_inventory
           SET rack = $1, location = $2, pallet = $3, user_mapping = $4, updated_at = now()
         WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($5) AND item_code = $6 AND wh_code = $7
           AND COALESCE(NULLIF(TRIM(rack), ''), '')     = $8
           AND COALESCE(NULLIF(TRIM(location), ''), '') = $9
           AND COALESCE(NULLIF(TRIM(pallet), ''), '')   = $10
           AND COALESCE(status, 0) = 0`,
        [to.rack || null, to.location || null, to.pallet || null, user, serials, item_code, wh, from.rack, from.location, from.pallet],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo, qty, serials: moveSerials ? serials.length : 0 });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { warehouseSnEnabled } from "@/lib/warehouseConfig";

/**
 * Move a whole pallet (license-plate) to another location: all stock and serials
 * on the pallet relocate with it, the move is recorded, and the pallet master
 * (odg_wms_pallet) is updated.
 *
 * GET  ?wh=&pallet=  → pallet's current location + contents (items + serial count).
 * POST { wh_code, pallet, to_rack, to_location }  → execute the move.
 */
const MOVE_FLAG = 72; // ໃບໂອນສິນຄ້າ (transfer)

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const pallet = url.searchParams.get("pallet")?.trim() ?? "";
  if (!wh || !pallet) return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຄົບ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const master = await query<{ code: string; rack: string | null; location: string | null; name: string | null }>(
    `SELECT code, rack, location, name_1 AS name FROM public.odg_wms_pallet WHERE wh_code = $1 AND code = $2`,
    [wh, pallet],
  );

  const items = await query<{ item_code: string; item_name: string | null; unit_code: string | null; rack: string; location: string; qty: string }>(
    `SELECT t.item_code, MAX(t.item_name) AS item_name, MAX(t.unit_code) AS unit_code,
            COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
            COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
            SUM(t.qty * t.calc_flag)::numeric::text AS qty
     FROM public.odg_wms_trans_detail t
     WHERE t.wh_code = $1 AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $2
     GROUP BY t.item_code, rack, location
     HAVING SUM(t.qty * t.calc_flag) <> 0
     ORDER BY t.item_code`,
    [wh, pallet],
  );

  const sn = await query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.sn_inventory WHERE wh_code = $1 AND COALESCE(NULLIF(TRIM(pallet), ''), '') = $2 AND COALESCE(status, 0) = 0`,
    [wh, pallet],
  );

  return NextResponse.json({
    pallet: master[0] ?? { code: pallet, rack: null, location: null, name: null },
    found: master.length > 0,
    items,
    serial_count: Number.parseInt(sn[0]?.n ?? "0", 10) || 0,
  });
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
  const pallet = str(body.pallet);
  const toWh = str(body.to_wh) || wh; // destination warehouse (default = same)
  const toRack = str(body.to_rack); // optional — empty = rack/warehouse level
  const toLoc = str(body.to_location); // optional
  if (!wh || !pallet) return NextResponse.json({ error: "ກະລຸນາເລືອກ pallet" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && (!accessible.includes(wh) || !accessible.includes(toWh))) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງ (ຕົ້ນທາງ/ປາຍທາງ)" }, { status: 403 });
  }
  if (toWh === wh && !toRack && !toLoc) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກປາຍທາງ (ສາງ / rack / location)" }, { status: 400 });
  }

  const user = session.employee_code;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Current stock on the pallet, grouped by item + its (old) location.
    const items = (
      await client.query<{ item_code: string; item_name: string | null; unit_code: string | null; rack: string; location: string; qty: string }>(
        `SELECT t.item_code, MAX(t.item_name) AS item_name, MAX(t.unit_code) AS unit_code,
                COALESCE(NULLIF(TRIM(t.shelf_code), ''), '')  AS rack,
                COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') AS location,
                SUM(t.qty * t.calc_flag)::numeric::text AS qty
         FROM public.odg_wms_trans_detail t
         WHERE t.wh_code = $1 AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $2
         GROUP BY t.item_code, rack, location
         HAVING SUM(t.qty * t.calc_flag) <> 0`,
        [wh, pallet],
      )
    ).rows;

    const serials = (
      await client.query<{ sn: string | null; isn: string | null; item_code: string | null; item_name: string | null; rack: string; location: string }>(
        `SELECT sn, isn, item_code, item_name,
                COALESCE(NULLIF(TRIM(rack), ''), '') AS rack,
                COALESCE(NULLIF(TRIM(location), ''), '') AS location
         FROM public.sn_inventory
         WHERE wh_code = $1 AND COALESCE(NULLIF(TRIM(pallet), ''), '') = $2 AND COALESCE(status, 0) = 0`,
        [wh, pallet],
      )
    ).rows;

    if (items.length === 0 && serials.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Pallet ນີ້ບໍ່ມີສິນຄ້າ/serial ໃຫ້ຍ້າຍ" }, { status: 400 });
    }

    // Per-warehouse policy: when the source warehouse does not track serial
    // locations, a location move relocates the stock only — serials stay put.
    const moveSerials = await warehouseSnEnabled(wh, "pallet", client);
    if (!moveSerials && items.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ສາງນີ້ຕັ້ງໃຫ້ບໍ່ຍ້າຍ serial — pallet ນີ້ບໍ່ມີ stock ໃຫ້ຍ້າຍ" }, { status: 400 });
    }

    const docRes = await client.query<{ doc_no: string }>(
      `SELECT 'PMV' || to_char(CURRENT_DATE, 'YYMMDD') || '-' ||
              lpad(nextval('public.odg_wms_trans_roworder_seq')::text, 5, '0') AS doc_no`,
    );
    const docNo = docRes.rows[0].doc_no;

    // Movement header.
    await client.query(
      `INSERT INTO public.odg_wms_trans
         (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
      [MOVE_FLAG, docNo, pallet, wh, user],
    );

    // Stock: out of the old node, into the new node (same pallet). Net zero.
    for (const it of items) {
      const bal = Number.parseFloat(it.qty) || 0;
      if (bal === 0) continue;
      for (const cf of [-1, 1] as const) {
        const useWh = cf < 0 ? wh : toWh;
        const useRack = cf < 0 ? it.rack : toRack;
        const useLoc = cf < 0 ? it.location : toLoc;
        await client.query(
          `INSERT INTO public.odg_wms_trans_detail
             (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
              shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
           VALUES ($1, CURRENT_DATE, $2, 'pallet-move', $3, $4, $5, $6, $7, $8, $9, $10, 0, $11, to_char(now(), 'HH24:MI'), $12)`,
          [MOVE_FLAG, docNo, it.item_code, it.item_name, Math.abs(bal), it.unit_code || null, useRack || null, useLoc || null, useWh, user, cf, pallet],
        );
      }
    }

    // Serials: ledger pair + relocate (keep pallet). Skipped when the warehouse
    // is configured to move stock without serials.
    if (moveSerials && serials.length > 0) {
      await client.query(
        `INSERT INTO public.sn_trans
           (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, 'PMV', $5)`,
        [MOVE_FLAG, docNo, user, serials.length, wh],
      );
      for (const s of serials) {
        const id = s.sn ?? s.isn;
        for (const cf of [-1, 1] as const) {
          const useWh = cf < 0 ? wh : toWh;
          const useRack = cf < 0 ? s.rack : toRack;
          const useLoc = cf < 0 ? s.location : toLoc;
          await client.query(
            `INSERT INTO public.sn_trans_detail
               (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
             VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, 1, $6, $7, 'pallet-move', $8, $9, $10, $11, $12)`,
            [MOVE_FLAG, docNo, user, s.item_code, id, useWh, s.item_name, cf, useRack || null, useLoc || null, pallet, s.isn],
          );
        }
      }
      await client.query(
        `UPDATE public.sn_inventory SET wh_code = $1, rack = $2, location = $3, user_mapping = $4
         WHERE wh_code = $5 AND COALESCE(NULLIF(TRIM(pallet), ''), '') = $6 AND COALESCE(status, 0) = 0`,
        [toWh, toRack || null, toLoc || null, user, wh, pallet],
      );
    }

    // Pallet master now lives at the new warehouse/location.
    await client.query(
      `UPDATE public.odg_wms_pallet SET wh_code = $1, rack = $2, location = $3 WHERE wh_code = $4 AND code = $5`,
      [toWh, toRack || null, toLoc || null, wh, pallet],
    );

    await client.query("COMMIT");
    const toLabel = `${toWh}${[toRack, toLoc].filter(Boolean).length ? " · " + [toRack, toLoc].filter(Boolean).join(" / ") : " (ສາງ)"}`;
    return NextResponse.json({ ok: true, doc_no: docNo, items: items.length, serials: moveSerials ? serials.length : 0, serials_kept: moveSerials ? 0 : serials.length, to: toLabel });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    const message = err instanceof Error ? err.message : "ບໍ່ສຳເລັດ";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}

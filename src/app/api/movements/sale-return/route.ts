import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { saveMoveNotes } from "@/lib/moveReasons";

/**
 * Sale return (ຮັບคืนจากลูกค้า) — WMS-stock-only. Books the returned goods back
 * into a warehouse location (odg_wms_trans +1) and flips any matching serials
 * back to in-stock. Deliberately does NOT post the ERP credit note (flag 48) nor
 * touch ic_inventory — the financial CN (VAT/AR) is created in SmartBiz. The DP
 * doc records the original invoice (doc_ref) for traceability.
 *
 * POST { wh, cust_code?, ref_invoice?, location?, reason?, lines:[{item_code, item_name, unit_code, qty, location?, serials?}] }
 */
const RETURN_FLAG = 48; // ໃບຮັບคืนขาย (credit note) — used as the WMS ledger marker

function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = (await request.json()) as Record<string, unknown>; } catch { return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 }); }

  const wh = str(body.wh);
  const custCode = str(body.cust_code) || null;
  const refInvoice = str(body.ref_invoice) || null;
  const docLoc = str(body.location) || null;
  const reason = str(body.reason) || null;
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });

  if (!Array.isArray(body.lines) || body.lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການຮັບคืน" }, { status: 400 });
  const lines: { item_code: string; item_name: string | null; unit_code: string | null; qty: number; location: string | null; serials: string[] }[] = [];
  for (const raw of body.lines as Record<string, unknown>[]) {
    const item_code = str(raw.item_code);
    const qty = num(raw.qty);
    if (!item_code || qty === null || qty <= 0) continue;
    const serials = Array.isArray(raw.serials) ? (raw.serials as unknown[]).map(str).filter(Boolean) : [];
    lines.push({ item_code, item_name: str(raw.item_name) || null, unit_code: str(raw.unit_code) || null, qty, location: str(raw.location) || docLoc, serials });
  }
  if (lines.length === 0) return NextResponse.json({ error: "ບໍ່ມີລາຍການຮັບคืน" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const docNo = (
      await client.query<{ doc_no: string }>(
        `SELECT 'DP' || to_char(CURRENT_DATE, 'YYMMDD') || '-' || lpad(nextval('public.odg_wms_trans_roworder_seq')::text, 5, '0') AS doc_no`,
      )
    ).rows[0].doc_no;
    const docRef = refInvoice || (custCode ? `RET ${custCode}` : null);

    await client.query(
      `INSERT INTO public.odg_wms_trans (trans_flag, doc_date, doc_time, doc_no, doc_ref, wh_code, user_created, status)
       VALUES ($1, CURRENT_DATE, to_char(now(), 'HH24:MI'), $2, $3, $4, $5, 0)`,
      [RETURN_FLAG, docNo, docRef, wh, session.employee_code ?? null],
    );

    const totalSerials = lines.reduce((s, l) => s + l.serials.length, 0);
    if (totalSerials > 0) {
      await client.query(
        `INSERT INTO public.sn_trans (trans_flag, doc_no, doc_date, user_created, status, item_count, doc_def, doc_format_code, wh_code)
         VALUES ($1, $2, CURRENT_DATE, $3, 0, $4, $5, 'DP', $6)`,
        [RETURN_FLAG, docNo, session.employee_code ?? null, totalSerials, docRef, wh],
      );
    }

    for (const l of lines) {
      // +1 back into the warehouse location
      await client.query(
        `INSERT INTO public.odg_wms_trans_detail
           (trans_flag, doc_date, doc_no, doc_ref, item_code, item_name, qty, unit_code,
            shelf_code, shelf_code1, wh_code, user_created, status, calc_flag, doc_time, pallet)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, 0, 1, to_char(now(), 'HH24:MI'), NULL)`,
        [RETURN_FLAG, docNo, docRef, l.item_code, l.item_name, l.qty, l.unit_code || null, l.location || null, wh, session.employee_code ?? null],
      );
      if (l.serials.length > 0) {
        await client.query(
          `INSERT INTO public.sn_trans_detail
             (trans_flag, doc_no, doc_date, user_created, item_code, sn, qty, warehouse, item_name, doc_ref, calc_flag, rack, location, pallet, isn)
           SELECT $1, $2, CURRENT_DATE, $3, $4::varchar, inv.sn, 1, $5::varchar, $6, $7, 1, NULL, $8, NULL, inv.isn
           FROM public.sn_inventory inv
           WHERE COALESCE(NULLIF(inv.sn, ''), inv.isn) = ANY($9) AND inv.item_code = $4::varchar`,
          [RETURN_FLAG, docNo, session.employee_code ?? null, l.item_code, wh, l.item_name, docRef, l.location || null, l.serials],
        );
        // Flip returned serials back to in-stock at the return location.
        await client.query(
          `UPDATE public.sn_inventory
             SET status = 0, wh_code = $1, location = $2, rack = NULL, pallet = NULL, user_mapping = $3, updated_at = now()
           WHERE COALESCE(NULLIF(sn, ''), isn) = ANY($4) AND item_code = $5`,
          [wh, l.location || null, session.employee_code ?? null, l.serials, l.item_code],
        );
      }
    }

    if (reason) {
      await saveMoveNotes(client, { docNo, refDoc: docRef, stage: "sale_return", user: session.employee_code ?? null, notes: lines.map((l) => ({ item_code: l.item_code, reason_code: reason })) });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: docNo, lines: lines.length, serials: totalSerials });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

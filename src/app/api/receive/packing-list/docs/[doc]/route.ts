import { NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, type Session } from "@/lib/session-shared";
import { CHECK, PACKING_STATUS, checkPackingRows, type PackingRawRow } from "@/lib/packingList";

/**
 * ໃບ packing ໜຶ່ງໃບ.
 *   GET    → header + ລາຍການ + ໄຟລ໌ແນບ, ພ້ອມ **ກວດສອບຄືນສົດ** ກັບ ERP
 *            (PO ທີ່ຫາກໍອະນຸມັດ ຈະຫາຍຈາກລາຍການບລັອກທັນທີ)
 *   PATCH  {action:'verify'|'reopen'|'cancel'}
 *   DELETE → ລຶບໃບ draft ຖິ້ມ
 */
type Header = {
  doc_no: string; doc_date: string; wh_code: string; wh_name: string | null;
  ref_no: string | null; supplier_code: string | null; supplier_name: string | null;
  status: number; line_count: number; total_qty: string; error_count: number; warn_count: number;
  remark: string | null; count_doc_no: string | null; creator_code: string | null;
  creator_name: string | null; created_at: string | null;
};

async function loadHeader(client: PoolClient, doc: string, session: Session) {
  const r = await client.query<Header>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.wh_code, w.name_1 AS wh_name,
            h.ref_no, h.supplier_code, h.supplier_name, h.status, h.line_count,
            h.total_qty::text AS total_qty, h.error_count, h.warn_count, h.remark, h.count_doc_no,
            h.creator_code, e.fullname_lo AS creator_name,
            to_char(h.create_date_time_now,'YYYY-MM-DD HH24:MI') AS created_at
       FROM public.wms_packing_list h
       LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
      WHERE h.doc_no = $1`,
    [doc],
  );
  const header = r.rows[0];
  if (!header) return { error: NextResponse.json({ error: "ບໍ່ພົບໃບ packing ນີ້" }, { status: 404 }) } as const;
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(header.wh_code)) {
    return { error: NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 }) } as const;
  }
  return { header } as const;
}

/** ອ່ານລາຍການ, ກວດຄືນກັບ ERP, ແລ້ວບັນທຶກຜົນທີ່ປ່ຽນກັບຄືນ. */
async function revalidate(client: PoolClient, header: Header) {
  const stored = await client.query<{
    roworder: string; line_order: number | null; src_row: number | null; po_no: string | null;
    item_code: string | null; raw_item_code: string | null; item_name: string | null;
    unit_code: string | null; qty: string; src_text: string | null;
    check_status: number; check_note: string | null;
  }>(
    `SELECT roworder, line_order, src_row, po_no, item_code, raw_item_code, item_name, unit_code,
            qty::text AS qty, src_text, check_status, check_note
       FROM public.wms_packing_list_detail WHERE doc_no = $1 ORDER BY line_order, roworder`,
    [header.doc_no],
  );

  const raw: PackingRawRow[] = stored.rows.map((l) => ({
    src_row: l.src_row ?? 0,
    po_no: l.po_no ?? "",
    raw_item_code: l.raw_item_code ?? "",
    item_name: l.item_name ?? "",
    unit_code: l.unit_code ?? "",
    qty: Number.parseFloat(l.qty) || 0,
    src_text: l.src_text ?? undefined,
    // ລະຫັດທີ່ຈັບຄູ່ໄວ້ແລ້ວ (ດ້ວຍມື ຫຼື ຈາກ alias) ຕ້ອງຢູ່ຄົງທີ່ຜ່ານການກວດຄືນ
    mapped_item_code: l.item_code,
  }));
  const checked = await checkPackingRows(client, header.wh_code, raw, header.supplier_code);

  // ບັນທຶກສະຖານະທີ່ປ່ຽນ (ເຊັ່ນ PO ຖືກອະນຸມັດພາຍຫຼັງ)
  for (let i = 0; i < checked.rows.length; i++) {
    const before = stored.rows[i];
    const now = checked.rows[i];
    if (before.check_status !== now.check_status || (before.check_note ?? "") !== now.check_note) {
      await client.query(
        `UPDATE public.wms_packing_list_detail
            SET check_status = $2, check_note = $3, item_code = $4
          WHERE roworder = $1`,
        [before.roworder, now.check_status, now.check_note || null, now.item_code],
      );
    }
  }
  if (header.error_count !== checked.errors || header.warn_count !== checked.warns) {
    await client.query(
      `UPDATE public.wms_packing_list SET error_count = $2, warn_count = $3 WHERE doc_no = $1`,
      [header.doc_no, checked.errors, checked.warns],
    );
    header.error_count = checked.errors;
    header.warn_count = checked.warns;
  }

  const lines = checked.rows.map((r, i) => ({
    roworder: stored.rows[i].roworder,
    line_order: stored.rows[i].line_order,
    src_row: r.src_row,
    po_no: r.po_no,
    item_code: r.item_code,
    raw_item_code: r.raw_item_code,
    src_text: stored.rows[i].src_text,
    item_name: r.item_name,
    unit_code: r.unit_code,
    qty: r.qty ?? 0,
    ordered: r.ordered,
    remaining: r.remaining,
    is_isn: r.is_isn,
    check_status: r.check_status,
    check_note: r.check_note,
  }));
  return { lines, errors: checked.errors, warns: checked.warns, suppliers: checked.suppliers };
}

export async function GET(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;

  const client = await pool.connect();
  try {
    const loaded = await loadHeader(client, doc, session);
    if ("error" in loaded) return loaded.error;
    const { header } = loaded;
    const { lines, errors } = await revalidate(client, header);

    const files = await client.query(
      `SELECT roworder AS id, kind, file_name, mime_type, file_size,
              to_char(create_date_time_now,'YYYY-MM-DD HH24:MI') AS uploaded_at
         FROM public.wms_packing_list_file WHERE doc_no = $1 ORDER BY kind, roworder`,
      [doc],
    );

    // ສະຫຼຸບຕໍ່ PO — ໃຊ້ຕອນສ້າງໃບກວດນັບ
    const poMap = new Map<string, { po_no: string; lines: number; qty: number; blocked: number }>();
    for (const l of lines) {
      if (!l.po_no) continue;
      const e = poMap.get(l.po_no) ?? { po_no: l.po_no, lines: 0, qty: 0, blocked: 0 };
      e.lines++;
      e.qty += l.qty;
      if (l.check_status === CHECK.block) e.blocked++;
      poMap.set(l.po_no, e);
    }

    return NextResponse.json({
      header,
      lines,
      files: files.rows,
      pos: Array.from(poMap.values()),
      can_verify: header.status === PACKING_STATUS.draft && errors === 0 && lines.length > 0,
      can_count: header.status === PACKING_STATUS.verified && errors === 0,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ໂຫຼດບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;

  let body: { action?: unknown; remark?: unknown };
  try {
    body = (await request.json()) as { action?: unknown; remark?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const action = String(body.action ?? "").trim();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadHeader(client, doc, session);
    if ("error" in loaded) { await client.query("ROLLBACK"); return loaded.error; }
    const { header } = loaded;

    if (header.status === PACKING_STATUS.used) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: `ໃບນີ້ສ້າງໃບກວດນັບແລ້ວ (${header.count_doc_no ?? "-"})` },
        { status: 409 },
      );
    }

    if (action === "verify") {
      const { errors, lines } = await revalidate(client, header);
      if (lines.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "ໃບນີ້ບໍ່ມີລາຍການ" }, { status: 400 });
      }
      if (errors > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: `ຍັງມີ ${errors} ແຖວທີ່ຕ້ອງແກ້ (ເຊັ່ນ PO ຍັງບໍ່ອະນຸມັດ) — ຢືນຢັນບໍ່ໄດ້` },
          { status: 409 },
        );
      }
      await client.query(
        `UPDATE public.wms_packing_list
            SET status = $2, verify_code = $3, verify_datetime = now()
          WHERE doc_no = $1`,
        [doc, PACKING_STATUS.verified, session.employee_code],
      );
    } else if (action === "reopen") {
      await client.query(
        `UPDATE public.wms_packing_list SET status = $2, verify_code = NULL, verify_datetime = NULL WHERE doc_no = $1`,
        [doc, PACKING_STATUS.draft],
      );
    } else if (action === "cancel") {
      await client.query(`UPDATE public.wms_packing_list SET status = $2 WHERE doc_no = $1`, [doc, PACKING_STATUS.cancelled]);
    } else if (action === "remark") {
      await client.query(`UPDATE public.wms_packing_list SET remark = $2 WHERE doc_no = $1`, [doc, String(body.remark ?? "").trim() || null]);
    } else {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "action ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loaded = await loadHeader(client, doc, session);
    if ("error" in loaded) { await client.query("ROLLBACK"); return loaded.error; }
    if (loaded.header.status === PACKING_STATUS.used) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບທີ່ສ້າງໃບກວດນັບແລ້ວ ລຶບບໍ່ໄດ້" }, { status: 409 });
    }
    await client.query(`DELETE FROM public.wms_packing_list_detail WHERE doc_no = $1`, [doc]);
    await client.query(`DELETE FROM public.wms_packing_list_file WHERE doc_no = $1`, [doc]);
    await client.query(`DELETE FROM public.wms_packing_list WHERE doc_no = $1`, [doc]);
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ລຶບບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { PACKING_STATUS, normAliasText } from "@/lib/packingList";

/**
 * ແກ້ໄຂແຖວໃນໃບ packing — ໃຊ້ຈັບຄູ່ລາຍການຂອງຜູ້ສະໜອງກັບ **ລະຫັດ SML**.
 *
 *   PATCH {roworder, item_code?, qty?, po_no?, remember?}
 *     item_code — ລະຫັດ SML (ຊື່ · ຫົວໜ່ວຍ ຈະດຶງຈາກ ic_inventory ໃຫ້ອັດຕະໂນມັດ)
 *     remember  — ຈື່ການຈັບຄູ່ນີ້ໄວ້ (wms_packing_item_alias) ໃຫ້ຄັ້ງຕໍ່ໄປອັດຕະໂນມັດ
 *
 * ຫຼັງແກ້ ໃຫ້ເອີ້ນ GET ຂອງໃບນັ້ນຄືນ — ມັນຈະກວດສອບໃໝ່ໝົດໃບ ແລະ ອັບເດດຕົວນັບ.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;

  let body: { roworder?: unknown; item_code?: unknown; qty?: unknown; po_no?: unknown; remember?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  const roworder = Number.parseInt(String(body.roworder ?? ""), 10);
  if (!Number.isFinite(roworder)) return NextResponse.json({ error: "ບໍ່ມີແຖວທີ່ຈະແກ້" }, { status: 400 });

  const itemCode = typeof body.item_code === "string" ? body.item_code.trim() : "";
  const poNo = typeof body.po_no === "string" ? body.po_no.trim().toUpperCase() : "";
  const qty = body.qty === undefined || body.qty === null ? null : Number.parseFloat(String(body.qty));
  if (qty !== null && (!Number.isFinite(qty) || qty < 0)) {
    return NextResponse.json({ error: "ຈຳນວນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!itemCode && !poNo && qty === null) {
    return NextResponse.json({ error: "ບໍ່ມີສິ່ງທີ່ຈະແກ້" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query<{ doc_no: string; wh_code: string; status: number; supplier_code: string | null }>(
      `SELECT h.doc_no, h.wh_code, h.status, h.supplier_code
         FROM public.wms_packing_list h
         JOIN public.wms_packing_list_detail d ON d.doc_no = h.doc_no
        WHERE h.doc_no = $1 AND d.roworder = $2`,
      [doc, roworder],
    );
    const header = hdr.rows[0];
    if (!header) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບແຖວນີ້" }, { status: 404 }); }

    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(header.wh_code)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    if (header.status === PACKING_STATUS.used) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບນີ້ສ້າງໃບກວດນັບແລ້ວ — ແກ້ບໍ່ໄດ້" }, { status: 409 });
    }

    // ລະຫັດຕ້ອງມີໃນ SML; ຊື່ · ຫົວໜ່ວຍ ເອົາຂອງ SML ສະເໝີ
    let item: { code: string; name_1: string | null; unit_code: string | null } | undefined;
    if (itemCode) {
      const r = await client.query<{ code: string; name_1: string | null; unit_code: string | null }>(
        `SELECT code, name_1, unit_standard AS unit_code FROM public.ic_inventory WHERE code = $1`,
        [itemCode],
      );
      item = r.rows[0];
      if (!item) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `ບໍ່ພົບລະຫັດ ${itemCode} ໃນ SML` }, { status: 404 });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [roworder];
    if (item) {
      params.push(item.code, item.name_1, item.unit_code);
      sets.push(`item_code = $${params.length - 2}`, `item_name = $${params.length - 1}`, `unit_code = $${params.length}`);
    }
    if (poNo) { params.push(poNo); sets.push(`po_no = $${params.length}`); }
    if (qty !== null) { params.push(qty); sets.push(`qty = $${params.length}`); }
    await client.query(`UPDATE public.wms_packing_list_detail SET ${sets.join(", ")} WHERE roworder = $1`, params);

    // ຈື່ການຈັບຄູ່ (ຂໍ້ຄວາມຜູ້ສະໜອງ → ລະຫັດ SML) ໄວ້ໃຊ້ຄັ້ງຕໍ່ໄປ
    let remembered = false;
    if (item && body.remember === true) {
      const src = await client.query<{ src_text: string | null; raw_item_code: string | null }>(
        `SELECT src_text, raw_item_code FROM public.wms_packing_list_detail WHERE roworder = $1`,
        [roworder],
      );
      // ຈື່ດ້ວຍ **ລະຫັດຜູ້ສະໜອງ** ກ່ອນ (ແນ່ນອນກວ່າຊື່ຫຼາຍ), ບໍ່ມີຈຶ່ງໃຊ້ຊື່
      const text = src.rows[0]?.raw_item_code || src.rows[0]?.src_text || "";
      const norm = normAliasText(text);
      if (norm) {
        await client.query(
          `INSERT INTO public.wms_packing_item_alias
             (supplier_code, source_text_norm, source_text, item_code, creator_code)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (COALESCE(supplier_code, ''), source_text_norm)
           DO UPDATE SET item_code = EXCLUDED.item_code, hits = public.wms_packing_item_alias.hits + 1, last_used = now()`,
          [header.supplier_code, norm, text.slice(0, 400), item.code, session.employee_code],
        );
        remembered = true;
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, item_code: item?.code ?? null, remembered });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

/** ລຶບແຖວອອກຈາກໃບ packing (ເຊັ່ນ ແຖວຂີ້ເຫຍື້ອຈາກໄຟລ໌ຜູ້ສະໜອງ). */
export async function DELETE(request: Request, ctx: { params: Promise<{ doc: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  const { doc } = await ctx.params;
  const roworder = Number.parseInt(new URL(request.url).searchParams.get("roworder") ?? "", 10);
  if (!Number.isFinite(roworder)) return NextResponse.json({ error: "ບໍ່ມີແຖວທີ່ຈະລຶບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const hdr = await client.query<{ wh_code: string; status: number }>(
      `SELECT h.wh_code, h.status FROM public.wms_packing_list h
         JOIN public.wms_packing_list_detail d ON d.doc_no = h.doc_no
        WHERE h.doc_no = $1 AND d.roworder = $2`,
      [doc, roworder],
    );
    const header = hdr.rows[0];
    if (!header) { await client.query("ROLLBACK"); return NextResponse.json({ error: "ບໍ່ພົບແຖວນີ້" }, { status: 404 }); }
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(header.wh_code)) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
    if (header.status === PACKING_STATUS.used) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບນີ້ສ້າງໃບກວດນັບແລ້ວ — ແກ້ບໍ່ໄດ້" }, { status: 409 });
    }
    await client.query(`DELETE FROM public.wms_packing_list_detail WHERE roworder = $1`, [roworder]);
    await client.query(
      `UPDATE public.wms_packing_list h
          SET line_count = COALESCE((SELECT count(*) FROM public.wms_packing_list_detail d WHERE d.doc_no = h.doc_no), 0),
              total_qty  = COALESCE((SELECT SUM(d.qty) FROM public.wms_packing_list_detail d WHERE d.doc_no = h.doc_no), 0)
        WHERE h.doc_no = $1`,
      [doc],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" }, { status: 500 });
  } finally {
    client.release();
  }
}

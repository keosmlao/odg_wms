import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * ຍົກເລີກ / ກູ້ຄືນ ໃບຂໍໂອນ (124).
 *
 * ມາແທນໜ້າ "ອະນຸມັດ ໃບຂໍໂອນ" ທີ່ຖືກລຶບໄປ: ໃບຂໍໂອນບໍ່ຕ້ອງລໍໃຜອະນຸມັດອີກແລ້ວ
 * ແຕ່ຍັງຕ້ອງມີທາງເອົາໃບທີ່ບໍ່ຄວນຈ່າຍອອກຈາກລາຍການ ໂດຍບໍ່ຕ້ອງໄປແກ້ທີ່ ERP.
 *
 * ໃຊ້ຊ່ອງເກົ່າ `ic_trans.status = 2` ຊຶ່ງລະບົບກັນອອກຈາກລາຍການຄ້າງຈ່າຍຢູ່ແລ້ວ
 * (/api/movements/issue/pending) — ບໍ່ໄດ້ເພີ່ມສະຖານະໃໝ່ ຈຶ່ງບໍ່ມີບ່ອນໃດຕ້ອງຮຽນຮູ້
 * ຄວາມໝາຍໃໝ່ ແລະ ERP ຍັງອ່ານຄ່າດຽວກັນ.
 *
 * POST { doc, cancel: boolean }
 *   cancel: true  → status 2 (ຍົກເລີກ)
 *   cancel: false → status 0 (ກູ້ຄືນ — ຮອງຮັບປຸ່ມ "ຍົກເລີກ" ໃນແຈ້ງເຕືອນ)
 *
 * ກັນສອງຢ່າງ:
 *   - ຕ້ອງເປັນສາງຕົ້ນທາງ ຫຼື ປາຍທາງ ຂອງໃບນັ້ນ ແລະ ຢູ່ໃນສິດຂອງຜູ້ໃຊ້
 *   - ຖ້າ **ຈ່າຍອອກໄປແລ້ວ** (ຂອງຢູ່ສາງລະຫວ່າງທາງ) ຍົກເລີກບໍ່ໄດ້ — ຂອງຍ້າຍ
 *     ໄປແລ້ວ ການໝາຍວ່າຍົກເລີກຈະເຮັດໃຫ້ຂອງນັ້ນຫາຍໄປຈາກທຸກລາຍການ. ກໍລະນີນັ້ນ
 *     ຕ້ອງໃຊ້ "ຮັບຄືນ" (/movements/transfer-return) ຊຶ່ງຍ້າຍຂອງກັບຈິງ.
 */
const FLAG = 124;
const ISSUE_STOCK_FLAG = 72;
const TRANSIT_WH = "9903";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const doc = str(body.doc);
  const cancel = body.cancel !== false; // ຄ່າເລີ່ມຕົ້ນຄືການຍົກເລີກ
  if (!doc) return NextResponse.json({ error: "ບໍ່ມີເລກໃບ" }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const hdr = await client.query<{
      wh_from: string | null;
      wh_to: string | null;
      status: number | null;
      is_cancel: number | null;
    }>(
      `SELECT wh_from, wh_to, COALESCE(status, 0) AS status, COALESCE(is_cancel, 0) AS is_cancel
         FROM public.ic_trans WHERE doc_no = $1 AND trans_flag = ${FLAG} LIMIT 1`,
      [doc],
    );
    const h = hdr.rows[0];
    if (!h) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບໃບຂໍໂອນ" }, { status: 404 });
    }

    // ສາງຕົ້ນທາງ ຫຼື ປາຍທາງ ກໍ່ໄດ້ — ປາຍທາງເປັນຄົນອອກໃບ, ຕົ້ນທາງເປັນຄົນຈ່າຍ
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible)) {
      const mine = [h.wh_from, h.wh_to].filter(
        (w): w is string => !!w && accessible.includes(w),
      );
      if (mine.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "ບໍ່ມີສິດ — ໃບນີ້ບໍ່ແມ່ນຂອງສາງທີ່ທ່ານຮັບຜິດຊອບ" },
          { status: 403 },
        );
      }
    }

    if (h.is_cancel) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບນີ້ຖືກຍົກເລີກຢູ່ ERP ແລ້ວ" }, { status: 409 });
    }

    if (cancel) {
      // ຈ່າຍອອກໄປແລ້ວ = ຂອງຢູ່ສາງລະຫວ່າງທາງ → ຍົກເລີກເສີຍໆບໍ່ໄດ້
      const mv = await client.query<{ to_transit: string }>(
        `SELECT COALESCE(SUM(qty), 0)::numeric::text AS to_transit
           FROM public.odg_wms_trans_detail
          WHERE doc_ref = $1 AND trans_flag = ${ISSUE_STOCK_FLAG}
            AND calc_flag = 1 AND wh_code = '${TRANSIT_WH}'`,
        [doc],
      );
      const toTransit = Number.parseFloat(mv.rows[0]?.to_transit ?? "0") || 0;
      if (toTransit > 1e-6) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          {
            error: `ຈ່າຍອອກໄປແລ້ວ ${toTransit} — ຍົກເລີກບໍ່ໄດ້. ໃຫ້ໃຊ້ “ຮັບຄືນ” ເພື່ອເອົາຂອງກັບສາງຕົ້ນທາງກ່ອນ`,
          },
          { status: 409 },
        );
      }
      if (h.status === 2) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "ໃບນີ້ຍົກເລີກແລ້ວ" }, { status: 409 });
      }
    } else if (h.status !== 2) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ໃບນີ້ບໍ່ໄດ້ຖືກຍົກເລີກໄວ້" }, { status: 409 });
    }

    const next = cancel ? 2 : 0;
    await client.query(
      `UPDATE public.ic_trans SET status = $2 WHERE doc_no = $1 AND trans_flag = ${FLAG}`,
      [doc, next],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, doc_no: doc, status: next });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

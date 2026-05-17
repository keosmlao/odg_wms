import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Item lines for a single pending bill scoped to a warehouse.
 *
 * Query: ?wh_code=X &doc_no=Y &trans_flag=N
 *
 * Used by the deposit form's "ເບິ່ງສິນຄ້າ" toggle to load lines on demand
 * rather than bloating the bill-cache or initial bill list payload.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const wh = (url.searchParams.get("wh_code") ?? "").trim();
  const docNo = (url.searchParams.get("doc_no") ?? "").trim();
  const flagStr = (url.searchParams.get("trans_flag") ?? "").trim();
  const flag = Number.parseInt(flagStr, 10);
  if (!wh || !docNo || !Number.isFinite(flag)) {
    return NextResponse.json(
      { error: "ກະລຸນາລະບຸ wh_code, doc_no, trans_flag" },
      { status: 400 },
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const rows = await query<{
    line_number: number | null;
    item_code: string;
    item_name: string | null;
    unit_code: string | null;
    qty: string;
    price: string | null;
    sum_amount: string | null;
  }>(
    `SELECT line_number, item_code, item_name, unit_code,
            qty::text                                          AS qty,
            price::text                                        AS price,
            COALESCE(sum_amount, qty * price)::text            AS sum_amount
     FROM public.ic_trans_detail
     WHERE doc_no = $1
       AND trans_flag = $2
       AND wh_code = $3
       AND (status = 0 OR status IS NULL)
       AND item_code IS NOT NULL
       AND item_code <> ''
     ORDER BY line_number, item_code`,
    [docNo, flag, wh],
  );

  return NextResponse.json({ ok: true, items: rows });
}

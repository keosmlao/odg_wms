import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

export type MovementRow = {
  roworder: number;
  doc_date: string | null;
  doc_time: string | null;
  doc_no: string | null;
  doc_ref: string | null;
  trans_flag: number | null;
  calc_flag: number | null;
  qty: string;
  unit_code: string | null;
  wh_code: string | null;
  shelf_code: string | null;
  shelf_code1: string | null;
  user_created: string | null;
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const itemCode = url.searchParams.get("item_code")?.trim() ?? "";
  if (!itemCode) {
    return NextResponse.json(
      { error: "item_code is required" },
      { status: 400 },
    );
  }

  const warehouse = url.searchParams.get("warehouse")?.trim() ?? "";
  const location = url.searchParams.get("location")?.trim() ?? "";
  const limit = Math.max(
    1,
    Math.min(
      200,
      Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
    ),
  );
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
  );

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json(
      { error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ" },
      { status: 403 },
    );
  }
  if (warehouse && Array.isArray(accessible) && !accessible.includes(warehouse)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າສາງນີ້" },
      { status: 403 },
    );
  }

  // No `status` filter — status=1 marks the outbound (-1) leg of an internal bin
  // relocation (trans_flag 77), not a voided row. Dropping it would hide real
  // movements and make the history fail to reconcile with the balance shown on
  // the balance page (which now counts every leg).
  const where: string[] = [
    "t.item_code = $1",
  ];
  const args: unknown[] = [itemCode];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`t.wh_code = ANY($${args.length})`);
  }
  if (warehouse) {
    args.push(warehouse);
    where.push(`t.wh_code = $${args.length}`);
  }
  if (location) {
    args.push(location);
    where.push(
      `(t.shelf_code = $${args.length} OR t.shelf_code1 = $${args.length})`,
    );
  }

  const whereSql = where.join(" AND ");

  const [countRows, rows] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM public.odg_wms_trans_detail t
       WHERE ${whereSql}`,
      args,
    ),
    (async () => {
      const argsWithPagination = [...args, limit, offset];
      return query<MovementRow>(
        `SELECT
           t.roworder,
           t.doc_date,
           t.doc_time,
           t.doc_no,
           t.doc_ref,
           t.trans_flag,
           t.calc_flag,
           t.qty::text AS qty,
           t.unit_code,
           t.wh_code,
           t.shelf_code,
           t.shelf_code1,
           t.user_created
         FROM public.odg_wms_trans_detail t
         WHERE ${whereSql}
         ORDER BY t.doc_date DESC NULLS LAST,
                  t.doc_time DESC NULLS LAST,
                  t.roworder DESC
         LIMIT $${argsWithPagination.length - 1} OFFSET $${argsWithPagination.length}`,
        argsWithPagination,
      );
    })(),
  ]);

  return NextResponse.json({
    movements: rows,
    total: countRows[0]?.n ?? 0,
  });
}

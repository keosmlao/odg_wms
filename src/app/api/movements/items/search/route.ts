import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

export type MovementItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  /** Balance of this item at the exact (wh, rack, location, pallet) node. */
  balance_qty: string | null;
  /** Total balance of this item across the whole warehouse. */
  wh_balance: string | null;
  /** 1 = serialized item (ISN/SN tracked). */
  is_isn: number | null;
};

/** Escape LIKE wildcards so user input "%" or "_" is treated literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Search the full item master (`ic_inventory`) — so ANY product can be added to
 * an adjustment, even ones that have never moved in this warehouse. For each hit
 * we return both the warehouse-wide balance (`wh_balance`) and the balance at the
 * exact (warehouse, rack, location, pallet) node (`balance_qty`), computed from
 * `odg_wms_trans_detail`.
 *
 * Node params are exact-match including the empty string (same semantics as
 * /api/movements/balance-items). Requires a non-empty `q`.
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
  // Client shares node params with balance-items, which uses `warehouse`.
  const wh =
    url.searchParams.get("warehouse")?.trim() ??
    url.searchParams.get("wh")?.trim() ??
    "";
  const rack = url.searchParams.get("rack")?.trim() ?? "";
  const location = url.searchParams.get("location")?.trim() ?? "";
  const pallet = url.searchParams.get("pallet")?.trim() ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.max(
    1,
    Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
  );
  // Transfer requests search the SOURCE warehouse's stock, which by design is
  // any warehouse (not just the requester's own) — the requester's own scope
  // is enforced separately on the destination side in POST /transfer-request.
  const anySource = url.searchParams.get("scope") === "any";

  if (!wh) {
    return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });
  }
  if (!q) {
    return NextResponse.json({ items: [] });
  }

  if (!anySource) {
    const accessible = accessibleWarehouses(session);
    if (Array.isArray(accessible) && !accessible.includes(wh)) {
      return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
    }
  }

  const like = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  // Two-step: pick matching master items first (indexed on code/name_1), then a
  // single filtered aggregate over trans_detail for just those items — avoids a
  // per-item scan of the (un-indexed-on-item) movements table.
  const rows = await query<MovementItemHit>(
    `WITH hits AS (
       SELECT i.code, i.name_1, i.unit_standard, i.is_isn
       FROM public.ic_inventory i
       WHERE (i.code ILIKE $5 ESCAPE '\\' OR i.name_1 ILIKE $5 ESCAPE '\\')
       ORDER BY CASE WHEN i.code ILIKE $6 ESCAPE '\\' THEN 0 ELSE 1 END, i.code
       LIMIT $7
     ),
     mov AS (
       SELECT
         t.item_code,
         SUM(t.qty * t.calc_flag) AS wh_q,
         SUM(t.qty * t.calc_flag) FILTER (
           WHERE COALESCE(NULLIF(TRIM(t.shelf_code), ''), '') = $2
             AND COALESCE(NULLIF(TRIM(t.shelf_code1), ''), '') = $3
             AND COALESCE(NULLIF(TRIM(t.pallet), ''), '') = $4
         ) AS node_q
       FROM public.odg_wms_trans_detail t
       WHERE (t.status = 0 OR t.status IS NULL)
         AND t.wh_code = $1
         AND t.item_code IN (SELECT code FROM hits)
       GROUP BY t.item_code
     )
     SELECT
       h.code AS item_code,
       h.name_1 AS item_name,
       h.unit_standard AS unit_code,
       COALESCE(m.node_q, 0)::text AS balance_qty,
       COALESCE(m.wh_q, 0)::text AS wh_balance,
       h.is_isn
     FROM hits h
     LEFT JOIN mov m ON m.item_code = h.code
     ORDER BY CASE WHEN h.code ILIKE $6 ESCAPE '\\' THEN 0 ELSE 1 END, h.code`,
    [wh, rack, location, pallet, like, prefix, limit],
  );

  return NextResponse.json({ items: rows });
}

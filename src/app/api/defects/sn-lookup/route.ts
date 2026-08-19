import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Serial lookup for the defect register (ຄົ້ນຫາດ້ວຍ SN / ISN).
 *
 * Scanning or typing a serial returns everything needed to fill the entry —
 * item, unit, brand, the warehouse it sits in and its shelf position — so the
 * operator never re-keys what the WMS already knows.
 *
 * Both columns are matched, and both are always returned: of 140,402 rows in
 * `sn_inventory`, 32,635 carry an `isn` and no `sn` at all, so a single-column
 * search silently fails for a fifth of the stock. A scanned label may carry
 * either number, and the operator needs to see its counterpart.
 *
 * Item name / unit / brand come from `ic_inventory` rather than the snapshot
 * columns on `sn_inventory`, matching what POST /api/defects re-reads on submit
 * — otherwise the form could show one thing and the register store another.
 *
 * GET ?q=<serial>&limit=20
 */

type LookupQueryRow = {
  sn: string | null;
  isn: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  item_brand: string | null;
  wh_code: string | null;
  warehouse_name: string | null;
  is_defect_warehouse: boolean;
  rack: string | null;
  location: string | null;
  pallet: string | null;
  in_stock: boolean;
  registered_ref: string | null;
  registered_status: number | null;
};

export type DefectSnHit = LookupQueryRow;

/** Escape LIKE wildcards so a serial containing "_" or "%" matches literally. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * The lookup differs between passes only in how a row is matched, so the column
 * list and joins are shared. `match` is spliced in, never user input.
 */
function lookupSql(match: string, scopeFilter: string, limitIdx: number): string {
  return `SELECT
       s.sn,
       s.isn,
       s.item_code,
       i.name_1                                             AS item_name,
       COALESCE(NULLIF(i.unit_standard, ''), i.unit_cost)   AS unit_code,
       i.item_brand,
       s.wh_code,
       COALESCE(dw.name_1, w.name_1)                        AS warehouse_name,
       (dw.code IS NOT NULL)                                AS is_defect_warehouse,
       NULLIF(TRIM(s.rack), '')                             AS rack,
       NULLIF(TRIM(s.location), '')                         AS location,
       NULLIF(TRIM(s.pallet), '')                           AS pallet,
       (COALESCE(s.status, 0) = 0)                          AS in_stock,
       reg.code_ref                                         AS registered_ref,
       reg.status                                           AS registered_status
     FROM public.sn_inventory s
     LEFT JOIN public.ic_inventory i          ON i.code  = s.item_code
     LEFT JOIN public.ic_warehouse w          ON w.code  = s.wh_code
     LEFT JOIN public.odg_defect_warehouse dw ON dw.code = s.wh_code
     -- Already on the defect register? The register stores whichever serial the
     -- operator entered, so match either column.
     LEFT JOIN LATERAL (
       SELECT d.code_ref, d.status
       FROM public.odg_product_defect d
       WHERE COALESCE(d.sn, '') <> ''
         AND (d.sn = s.sn OR d.sn = s.isn)
       ORDER BY d.roworder DESC
       LIMIT 1
     ) reg ON TRUE
     WHERE ${match}${scopeFilter}
     ORDER BY CASE WHEN COALESCE(s.status, 0) = 0 THEN 0 ELSE 1 END, s.roworder DESC
     LIMIT $${limitIdx}`;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
    50,
  );

  // Serials are long; a shorter fragment would scan the table to return noise.
  if (q.length < 4) return NextResponse.json({ hits: [] });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" }, { status: 403 });
  }

  const scoped = Array.isArray(accessible);

  // Pass 1 — exact. Both columns carry a UNIQUE index, so a scanned barcode
  // resolves by index scan (~0.1ms) instead of the ~300ms two-column ILIKE scan
  // of 140k rows. This is the path every scan takes.
  const exactArgs: unknown[] = [q];
  let exactScope = "";
  if (scoped) {
    exactArgs.push(accessible);
    exactScope = ` AND s.wh_code = ANY($${exactArgs.length})`;
  }
  exactArgs.push(limit);
  const exact = await query<LookupQueryRow>(
    lookupSql("(s.sn = $1 OR s.isn = $1)", exactScope, exactArgs.length),
    exactArgs,
  );
  if (exact.length > 0) return NextResponse.json({ hits: exact, exact: true });

  // Pass 2 — the operator is typing a fragment rather than scanning a label.
  const like = `%${escapeLike(q)}%`;
  const partArgs: unknown[] = [like];
  let partScope = "";
  if (scoped) {
    partArgs.push(accessible);
    partScope = ` AND s.wh_code = ANY($${partArgs.length})`;
  }
  partArgs.push(limit);
  const partial = await query<LookupQueryRow>(
    lookupSql("(s.sn ILIKE $1 ESCAPE '\\' OR s.isn ILIKE $1 ESCAPE '\\')", partScope, partArgs.length),
    partArgs,
  );
  if (partial.length > 0) return NextResponse.json({ hits: partial, exact: false });

  // Nothing in scope: say whether the serial exists elsewhere rather than a bare
  // "not found", which sends the operator hunting for a mis-scan that isn't one.
  if (scoped) {
    const elsewhere = await query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM public.sn_inventory s
       WHERE s.sn = $1 OR s.isn = $1 OR s.sn ILIKE $2 ESCAPE '\\' OR s.isn ILIKE $2 ESCAPE '\\'`,
      [q, like],
    );
    if ((elsewhere[0]?.n ?? 0) > 0) {
      return NextResponse.json({ hits: [], out_of_scope: true });
    }
  }

  return NextResponse.json({ hits: [] });
}

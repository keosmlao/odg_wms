import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { EXTRA_DEFECT_SHELVES } from "@/lib/defects";
import type { DefectShelfOption, DefectWarehouseOption } from "@/lib/defects-shared";

/**
 * Filter options for the defective-goods pages: the warehouses that hold a
 * defect shelf, the defect shelves themselves, and the brands that actually
 * appear in the register.
 *
 * GET /api/defects/options
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ warehouses: [], shelves: [], brands: [] });
  }
  // `null` = manager with no explicit scope → every defect warehouse.
  const scope = accessible;

  const [warehouses, shelves, brands] = await Promise.all([
    query<DefectWarehouseOption>(
      `SELECT dw.code, dw.name_1 AS name
       FROM public.odg_defect_warehouse dw
       WHERE ($1::text[] IS NULL OR dw.code = ANY($1))
       ORDER BY dw.code`,
      [scope],
    ),
    // Defect shelves live in the SML shelf master. Every warehouse's defect
    // shelf code ends in '2'; a few legacy Donnoktiew shelves are explicit.
    query<DefectShelfOption>(
      `SELECT DISTINCT
         s.code,
         s.name_1 AS name,
         s.whcode AS wh_code,
         w.name_1 AS wh_name
       FROM public.ic_shelf s
       JOIN public.odg_defect_warehouse w ON w.code = s.whcode
       WHERE (s.code LIKE '%2' OR s.code = ANY($2))
         AND ($1::text[] IS NULL OR s.whcode = ANY($1))
       ORDER BY s.whcode, s.code`,
      [scope, EXTRA_DEFECT_SHELVES],
    ),
    query<{ item_brand: string }>(
      `SELECT DISTINCT item_brand
       FROM public.odg_product_defect
       WHERE COALESCE(item_brand, '') <> ''
       ORDER BY item_brand`,
    ),
  ]);

  return NextResponse.json({
    warehouses,
    shelves,
    brands: brands.map((b) => b.item_brand),
  });
}

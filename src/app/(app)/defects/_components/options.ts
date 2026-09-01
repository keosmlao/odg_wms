import "server-only";
import { query } from "@/lib/db";
import { EXTRA_DEFECT_SHELVES } from "@/lib/defects";
import type {
  DefectShelfOption,
  DefectWarehouseOption,
} from "@/lib/defects-shared";
import type { Session } from "@/lib/session-shared";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Filter options for the defective-goods pages, scoped to the session's
 * warehouses. Loaded on the server so the first paint already has them (the
 * same data is also exposed at /api/defects/options for clients).
 */
export async function loadDefectOptions(session: Session): Promise<{
  warehouses: DefectWarehouseOption[];
  shelves: DefectShelfOption[];
  brands: string[];
}> {
  const scope = accessibleWarehouses(session);
  if (Array.isArray(scope) && scope.length === 0) {
    return { warehouses: [], shelves: [], brands: [] };
  }

  const [warehouses, shelves, brands] = await Promise.all([
    query<DefectWarehouseOption>(
      `SELECT dw.code, dw.name_1 AS name
       FROM public.odg_defect_warehouse dw
       WHERE ($1::text[] IS NULL OR dw.code = ANY($1))
       ORDER BY dw.code`,
      [scope],
    ),
    query<DefectShelfOption>(
      `SELECT DISTINCT s.code, s.name_1 AS name, s.whcode AS wh_code, w.name_1 AS wh_name
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

  return { warehouses, shelves, brands: brands.map((b) => b.item_brand) };
}

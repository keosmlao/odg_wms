import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Dropdown options for the stock-card item filter: the DISTINCT group_main /
 * item_brand / item_category values that actually occur on `ic_inventory`, each
 * resolved to its master-table name (ic_group / ic_brand / ic_category).
 *
 * Only values in use are returned — the brand master alone holds 731 codes while
 * barely 577 are ever used, and offering a filter that can only ever match zero
 * items is worse than not offering it.
 *
 * Returns: { groups:[{code,name}], brands:[...], categories:[...] }
 */
type Option = { code: string; name: string | null };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const [groups, brands, categories] = await Promise.all([
    query<Option>(
      `SELECT DISTINCT i.group_main AS code, g.name_1 AS name
       FROM public.ic_inventory i
       LEFT JOIN public.ic_group g ON g.code = i.group_main
       WHERE COALESCE(NULLIF(TRIM(i.group_main), ''), '') <> ''
       ORDER BY code`,
    ),
    query<Option>(
      `SELECT DISTINCT i.item_brand AS code, b.name_1 AS name
       FROM public.ic_inventory i
       LEFT JOIN public.ic_brand b ON b.code = i.item_brand
       WHERE COALESCE(NULLIF(TRIM(i.item_brand), ''), '') <> ''
       ORDER BY code`,
    ),
    query<Option>(
      `SELECT DISTINCT i.item_category AS code, c.name_1 AS name
       FROM public.ic_inventory i
       LEFT JOIN public.ic_category c ON c.code = i.item_category
       WHERE COALESCE(NULLIF(TRIM(i.item_category), ''), '') <> ''
       ORDER BY code`,
    ),
  ]);

  return NextResponse.json({ groups, brands, categories });
}

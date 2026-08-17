import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Item picker for "ເພີ່ມຂໍ້ມູນເຂົ້າ stock card": search `ic_inventory` narrowed by
 * any combination of group_main / item_brand / item_category, plus a free-text
 * code/name match.
 *
 * Reads the ITEM MASTER, not stock — the stock card is a hand-kept ledger, so an
 * item with no balance anywhere is still a legitimate thing to post an opening
 * movement for. `on_card` tells the UI which ones the warehouse's card already
 * knows about (opening row or a previous entry) so it can flag duplicates.
 *
 * Query: ?wh=&q=&group=&brand=&category=&limit=
 */
export type StockCardItemHit = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  group_main: string | null;
  item_brand: string | null;
  item_category: string | null;
  on_card: boolean;
};

/** ILIKE metacharacters are literal here — an item code with `_` in it must not
 *  turn into a wildcard. */
function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const group = url.searchParams.get("group")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() ?? "";
  const limit = Math.max(1, Math.min(300, Number.parseInt(url.searchParams.get("limit") ?? "100", 10) || 100));

  // At least one narrowing filter — an unfiltered scan of 24k items is never
  // what the operator meant and just floods the picker.
  if (!q && !group && !brand && !category) {
    return NextResponse.json({ items: [], needs_filter: true });
  }

  const where: string[] = [`COALESCE(i.item_status, 0) = 0`];
  const args: unknown[] = [];
  if (group) { args.push(group); where.push(`i.group_main = $${args.length}`); }
  if (brand) { args.push(brand); where.push(`i.item_brand = $${args.length}`); }
  if (category) { args.push(category); where.push(`i.item_category = $${args.length}`); }
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    where.push(`(i.code ILIKE $${args.length} ESCAPE '\\' OR i.name_1 ILIKE $${args.length} ESCAPE '\\')`);
  }
  args.push(wh || null); // may be empty — then nothing is ever flagged on_card
  const whArg = args.length;
  args.push(limit);

  const items = await query<StockCardItemHit>(
    `SELECT i.code AS item_code, i.name_1 AS item_name, i.unit_standard AS unit_code,
            i.group_main, i.item_brand, i.item_category,
            (EXISTS (SELECT 1 FROM public.odg_wms_stock_card_opening o
                      WHERE o.wh_code = $${whArg} AND o.item_code = i.code)
             OR EXISTS (SELECT 1 FROM public.odg_wms_stock_card_entry e
                      WHERE e.wh_code = $${whArg} AND e.item_code = i.code)) AS on_card
     FROM public.ic_inventory i
     WHERE ${where.join(" AND ")}
     ORDER BY i.code
     LIMIT $${args.length}`,
    args,
  );

  return NextResponse.json({ items });
}

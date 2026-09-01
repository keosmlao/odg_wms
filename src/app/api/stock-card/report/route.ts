import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * The stock card itself: per item in one warehouse —
 *
 *   ຄົງເຫຼືອ (remaining) = ຍອດຕັ້ງຕົ້ນ + ຂາເຂົ້າ − ຂາອອກ
 *
 * plus where that stock physically sits:
 *   located   = SUM(qty · calc_flag) over OPENING rows and ENTRIES that name a rack
 *   unlocated = remaining − located
 *
 * `unlocated` is not a separate stored number — it is whatever the warehouse
 * total has left over once the binned rows are accounted for. Since migration
 * 040 the opening balance syncs per bin too, so on a clean warehouse this is 0;
 * anything non-zero means some row carries no shelf code and is worth chasing.
 *
 * A FULL OUTER JOIN is what keeps both halves visible: an item can have an
 * opening balance and no movements, or movements and no opening balance (posted
 * for something the SML sync never returned), and dropping either would silently
 * under-report the card.
 *
 * Query: ?wh=&group=&brand=&category=&q=&hide_zero=1
 */
export type StockCardRow = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  opening: string;
  in_qty: string;
  out_qty: string;
  remaining: string;
  located: string;
  unlocated: string;
  entry_count: number;
};

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const group = url.searchParams.get("group")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  const category = url.searchParams.get("category")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";
  const hideZero = url.searchParams.get("hide_zero") === "1";

  const args: unknown[] = [wh];
  const where: string[] = [];
  if (group) { args.push(group); where.push(`i.group_main = $${args.length}`); }
  if (brand) { args.push(brand); where.push(`i.item_brand = $${args.length}`); }
  if (category) { args.push(category); where.push(`i.item_category = $${args.length}`); }
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    where.push(`(j.item_code ILIKE $${args.length} ESCAPE '\\' OR COALESCE(j.item_name, i.name_1) ILIKE $${args.length} ESCAPE '\\')`);
  }
  if (hideZero) where.push(`(j.opening + j.in_qty - j.out_qty) <> 0`);

  const rows = await query<StockCardRow>(
    `WITH op AS (
       -- one opening row per (item, rack, location) since 040 — fold to the item
       SELECT item_code,
              MAX(item_name) AS item_name,
              MAX(unit_code) AS unit_code,
              SUM(qty) AS qty,
              COALESCE(SUM(qty) FILTER (WHERE rack_code IS NOT NULL), 0) AS located
       FROM public.odg_wms_stock_card_opening WHERE wh_code = $1
       GROUP BY item_code
     ),
     mv AS (
       SELECT item_code,
              MAX(item_name) AS item_name,
              MAX(unit_code) AS unit_code,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag = 1), 0)  AS in_qty,
              COALESCE(SUM(qty) FILTER (WHERE calc_flag = -1), 0) AS out_qty,
              -- only entries that actually name a bin count as "located"
              COALESCE(SUM(qty * calc_flag) FILTER (WHERE rack_code IS NOT NULL), 0) AS located,
              count(*)::int AS entry_count
       FROM public.odg_wms_stock_card_entry WHERE wh_code = $1
       GROUP BY item_code
     ),
     j AS (
       SELECT COALESCE(op.item_code, mv.item_code) AS item_code,
              COALESCE(op.item_name, mv.item_name) AS item_name,
              COALESCE(op.unit_code, mv.unit_code) AS unit_code,
              COALESCE(op.qty, 0)       AS opening,
              COALESCE(mv.in_qty, 0)    AS in_qty,
              COALESCE(mv.out_qty, 0)   AS out_qty,
              COALESCE(op.located, 0) + COALESCE(mv.located, 0) AS located,
              COALESCE(mv.entry_count, 0) AS entry_count
       FROM op FULL OUTER JOIN mv ON mv.item_code = op.item_code
     )
     SELECT j.item_code,
            COALESCE(j.item_name, i.name_1) AS item_name,
            COALESCE(j.unit_code, i.unit_standard) AS unit_code,
            j.opening::text, j.in_qty::text, j.out_qty::text,
            (j.opening + j.in_qty - j.out_qty)::text AS remaining,
            j.located::text,
            (j.opening + j.in_qty - j.out_qty - j.located)::text AS unlocated,
            j.entry_count
     FROM j
     LEFT JOIN public.ic_inventory i ON i.code = j.item_code
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY j.item_code`,
    args,
  );

  const sum = (k: keyof StockCardRow) =>
    rows.reduce((s, r) => s + (Number.parseFloat(String(r[k])) || 0), 0);

  return NextResponse.json({
    rows,
    totals: {
      items: rows.length,
      opening: sum("opening"),
      in_qty: sum("in_qty"),
      out_qty: sum("out_qty"),
      remaining: sum("remaining"),
      located: sum("located"),
      unlocated: sum("unlocated"),
    },
  });
}

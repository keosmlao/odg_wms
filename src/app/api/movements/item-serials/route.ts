import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * In-stock serials (sn_inventory.status = 0) for one item at a node, used by the
 * goods-issue serial picker. Returns [] for non-serialized items (so the client
 * can fall back to a plain quantity input).
 *
 * Query: ?warehouse=&item=&rack=&location=&pallet=&limit=
 * Returns: { serials:[{ sn, isn, rack, location, pallet }] }
 *
 * Node filters (rack/location/pallet) are applied only when non-empty: serials
 * carry their own location in sn_inventory, which may be recorded more loosely
 * than the movement node, so an empty filter means "anywhere in this warehouse".
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("warehouse")?.trim() ?? "";
  const item = url.searchParams.get("item")?.trim() ?? "";
  const rack = url.searchParams.get("rack")?.trim() ?? "";
  const location = url.searchParams.get("location")?.trim() ?? "";
  const pallet = url.searchParams.get("pallet")?.trim() ?? "";
  const limit = Math.min(
    Math.max(Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1),
    1000,
  );

  if (!wh || !item) return NextResponse.json({ serials: [] });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const args: unknown[] = [wh, item];
  const filters = [
    "i.wh_code = $1",
    "i.item_code = $2",
    "COALESCE(i.status, 0) = 0",
  ];
  if (rack) {
    args.push(rack);
    filters.push(`COALESCE(NULLIF(TRIM(i.rack), ''), '') = $${args.length}`);
  }
  if (location) {
    args.push(location);
    filters.push(`COALESCE(NULLIF(TRIM(i.location), ''), '') = $${args.length}`);
  }
  if (pallet) {
    args.push(pallet);
    filters.push(`COALESCE(NULLIF(TRIM(i.pallet), ''), '') = $${args.length}`);
  }
  args.push(limit);

  const serials = await query<{
    sn: string;
    isn: string | null;
    rack: string | null;
    location: string | null;
    pallet: string | null;
    received: string | null;
    days: number | null;
  }>(
    // sn = canonical id (real SN, else ISN) since ~32k rows are ISN-only (sn empty).
    // executeIssue matches on COALESCE(NULLIF(sn,''),isn), so this is the value to
    // select/store. isn kept for display. received/days = aging in the warehouse.
    // FIFO = ascending ISN number (lowest ISN = received first = issue first).
    `SELECT COALESCE(NULLIF(TRIM(i.sn), ''), i.isn) AS sn, i.isn, i.rack, i.location, i.pallet,
            to_char(i.create_date_time_now, 'YYYY-MM-DD') AS received,
            (CURRENT_DATE - i.create_date_time_now::date)::int AS days
     FROM public.sn_inventory i
     WHERE ${filters.join(" AND ")}
     ORDER BY COALESCE(NULLIF(TRIM(i.isn), ''), i.sn) ASC
     LIMIT $${args.length}`,
    args,
  );

  return NextResponse.json({ serials });
}

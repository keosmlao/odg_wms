import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * The rack → location tree of one warehouse, for the stock-card entry form.
 *
 * NOTE this is the WMS's own bin master (odg_wms_location / odg_wms_location1),
 * NOT `ic_shelf` — which is what /api/movements/shelves serves and which is a
 * different thing entirely (ic_shelf holds ERP storage CONDITIONS, ສະພາບ, like
 * good/damaged). A stock card is about physical bins.
 *
 * `locations[].rack_code` is odg_wms_location1.location_id, so the client can
 * filter the location list down to whichever rack is selected.
 *
 * Query: ?wh=<code>
 */
export type RackOption = { code: string; name: string | null };
export type LocationOption = { code: string; name: string | null; rack_code: string | null };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const wh = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const [racks, locations] = await Promise.all([
    query<RackOption>(
      `SELECT code, name_1 AS name FROM public.odg_wms_location
       WHERE wh_code = $1 AND COALESCE(is_active, 1) = 1 ORDER BY code`,
      [wh],
    ),
    query<LocationOption>(
      `SELECT code, name_1 AS name, location_id AS rack_code FROM public.odg_wms_location1
       WHERE wh_code = $1 AND COALESCE(is_active, 1) = 1 ORDER BY code`,
      [wh],
    ),
  ]);

  return NextResponse.json({ racks, locations });
}

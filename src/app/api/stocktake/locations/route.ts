import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

type RackRow = {
  code: string;
  name: string | null;
};

type LocationRow = {
  code: string;
  name: string | null;
  rack_code: string;
};

type PalletRow = {
  code: string;
  name: string | null;
  location: string | null;
  rack: string | null;
};

/**
 * Returns racks + locations for the given warehouse. Used by the counter UI
 * to let the user select where the counted item was found.
 */
export async function GET(request: Request) {
  const userSession = await getSession();
  if (!userSession) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!userSession.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });
  }

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) {
    return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json(
      { error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" },
      { status: 403 },
    );
  }

  const [racks, locations, pallets] = await Promise.all([
    query<RackRow>(
      `SELECT code, name_1 AS name
       FROM public.odg_wms_location
       WHERE wh_code = $1
       ORDER BY code`,
      [wh],
    ),
    query<LocationRow>(
      `SELECT code, name_1 AS name, location_id AS rack_code
       FROM public.odg_wms_location1
       WHERE wh_code = $1
       ORDER BY code`,
      [wh],
    ),
    query<PalletRow>(
      `SELECT code, name_1 AS name, location, rack
       FROM public.odg_wms_pallet
       WHERE wh_code = $1
       ORDER BY code`,
      [wh],
    ),
  ]);

  return NextResponse.json({ racks, locations, pallets });
}

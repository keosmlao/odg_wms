import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Shelves (ທີ່ເກັບ / ສະພາບສິນຄ້າ) of a warehouse, from the ERP master `ic_shelf`.
 * Each shelf's name (name_1) describes the condition/purpose — e.g. "ສະພາບດີ",
 * "ສ້ອມບໍ່ໄດ້", "ທີ່ເກັບຜິດປົກກະຕິ". Used by the transfer-request line editor to
 * set shelf_code (from) / shelf_code_2 (to) per line.
 *
 *   GET ?wh=<code>  → [{ code, name, is_defect, is_damage }]
 */
export type ShelfOption = { code: string; name: string | null; is_defect: boolean; is_damage: boolean };

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const wh = (new URL(request.url).searchParams.get("wh") ?? "").trim();
  if (!wh) return NextResponse.json({ shelves: [] });

  // Access is checked loosely: any WMS user may read shelf masters of a
  // warehouse they can see; transfers already validate wh access on write.
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) return NextResponse.json({ shelves: [] });

  const shelves = await query<ShelfOption>(
    `SELECT code, name_1 AS name,
            COALESCE(is_defect,0) = 1 AS is_defect,
            COALESCE(is_damage,0) = 1 AS is_damage
     FROM public.ic_shelf
     WHERE whcode = $1 AND COALESCE(is_active,1) = 1 AND COALESCE(is_lock,0) = 0
     ORDER BY code`,
    [wh],
  );
  return NextResponse.json({ shelves });
}

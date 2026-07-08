import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";

/**
 * Lazy structure loader for the warehouse settings page: the racks and
 * locations of ONE warehouse, fetched only when that warehouse is expanded.
 * Keeps the initial page render light (no eager load of all ~3.5k locations).
 *
 * GET ?wh=<code>  → { racks: [...], locations: [...] }
 */
export type RackRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  is_active: number | null;
};

export type LocationRow = {
  roworder: number;
  code: string | null;
  name_1: string | null;
  location_id: string | null;
  width: string | null;
  length: string | null;
  height: string | null;
  floor: number | null;
  is_active: number | null;
};

async function resolveLocationTable() {
  const rows = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'odg_location1'
     ) AS exists`,
  );
  return rows[0]?.exists ? "odg_location1" : "odg_wms_location1";
}

export async function GET(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const wh = new URL(request.url).searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາລະບຸສາງ" }, { status: 400 });

  const locationTable = await resolveLocationTable();

  const [racks, locations] = await Promise.all([
    query<RackRow>(
      `SELECT roworder, code, name_1, is_active
       FROM public.odg_wms_location
       WHERE wh_code = $1
       ORDER BY code, roworder`,
      [wh],
    ),
    query<LocationRow>(
      `SELECT roworder, code, name_1, location_id,
              width::text, length::text, height::text, floor, is_active
       FROM public.${locationTable}
       WHERE wh_code = $1
       ORDER BY location_id, code, roworder`,
      [wh],
    ),
  ]);

  return NextResponse.json({ racks, locations });
}

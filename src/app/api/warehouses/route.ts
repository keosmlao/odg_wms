import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

/**
 * Warehouses the current session may access. Mobile (and any client) uses this
 * to populate warehouse pickers without the manager-only admin endpoint.
 * Scope mirrors `accessibleWarehouses` (manager → all unless a list is assigned).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  }
  if (!session.role) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ warehouses: [] });
  }

  const warehouses =
    accessible === null
      ? await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 AND code IS NOT NULL
           ORDER BY code`,
        )
      : await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE code = ANY($1)
           ORDER BY code`,
          [accessible],
        );

  return NextResponse.json({ warehouses });
}

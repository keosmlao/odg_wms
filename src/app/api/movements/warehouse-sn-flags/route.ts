import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { warehouseSnFlags } from "@/lib/warehouseConfig";

/**
 * Read-only per-menu SN flags for one warehouse (session-gated, not
 * manager-only like /api/admin/warehouses) — so ordinary movement screens can
 * adjust their own UI (e.g. whether a goods-issue pick requires SN) without
 * needing admin rights. Query: ?wh=<code>
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  if (!wh) return NextResponse.json({ error: "wh ຈຳເປັນ" }, { status: 400 });

  const flags = await warehouseSnFlags(wh);
  return NextResponse.json({ flags });
}

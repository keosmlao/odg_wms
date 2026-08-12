import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { accuracyFor } from "@/lib/accuracy";

/**
 * Inventory-accuracy check for one warehouse — see `src/lib/accuracy.ts` for the
 * comparison itself (ERP/SML vs WMS vs SN, plus the ຝາກສາງ / ປັບປຸງເພີ່ມເຂົ້າ
 * context columns).
 *
 * Query: ?wh=<code>&q=&limit=&refresh=1
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "500", 10) || 500, 1), 2000);
  const refresh = url.searchParams.get("refresh") === "1";
  if (!wh) return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const entry = await accuracyFor(wh, refresh);

  const rows = (q
    ? entry.mismatched.filter((m) => m.item_code.toLowerCase().includes(q) || (m.item_name ?? "").toLowerCase().includes(q))
    : entry.mismatched
  ).slice(0, limit);

  return NextResponse.json({ kpi: entry.kpi, rows, computed_at: entry.ts });
}

import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { loadDefectEntries } from "@/lib/defects";
import { DEFECT_STATUS } from "@/lib/defects-shared";

/**
 * Individual defect entries of one item — the data behind the detail page's
 * table, refetched by the client after every edit.
 *
 * GET /api/defects/lines?code=<ic_code>&wh=&status=0|1
 * Omitting `wh` returns the item's entries across every accessible warehouse.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const status = url.searchParams.get("status") === "1" ? DEFECT_STATUS.dispatched : DEFECT_STATUS.pending;
  if (!code) return NextResponse.json({ error: "ຕ້ອງລະບຸລະຫັດສິນຄ້າ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return NextResponse.json({ error: "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" }, { status: 403 });
  }
  if (wh && Array.isArray(accessible) && !accessible.includes(wh)) {
    return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" }, { status: 403 });
  }

  const rows = await loadDefectEntries({ code, wh, status, scope: accessible });
  return NextResponse.json({ rows });
}

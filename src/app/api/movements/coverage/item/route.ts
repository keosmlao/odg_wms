import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { DEFAULT_THRESHOLDS, type Thresholds } from "@/lib/coverage";
import { loadItemAcrossWarehouses } from "@/lib/coverageItem";

/**
 * "ສາງອື່ນມີບໍ" — ສິນຄ້າລາຍການດຽວ ຂ້າມທຸກສາງທີ່ຜູ້ໃຊ້ມີສິດ.
 *
 * GET ?item=110102-0209&days=90&critical=7&low=14&over=60
 *   → { item_code, item_name, unit_code, days, thresholds, rows }
 *
 * ຕ່າງຈາກ `/api/movements/coverage` ທີ່ຮັບເທື່ອລະສາງ (ໜັກ) — ອັນນີ້ກອງລະຫັດສິນຄ້າ
 * ໃນຟັງຊັນຄິດຄົງເຫຼືອເລີຍ ຈຶ່ງຖາມທຸກສາງພ້ອມກັນໄດ້ໃນຄຳຮ້ອງດຽວ.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const item = url.searchParams.get("item")?.trim() ?? "";
  if (!item) return NextResponse.json({ error: "ກະລຸນາລະບຸລະຫັດສິນຄ້າ" }, { status: 400 });

  const accessible = accessibleWarehouses(session);
  const whCodes = Array.isArray(accessible)
    ? accessible
    : (await query<{ code: string }>(
        `SELECT code FROM public.ic_warehouse WHERE COALESCE(status, 1) = 1 ORDER BY code`,
      )).map((w) => w.code);

  const days = clamp(url.searchParams.get("days"), 90, 7, 365);
  const thresholds: Thresholds = {
    critical: clamp(url.searchParams.get("critical"), DEFAULT_THRESHOLDS.critical, 1, 365),
    low: clamp(url.searchParams.get("low"), DEFAULT_THRESHOLDS.low, 1, 365),
    over: clamp(url.searchParams.get("over"), DEFAULT_THRESHOLDS.over, 1, 3650),
  };
  if (thresholds.low < thresholds.critical) thresholds.low = thresholds.critical;
  if (thresholds.over < thresholds.low) thresholds.over = thresholds.low;

  try {
    return NextResponse.json(await loadItemAcrossWarehouses(item, whCodes, days, thresholds));
  } catch (err) {
    console.error("[coverage/item]", err);
    return NextResponse.json({ error: "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

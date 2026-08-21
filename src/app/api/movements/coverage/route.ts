import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  DEFAULT_THRESHOLDS,
  loadCoverage,
  loadCoverageGroup,
  type Thresholds,
} from "@/lib/coverage";

/**
 * ວິເຄາະຄວາມພຽງພໍຂອງສິນຄ້າຕໍ່ການຂາຍ — **ໜຶ່ງສາງຕໍ່ໜຶ່ງຄຳຮ້ອງ**.
 *
 * GET ?wh=1301&days=90&critical=7&low=14&over=60
 *   → { days, thresholds, warehouse, items }
 *
 * ຮັບສາງດຽວເພາະການຄິດຄົງເຫຼືອ ERP ກິນ CPU ຂອງ DB ຫຼາຍ (ເບິ່ງ `loadCoverage`) —
 * ໜ້າຈໍຈຶ່ງເອີ້ນເທື່ອລະສາງ ແລ້ວສະແດງຜົນທັນທີທີ່ແຕ່ລະສາງແລ້ວ ແທນທີ່ຈະລໍທັງໝົດ.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  // `wh` ຮັບໄດ້ຫຼາຍລະຫັດ (ຂັ້ນດ້ວຍ ,) — ຫຼາຍລະຫັດ = ວິເຄາະລວມເປັນກຸ່ມດຽວ
  const whCodes = (url.searchParams.get("wh") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (whCodes.length === 0) {
    return NextResponse.json({ error: "ກະລຸນາເລືອກສາງ" }, { status: 400 });
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible)) {
    const denied = whCodes.filter((c) => !accessible.includes(c));
    if (denied.length > 0) {
      return NextResponse.json(
        { error: `ບໍ່ມີສິດເຂົ້າເຖິງສາງ ${denied.join(", ")}` },
        { status: 403 },
      );
    }
  }

  const days = clamp(url.searchParams.get("days"), 90, 7, 365);
  const thresholds: Thresholds = {
    critical: clamp(url.searchParams.get("critical"), DEFAULT_THRESHOLDS.critical, 1, 365),
    low: clamp(url.searchParams.get("low"), DEFAULT_THRESHOLDS.low, 1, 365),
    over: clamp(url.searchParams.get("over"), DEFAULT_THRESHOLDS.over, 1, 3650),
  };
  // ຂີດຕ້ອງຮຽງກັນ ບໍ່ດັ່ງນັ້ນການຈັດສະຖານະຈະຂັດກັນເອງ
  if (thresholds.low < thresholds.critical) thresholds.low = thresholds.critical;
  if (thresholds.over < thresholds.low) thresholds.over = thresholds.low;

  try {
    // refresh=1 ຂ້າມ cache — ໃຊ້ເມື່ອຫາກໍ່ຮັບເຂົ້າ/ຈ່າຍອອກ ແລ້ວຢາກເຫັນຍອດສົດ
    const refresh = url.searchParams.get("refresh") === "1";
    const result =
      whCodes.length > 1
        ? await loadCoverageGroup(whCodes, days, thresholds, refresh)
        : await loadCoverage(whCodes[0], days, thresholds, refresh);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[coverage]", err);
    return NextResponse.json({ error: "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

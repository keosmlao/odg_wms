import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { loadRebalance } from "@/lib/rebalance";

/**
 * ຂໍ້ສະເໜີການໂອນສິນຄ້າລະຫວ່າງສາງ.
 *
 * GET ?from=1201,1202,1203&to=1301,1302&days=90&target=21&keep=30
 *   → { filter, pairs, suggestions, unmet_lines, unmet_value, failed }
 *
 * ໂຫຼດ coverage ຕາມລຳດັບຢູ່ຂ້າງໃນ (ມີ cache) — ຄັ້ງທຳອິດຂອງແຕ່ລະສາງຊ້າ
 * ຫຼັງຈາກນັ້ນໄວ. ເບິ່ງ `coverage.ts` ສຳລັບເຫດຜົນ.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const accessible = accessibleWarehouses(session);

  const list = (key: string) =>
    (url.searchParams.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const allowed = (codes: string[]) =>
    accessible === null ? codes : codes.filter((c) => accessible.includes(c));

  const from = allowed(list("from"));
  const to = allowed(list("to"));

  if (from.length === 0 || to.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກສາງຕົ້ນທາງ ແລະ ປາຍທາງ (ທີ່ທ່ານມີສິດ)" },
      { status: 400 },
    );
  }

  const days = clamp(url.searchParams.get("days"), 90, 7, 365);
  const target_days = clamp(url.searchParams.get("target"), 21, 1, 365);
  const keep_days = clamp(url.searchParams.get("keep"), 30, 0, 365);
  // group=1 → ຄິດຄວາມຕ້ອງການຂອງປາຍທາງລວມກັນ + ແນະນຳການຍ້າຍພາຍໃນກຸ່ມ
  const group = url.searchParams.get("group") === "1";
  // ຕົວກອງຄຸນນະພາບຄວາມຕ້ອງການ — ເປີດໄວ້ ນອກຈາກຈະສັ່ງປິດ (=0)
  const skip_stopped = url.searchParams.get("stopped") !== "0";
  const skip_single = url.searchParams.get("single") !== "0";

  try {
    const result = await loadRebalance({
      from, to, days, target_days, keep_days, group, skip_stopped, skip_single,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[rebalance]", err);
    return NextResponse.json({ error: "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

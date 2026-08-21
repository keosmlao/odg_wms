import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { loadAssortmentGap } from "@/lib/assortment";

/**
 * ຊ່ອງຫວ່າງລາຍການສິນຄ້າ — ຂາຍໄດ້ຢູ່ຕົ້ນທາງ ແຕ່ປາຍທາງບໍ່ຂາຍເລີຍ.
 *
 * GET ?from=1201,1203&to=1301,1302&days=90&trial=30&keep=30&steady=1
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "ກະລຸນາເຂົ້າສູ່ລະບົບ" }, { status: 401 });
  if (!session.role) return NextResponse.json({ error: "ບໍ່ມີສິດເຂົ້າເຖິງ WMS" }, { status: 403 });

  const url = new URL(request.url);
  const accessible = accessibleWarehouses(session);
  const list = (k: string) =>
    (url.searchParams.get(k) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowed = (codes: string[]) =>
    accessible === null ? codes : codes.filter((c) => accessible.includes(c));

  const from = allowed(list("from"));
  const to = allowed(list("to"));
  if (from.length === 0 || to.length === 0) {
    return NextResponse.json(
      { error: "ກະລຸນາເລືອກສາງທີ່ຂາຍໄດ້ ແລະ ສາງທີ່ຢາກເປີດລາຍການ" },
      { status: 400 },
    );
  }

  const days = clamp(url.searchParams.get("days"), 90, 7, 365);
  const trial_days = clamp(url.searchParams.get("trial"), 30, 1, 365);
  const keep_days = clamp(url.searchParams.get("keep"), 30, 0, 365);
  const steady_only = url.searchParams.get("steady") === "1";

  try {
    const result = await loadAssortmentGap({ from, to, days, trial_days, keep_days, steady_only });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[assortment]", err);
    return NextResponse.json({ error: "ດຶງຂໍ້ມູນບໍ່ສຳເລັດ" }, { status: 500 });
  }
}

function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

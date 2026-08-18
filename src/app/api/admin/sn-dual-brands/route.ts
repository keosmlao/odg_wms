import { NextResponse } from "next/server";
import { requireManager } from "@/lib/session";
import { getSnDualBrands, setSnDualBrands } from "@/lib/snDualBrand";

/** GET — the brands that require both sn+isn before issue. */
export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;
  const brands = await getSnDualBrands();
  return NextResponse.json({ brands });
}

/** PUT — replace the whole list. Body: { brands: string[] }. */
export async function PUT(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: { brands?: unknown };
  try {
    body = (await request.json()) as { brands?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!Array.isArray(body.brands)) {
    return NextResponse.json({ error: "ຕ້ອງລະບຸ brands[]" }, { status: 400 });
  }
  const brands = (body.brands as unknown[]).map((b) => String(b));
  const saved = await setSnDualBrands(brands, guard.session.employee_code ?? null);
  return NextResponse.json({ ok: true, brands: saved });
}

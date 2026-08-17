import { NextResponse } from "next/server";
import { requireManager } from "@/lib/session";
import {
  listMinStockWarehouses,
  listMinStockRules,
  searchMinStockItems,
  setMinStockWarehouse,
  upsertMinStockRules,
  deleteMinStockRule,
  type MinStockInput,
} from "@/lib/minStock";

/**
 * ຈັດການ stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ (ຜູ້ຈັດການເທົ່ານັ້ນ).
 *   GET    ?wh=<code>            → ກົດທັງໝົດຂອງສາງ + ລາຍຊື່ສາງ
 *          ?wh=<code>&q=<ຄຳຄົ້ນ>  → ຄົ້ນສິນຄ້າເພື່ອເພີ່ມກົດ
 *   PATCH  { wh_code, enabled }  → ເປີດ/ປິດ ການຄຸມຂອງສາງ
 *   PUT    { wh_code, rules:[{ item_code, min_qty, max_qty, note? }] } → ບັນທຶກເປັນຊຸດ
 *   DELETE ?wh=<code>&item=<code> → ລົບກົດ 1 ລາຍການ
 */

/** ຕົວເລກທີ່ຮັບ: number ຫຼື string. "" / null → null (ບໍ່ຄຸມ). */
function optionalNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (wh && q) return NextResponse.json({ ok: true, items: await searchMinStockItems(wh, q) });

  const [warehouses, rules] = await Promise.all([
    listMinStockWarehouses(),
    wh ? listMinStockRules(wh) : Promise.resolve([]),
  ]);
  return NextResponse.json({ ok: true, warehouses, rules });
}

export async function PATCH(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: { wh_code?: unknown; enabled?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const whCode = String(body.wh_code ?? "").trim();
  if (!whCode) return NextResponse.json({ error: "ຕ້ອງລະບຸ wh_code" }, { status: 400 });

  await setMinStockWarehouse(whCode, body.enabled === true, guard.session.employee_code ?? null);
  return NextResponse.json({ ok: true, warehouses: await listMinStockWarehouses() });
}

export async function PUT(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: { wh_code?: unknown; rules?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const whCode = String(body.wh_code ?? "").trim();
  if (!whCode) return NextResponse.json({ error: "ຕ້ອງລະບຸ wh_code" }, { status: 400 });
  if (!Array.isArray(body.rules)) return NextResponse.json({ error: "ຕ້ອງລະບຸ rules[]" }, { status: 400 });

  const rules: MinStockInput[] = [];
  for (const raw of body.rules as Record<string, unknown>[]) {
    const item = String(raw.item_code ?? "").trim();
    if (!item) continue;
    const min = optionalNumber(raw.min_qty);
    if (min === null) {
      return NextResponse.json({ error: `${item}: ຕ້ອງໃສ່ຂັ້ນຕ່ຳ` }, { status: 400 });
    }
    rules.push({
      item_code: item,
      min_qty: min,
      max_qty: optionalNumber(raw.max_qty),
      note: raw.note === undefined || raw.note === null ? null : String(raw.note),
    });
  }

  try {
    const saved = await upsertMinStockRules(whCode, rules, guard.session.employee_code ?? null);
    return NextResponse.json({ ok: true, saved, rules: await listMinStockRules(whCode) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "ບັນທຶກບໍ່ສຳເລັດ" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const wh = url.searchParams.get("wh")?.trim() ?? "";
  const item = url.searchParams.get("item")?.trim() ?? "";
  if (!wh || !item) return NextResponse.json({ error: "ຕ້ອງລະບຸ ?wh= ແລະ ?item=" }, { status: 400 });

  await deleteMinStockRule(wh, item);
  return NextResponse.json({ ok: true, rules: await listMinStockRules(wh) });
}

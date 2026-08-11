import { NextResponse } from "next/server";
import { requireManager } from "@/lib/session";
import {
  listIsnCategories,
  listIsnItemOverrides,
  listIsnItemsMissingCategory,
  setIsnCategories,
  upsertIsnItemOverride,
  deleteIsnItemOverride,
  setItemCategory,
  searchIsnItems,
} from "@/lib/isnScope";

/**
 * ຈັດການ "ສິນຄ້າທີ່ຕ້ອງເກັບ ISN" — ໝວດ + ຍົກເວັ້ນລາຍການ (ຜູ້ຈັດການເທົ່ານັ້ນ).
 *   GET    → ໝວດທັງໝົດ + ຍົກເວັ້ນ + ລາຍການທີ່ໝວດຫວ່າງ
 *   PUT    → ຕັ້ງຄ່າໝວດເປັນຊຸດ  { categories: [{ category_code, require_isn }] }
 *   POST   → ຍົກເວັ້ນ 1 ລາຍການ  { item_code, require_isn, note? }
 *            ຫຼື ຕັ້ງໝວດໃຫ້ສິນຄ້າ { item_code, category_code }
 *   DELETE → ?item=<code> ລົບຍົກເວັ້ນ (ກັບໄປໃຊ້ຄ່າຂອງໝວດ)
 */
export async function GET(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  // ?q= — ຄົ້ນສິນຄ້າເພື່ອເພີ່ມເປັນຍົກເວັ້ນ (ພ້ອມຄ່າທີ່ມັນໄດ້ຢູ່ຕອນນີ້)
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q) return NextResponse.json({ items: await searchIsnItems(q) });

  const [categories, overrides, missingCategory] = await Promise.all([
    listIsnCategories(),
    listIsnItemOverrides(),
    listIsnItemsMissingCategory(),
  ]);
  return NextResponse.json({ categories, overrides, missingCategory });
}

export async function PUT(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: { categories?: unknown };
  try {
    body = (await request.json()) as { categories?: unknown };
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!Array.isArray(body.categories)) {
    return NextResponse.json({ error: "ຕ້ອງລະບຸ categories[]" }, { status: 400 });
  }

  const changes = (body.categories as { category_code?: unknown; require_isn?: unknown }[])
    .map((c) => ({ category_code: String(c.category_code ?? "").trim(), require_isn: c.require_isn === true }))
    .filter((c) => c.category_code.length > 0 && c.category_code.length <= 20);

  await setIsnCategories(changes, guard.session.employee_code ?? null);
  return NextResponse.json({ ok: true, categories: await listIsnCategories() });
}

export async function POST(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  let body: { item_code?: unknown; require_isn?: unknown; note?: unknown; category_code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const itemCode = String(body.item_code ?? "").trim();
  if (!itemCode) return NextResponse.json({ error: "ຕ້ອງລະບຸ item_code" }, { status: 400 });

  // ຕັ້ງໝວດໃຫ້ສິນຄ້າ (ຂຽນລົງ ic_inventory.item_category — ໝວດຄື prefix ຂອງ ISN)
  if (body.category_code !== undefined) {
    const cat = String(body.category_code).trim();
    if (!cat) return NextResponse.json({ error: "ຕ້ອງລະບຸ category_code" }, { status: 400 });
    try {
      await setItemCategory(itemCode, cat);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "ຕັ້ງໝວດບໍ່ສຳເລັດ" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  }

  await upsertIsnItemOverride(
    itemCode,
    body.require_isn === true,
    body.note === undefined || body.note === null ? null : String(body.note),
    guard.session.employee_code ?? null,
  );
  return NextResponse.json({ ok: true, overrides: await listIsnItemOverrides() });
}

export async function DELETE(request: Request) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const item = new URL(request.url).searchParams.get("item")?.trim() ?? "";
  if (!item) return NextResponse.json({ error: "ຕ້ອງລະບຸ ?item=" }, { status: 400 });

  await deleteIsnItemOverride(item);
  return NextResponse.json({ ok: true, overrides: await listIsnItemOverrides() });
}

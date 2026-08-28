import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";
import type { Warehouse } from "../route";
import {
  detachChildWarehouses,
  isSnFlag,
  setWarehouseKind,
  setWarehouseSnFlag,
  warehouseKindError,
  warehouseSnFlags,
} from "@/lib/warehouseConfig";
import { type WarehouseKind, isWarehouseKind } from "@/lib/warehouseKind";

const SELECT_FIELDS = `
  code, name_1, name_2, address, telephone, fax,
  branch_code, wh_manager, status, latitude, longitude
`;

/** ລາຍການລະຫັດຈາກ body — ຮັບແຕ່ string ທີ່ບໍ່ວ່າງ ແລະ ບໍ່ຊ້ຳ. */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean))];
}

function nullableStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function numericOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const { code } = await ctx.params;
  if (!code) {
    return NextResponse.json({ error: "ລະຫັດສາງບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const status = body.status === 0 || body.status === false ? 0 : 1;

  const kind: WarehouseKind = isWarehouseKind(body.kind) ? body.kind : "main";
  const parentCodes = kind === "sub" ? strList(body.parent_codes) : [];
  const kindErr = await warehouseKindError(code, kind, parentCodes);
  if (kindErr) return NextResponse.json({ error: kindErr }, { status: 400 });

  const rows = await query<Omit<Warehouse, "sn" | "kind" | "parent_codes">>(
    `UPDATE public.ic_warehouse
     SET name_1 = $2,
         name_2 = $3,
         address = $4,
         telephone = $5,
         fax = $6,
         branch_code = $7,
         wh_manager = $8,
         status = $9,
         latitude = $10,
         longitude = $11
     WHERE code = $1
     RETURNING ${SELECT_FIELDS}`,
    [
      code,
      nullableStr(body.name_1),
      nullableStr(body.name_2),
      nullableStr(body.address),
      nullableStr(body.telephone),
      nullableStr(body.fax),
      nullableStr(body.branch_code),
      nullableStr(body.wh_manager),
      status,
      numericOrNull(body.latitude),
      numericOrNull(body.longitude),
    ],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບສາງ" }, { status: 404 });
  }

  // ສາງຫຼັກ/ຍ່ອຍ ຢູ່ໃນ config ຂອງ WMS ບໍ່ແມ່ນ master ຂອງ ERP — ບັນທຶກແຍກ.
  try {
    await setWarehouseKind(code, kind, parentCodes, guard.session.employee_code ?? null);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "ບັນທຶກປະເພດສາງບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  }
  // ຍົກຂຶ້ນເປັນສາງຫຼັກແລ້ວຍັງມີລູກຄ້າງ ບໍ່ເປັນຫຍັງ (ຊັ້ນດຽວຄືເກົ່າ) — ແຕ່ຖ້າຖືກ
  // ຫຼຸດເປັນຍ່ອຍ warehouseKindError ຂ້າງເທິງໄດ້ປະຕິເສດໄປແລ້ວ.

  // SN menu flags are managed separately (the matrix / single PATCH), so the
  // edit form only touches warehouse fields — return the current flags.
  const sn = await warehouseSnFlags(code);
  return NextResponse.json({
    ok: true,
    warehouse: { ...rows[0], sn, kind, parent_codes: parentCodes },
  });
}

/** Flip one SN menu flag for one warehouse. Body: { flag, value: boolean }. */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const { code } = await ctx.params;
  if (!code) {
    return NextResponse.json({ error: "ລະຫັດສາງບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (!isSnFlag(body.flag)) {
    return NextResponse.json({ error: "flag ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }
  if (typeof body.value !== "boolean") {
    return NextResponse.json({ error: "ຕ້ອງລະບຸ value (true/false)" }, { status: 400 });
  }

  const exists = await query<{ code: string }>(
    `SELECT code FROM public.ic_warehouse WHERE code = $1`,
    [code],
  );
  if (exists.length === 0) {
    return NextResponse.json({ error: "ບໍ່ພົບສາງ" }, { status: 404 });
  }

  await setWarehouseSnFlag(code, body.flag, body.value, guard.session.employee_code ?? null);
  return NextResponse.json({ ok: true, code, flag: body.flag, value: body.value });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ code: string }> },
) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const { code } = await ctx.params;
  if (!code) {
    return NextResponse.json({ error: "ລະຫັດສາງບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  try {
    const rows = await query<{ code: string }>(
      `DELETE FROM public.ic_warehouse WHERE code = $1 RETURNING code`,
      [code],
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "ບໍ່ພົບສາງ" }, { status: 404 });
    }
    // Also clear any role-assignment references to this warehouse.
    await query(
      `DELETE FROM public.wms_user_warehouse WHERE warehouse_code = $1`,
      [code],
    );
    // ສາງຍ່ອຍທີ່ຂຶ້ນກັບສາງນີ້ ຕ້ອງກັບໄປເປັນສາງຫຼັກ ບໍ່ດັ່ງນັ້ນຈະຊີ້ຫາແມ່ທີ່ບໍ່ມີ.
    await detachChildWarehouses(code);
    // And its WMS config row.
    await query(
      `DELETE FROM public.odg_wms_warehouse_config WHERE wh_code = $1`,
      [code],
    );
    return NextResponse.json({ ok: true, code });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === "23503") {
      return NextResponse.json(
        {
          error:
            "ບໍ່ສາມາດລຶບໄດ້ — ມີຂໍ້ມູນອື່ນອ້າງອີງສາງນີ້. ກະລຸນາໃຊ້ວິທີ 'ປິດໃຊ້ງານ' ແທນ.",
        },
        { status: 409 },
      );
    }
    console.error("delete warehouse failed:", err);
    return NextResponse.json(
      { error: "ລຶບບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  }
}

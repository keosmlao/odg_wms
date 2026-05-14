import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireManager } from "@/lib/session";
import type { WmsRole } from "@/lib/session-shared";

const ALLOWED_ROLES: readonly WmsRole[] = ["manager", "supervisor", "keeper"];

function isWmsRole(v: unknown): v is WmsRole {
  return typeof v === "string" && (ALLOWED_ROLES as readonly string[]).includes(v);
}

export async function PUT(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const { id } = await ctx.params;
  const employeeId = Number.parseInt(id, 10);
  if (!Number.isFinite(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: "ID ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let body: { role?: unknown; warehouses?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  let role: WmsRole | null;
  if (body.role === null || body.role === "" || body.role === undefined) {
    role = null;
  } else if (isWmsRole(body.role)) {
    role = body.role;
  } else {
    return NextResponse.json({ error: "role ບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const rawWarehouses = Array.isArray(body.warehouses) ? body.warehouses : [];
  const warehouses = Array.from(
    new Set(
      rawWarehouses
        .filter((v): v is string => typeof v === "string" && v.trim() !== "")
        .map((v) => v.trim()),
    ),
  );

  if (
    employeeId === guard.session.employee_id &&
    role !== "manager"
  ) {
    return NextResponse.json(
      { error: "ບໍ່ສາມາດຫຼຸດສິດ manager ຂອງຕົນເອງ" },
      { status: 400 },
    );
  }

  // Manager sees all; clear any explicit assignments.
  const finalWarehouses = role === "manager" ? [] : warehouses;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const empCheck = await client.query<{ employee_id: number }>(
      `SELECT employee_id FROM public.odg_employee WHERE employee_id = $1`,
      [employeeId],
    );
    if (empCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "ບໍ່ພົບພະນັກງານ" }, { status: 404 });
    }

    if (role === null) {
      await client.query(
        `DELETE FROM public.wms_user_role WHERE employee_id = $1`,
        [employeeId],
      );
    } else {
      await client.query(
        `INSERT INTO public.wms_user_role (employee_id, role)
         VALUES ($1, $2)
         ON CONFLICT (employee_id)
         DO UPDATE SET role = EXCLUDED.role, updated_at = CURRENT_TIMESTAMP`,
        [employeeId, role],
      );
    }

    await client.query(
      `DELETE FROM public.wms_user_warehouse WHERE employee_id = $1`,
      [employeeId],
    );
    if (finalWarehouses.length > 0) {
      const placeholders = finalWarehouses
        .map((_, i) => `($1, $${i + 2})`)
        .join(", ");
      await client.query(
        `INSERT INTO public.wms_user_warehouse (employee_id, warehouse_code)
         VALUES ${placeholders}`,
        [employeeId, ...finalWarehouses],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("update employee role failed:", err);
    return NextResponse.json(
      { error: "ບັນທຶກບໍ່ສຳເລັດ" },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  return NextResponse.json({
    ok: true,
    employee_id: employeeId,
    role,
    warehouses: finalWarehouses,
  });
}

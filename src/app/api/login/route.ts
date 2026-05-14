import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import type { WmsRole } from "@/lib/session-shared";

type EmployeeRow = {
  employee_id: number;
  employee_code: string;
  fullname_lo: string | null;
  nickname: string | null;
  position_code: string | null;
  department_code: string | null;
  employment_status: string | null;
  password: string | null;
};

type RoleRow = { role: WmsRole };
type WarehouseRow = { warehouse_code: string };

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "ຂໍ້ມູນບໍ່ຖືກຕ້ອງ" }, { status: 400 });
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return NextResponse.json(
      { error: "ກະລຸນາປ້ອນລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານ" },
      { status: 400 },
    );
  }

  const rows = await query<EmployeeRow>(
    `SELECT employee_id, employee_code, fullname_lo, nickname,
            position_code, department_code, employment_status, password
     FROM public.odg_employee
     WHERE employee_code = $1
     LIMIT 1`,
    [username],
  );

  const user = rows[0];

  if (!user || user.password == null || user.password !== password) {
    return NextResponse.json(
      { error: "ລະຫັດພະນັກງານ ຫຼື ລະຫັດຜ່ານບໍ່ຖືກຕ້ອງ" },
      { status: 401 },
    );
  }

  if (user.employment_status && user.employment_status !== "ACTIVE") {
    return NextResponse.json(
      { error: "ບັນຊີນີ້ບໍ່ໄດ້ເປີດໃຊ້ງານ" },
      { status: 403 },
    );
  }

  const [roleRows, warehouseRows] = await Promise.all([
    query<RoleRow>(
      `SELECT role FROM public.wms_user_role WHERE employee_id = $1 LIMIT 1`,
      [user.employee_id],
    ),
    query<WarehouseRow>(
      `SELECT warehouse_code
       FROM public.wms_user_warehouse
       WHERE employee_id = $1
       ORDER BY warehouse_code`,
      [user.employee_id],
    ),
  ]);

  const role = roleRows[0]?.role ?? null;
  const warehouses = warehouseRows.map((r) => r.warehouse_code);

  const session = {
    employee_id: user.employee_id,
    employee_code: user.employee_code,
    fullname_lo: user.fullname_lo,
    nickname: user.nickname,
    position_code: user.position_code,
    department_code: user.department_code,
    role,
    warehouses,
  };

  const res = NextResponse.json({ ok: true, user: session });
  res.cookies.set("wms_session", JSON.stringify(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}

import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

/**
 * Self-promote the current user to manager — only allowed when zero
 * managers exist in the system. After the first manager is created,
 * subsequent calls return 403.
 */
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "ກະລຸນາເຂົ້າສູ່ລະບົບກ່ອນ" },
      { status: 401 },
    );
  }

  const inserted = await query<{ employee_id: number }>(
    `INSERT INTO public.wms_user_role (employee_id, role)
     SELECT $1, 'manager'
     WHERE NOT EXISTS (
       SELECT 1 FROM public.wms_user_role WHERE role = 'manager'
     )
     ON CONFLICT (employee_id)
     DO UPDATE SET role = 'manager', updated_at = CURRENT_TIMESTAMP
     WHERE NOT EXISTS (
       SELECT 1 FROM public.wms_user_role WHERE role = 'manager'
     )
     RETURNING employee_id`,
    [session.employee_id],
  );

  if (inserted.length === 0) {
    return NextResponse.json(
      { error: "ມີ manager ໃນລະບົບແລ້ວ — ກະລຸນາຕິດຕໍ່ຜູ້ຈັດການເພື່ອມອບໝາຍສິດ" },
      { status: 403 },
    );
  }

  const newSession = {
    ...session,
    role: "manager" as const,
    warehouses: [],
  };

  const res = NextResponse.json({ ok: true, user: newSession });
  res.cookies.set("wms_session", JSON.stringify(newSession), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}

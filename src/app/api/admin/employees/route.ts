import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { requireManager } from "@/lib/session";
import type { WmsRole } from "@/lib/session-shared";

type Row = {
  employee_id: number;
  employee_code: string;
  fullname_lo: string | null;
  nickname: string | null;
  position_code: string | null;
  department_code: string | null;
  employment_status: string | null;
  role: WmsRole | null;
  warehouses: string[];
};

export async function GET() {
  const guard = await requireManager();
  if (!guard.ok) return guard.response;

  const rows = await query<Row>(`
    SELECT
      e.employee_id,
      e.employee_code,
      e.fullname_lo,
      e.nickname,
      e.position_code,
      e.department_code,
      e.employment_status,
      r.role,
      COALESCE(
        (SELECT array_agg(w.warehouse_code ORDER BY w.warehouse_code)
         FROM public.wms_user_warehouse w
         WHERE w.employee_id = e.employee_id),
        ARRAY[]::varchar[]
      ) AS warehouses
    FROM public.odg_employee e
    LEFT JOIN public.wms_user_role r ON r.employee_id = e.employee_id
    WHERE COALESCE(e.employment_status, 'ACTIVE') = 'ACTIVE'
    ORDER BY e.fullname_lo NULLS LAST, e.employee_code
  `);

  return NextResponse.json({ employees: rows });
}

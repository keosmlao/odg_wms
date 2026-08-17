import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import type { WmsRole } from "@/lib/session-shared";
import { type WmsPerm, permissionsForMany } from "@/lib/permissions";
import { WMS_DEPARTMENT_CODES } from "@/lib/wmsDepartments";
import AccessClient from "./AccessClient";
import { Hero, Chip, KpiCard } from "@/components/ui/Card";
import {
  BuildingIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/ui/Icons";

export type EmployeeRow = {
  employee_id: number;
  employee_code: string;
  fullname_lo: string | null;
  nickname: string | null;
  position_code: string | null;
  department_code: string | null;
  department_name: string | null;
  /** ຢູ່ນອກພະແນກ WMS ແຕ່ຖືສິດຢູ່ — ສະແດງໄວ້ເພື່ອໃຫ້ຖອນສິດໄດ້. */
  out_of_scope: boolean;
  role: WmsRole | null;
  warehouses: string[];
  /** Extra grants beyond the role — empty for a manager, who holds them all. */
  permissions: WmsPerm[];
};

export type WarehouseRow = { code: string; name: string | null };

export default async function AccessPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const [employeeRows, warehouses] = await Promise.all([
    // ພະນັກງານ ACTIVE ທັງໝົດ — ມອບສິດໃຫ້ພະແນກໃດກໍ່ໄດ້. ຄົນນອກພະແນກສາງ/ໄອທີ
    // ຖືກໝາຍ out_of_scope ໄວ້ ເພື່ອໃຫ້ UI ເຕືອນ ບໍ່ແມ່ນເພື່ອຕັດອອກ.
    query<Omit<EmployeeRow, "permissions">>(`
      SELECT
        e.employee_id, e.employee_code, e.fullname_lo, e.nickname,
        e.position_code, e.department_code,
        d.department_name_lo AS department_name,
        (r.role IS NOT NULL
          AND (e.department_code IS NULL OR NOT (e.department_code = ANY($1)))) AS out_of_scope,
        r.role,
        COALESCE(
          (SELECT array_agg(w.warehouse_code ORDER BY w.warehouse_code)
           FROM public.wms_user_warehouse w
           WHERE w.employee_id = e.employee_id),
          ARRAY[]::varchar[]
        ) AS warehouses
      FROM public.odg_employee e
      LEFT JOIN public.wms_user_role r ON r.employee_id = e.employee_id
      LEFT JOIN public.odg_department d ON d.department_code = e.department_code
      WHERE COALESCE(e.employment_status, 'ACTIVE') = 'ACTIVE'
      ORDER BY e.fullname_lo NULLS LAST, e.employee_code
    `, [WMS_DEPARTMENT_CODES]),
    query<WarehouseRow>(`
      SELECT code, name_1 AS name
      FROM public.ic_warehouse
      WHERE COALESCE(status, 1) = 1 AND code IS NOT NULL
      ORDER BY code
    `),
  ]);

  // Grants are stored per employee, in one round-trip rather than per row.
  const permsByEmployee = await permissionsForMany(employeeRows.map((e) => e.employee_id));
  const employees: EmployeeRow[] = employeeRows.map((e) => ({
    ...e,
    permissions: permsByEmployee[e.employee_id] ?? [],
  }));

  const counts = {
    total: employees.length,
    manager: employees.filter((e) => e.role === "manager").length,
    supervisor: employees.filter((e) => e.role === "supervisor").length,
    keeper: employees.filter((e) => e.role === "keeper").length,
    none: employees.filter((e) => !e.role).length,
  };

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຈັດການສິດເຂົ້າເຖິງ"
        description="ກຳນົດ role ແລະ ສາງທີ່ຮັບຜິດຊອບໃຫ້ແຕ່ລະພະນັກງານ — ພະນັກງານ ACTIVE ທຸກພະແນກ"
        icon={<ShieldIcon className="h-6 w-6" />}
        tone="aqua"
        chips={
          <>
            <Chip tone="primary">ຜູ້ຈັດການ</Chip>
            <Chip>
              <UsersIcon className="h-3.5 w-3.5" />
              {counts.total} ພະນັກງານ ACTIVE
            </Chip>
            <Chip>
              <BuildingIcon className="h-3.5 w-3.5" />
              {warehouses.length} ສາງ ໃຫ້ມອບໝາຍ
            </Chip>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<ShieldIcon className="h-4 w-4" />}
          label="ຜູ້ຈັດການ"
          value={counts.manager}
          tone="aqua"
          highlight
        />
        <KpiCard
          icon={<UsersIcon className="h-4 w-4" />}
          label="Supervisor"
          value={counts.supervisor}
          tone="navy"
          highlight
        />
        <KpiCard
          icon={<BuildingIcon className="h-4 w-4" />}
          label="ນາຍສາງ"
          value={counts.keeper}
          tone="emerald"
          highlight
        />
        <KpiCard
          icon={<UsersIcon className="h-4 w-4" />}
          label="ຍັງບໍ່ມີສິດ"
          value={counts.none}
          tone="amber"
        />
      </section>

      <AccessClient
        initialEmployees={employees}
        warehouses={warehouses}
        currentEmployeeId={session.employee_id}
      />
    </div>
  );
}

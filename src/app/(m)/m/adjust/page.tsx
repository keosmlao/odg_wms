import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import ScanLocationClient, { type WarehouseOption } from "./ScanLocationClient";

/**
 * ໜ້າຫຼັກຂອງແອັບປັບປຸງສະຕ໋ອກ (ມືຖື) — ເລືອກສາງ ແລ້ວຍິງ location.
 */
export default async function MobileAdjustPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="p-5 text-center text-sm font-semibold text-amber-700">
        ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS
      </div>
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <div className="p-5 text-center text-sm font-semibold text-amber-700">
        ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ
      </div>
    );
  }

  const warehouses =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 AND code IS NOT NULL ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  const name =
    session.nickname?.trim() || session.fullname_lo?.trim() || session.employee_code || "";

  return <ScanLocationClient warehouses={warehouses} userName={name} />;
}

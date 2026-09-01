import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { query } from "@/lib/db";
import MobilePickClient, { type WarehouseOption } from "./MobilePickClient";

/**
 * ໃບຈັດເຄື່ອງເທິງມືຖື — ໜຶ່ງລາຍການຕໍ່ໜຶ່ງໜ້າຈໍ.
 *
 * ໜ້າ desktop (/movements/pick) ສະແດງແຜນທັງໃບເປັນຕາຕະລາງເພື່ອພິມ; ໜ້ານີ້ພາຄົນ
 * ຍ່າງເກັບເທື່ອລະບ່ອນ ຍິງຢືນຢັນ ແລ້ວໄປລາຍການຕໍ່ໄປ. ທັງສອງໃຊ້ແຜນອັນດຽວກັນ
 * (src/lib/pickPlan.ts) ຈຶ່ງລຳດັບການຍ່າງຕົງກັນແນ່ນອນ.
 */
export default async function MobilePickPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="px-4 py-10 text-center text-sm font-semibold text-amber-700 dark:text-amber-400">
        ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS
      </div>
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm font-semibold text-amber-700 dark:text-amber-400">
        ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ
      </div>
    );
  }

  const warehouses =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status,1)=1 ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  return <MobilePickClient warehouses={warehouses} />;
}

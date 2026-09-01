import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowLeftRightIcon } from "@/components/ui/Icons";
import RebalanceClient, { type WarehouseOption } from "./RebalanceClient";

/**
 * ຂໍ້ສະເໜີການໂອນ — ຕໍ່ຍອດຈາກໜ້າຄວາມພຽງພໍ: ຄວນຍ້າຍຫຍັງ ຈາກໃສ ໄປໃສ ເທົ່າໃດ.
 */
export default async function RebalancePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ"
      />
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

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຂໍ້ສະເໜີການໂອນ / Rebalance"
        description="ຍ້າຍຂອງທີ່ນອນຢູ່ ໄປບ່ອນທີ່ມີຄົນຊື້ — ຄິດຈາກຍອດຂາຍຈິງຂອງແຕ່ລະສາງ"
        icon={<ArrowLeftRightIcon className="h-6 w-6" />}
        tone="navy"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <RebalanceClient warehouses={warehouses} />
    </div>
  );
}

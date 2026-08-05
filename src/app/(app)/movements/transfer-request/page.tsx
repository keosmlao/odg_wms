import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowLeftRightIcon } from "@/components/ui/Icons";
import BackButton from "@/components/BackButton";
import TransferRequestClient, { type WarehouseOption } from "./TransferRequestClient";

export default async function TransferRequestPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  // All warehouses can be a source; the destination is restricted to the user's.
  const allWh = await query<WarehouseOption>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`);
  const destWh = accessible === null ? allWh : allWh.filter((w) => accessible.includes(w.code));

  return (
    <div className="w-full space-y-5">
      <BackButton href="/movements/transfer-dashboard" />
      <Hero
        title="ອອກໃບຂໍໂອນ (ໃບຂໍ)"
        description="ສ້າງໃບຂໍໂອນສິນຄ້າຈາກສາງอื่น — ສາງปลายทาง(ຜູ້ຂໍ) ຂໍສິນຄ້າຈາກສາງຕົ້ນທາງ. ສาง source ຈ່າຍອອກภายหลัง"
        icon={<ArrowLeftRightIcon className="h-6 w-6" />}
        tone="navy"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <TransferRequestClient
        allWarehouses={allWh}
        destWarehouses={destWh}
        requester={`${session.nickname?.trim() || session.fullname_lo?.trim() || session.employee_code || ""}${session.employee_code ? ` (${session.employee_code})` : ""}`}
      />
    </div>
  );
}

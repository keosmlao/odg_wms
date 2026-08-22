import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ListIcon } from "@/components/ui/Icons";
import MonthlyClient, { type WarehouseOption } from "./MonthlyClient";

export default async function MonthlyPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const warehouses =
    accessible === null
      ? await query<WarehouseOption>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`)
      : await query<WarehouseOption>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`, [accessible]);

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ເຄື່ອນໄຫວລາຍເດືອນ ຕາມສິນຄ້າ"
        description="ລະຫັດ · ຊື່ສິນຄ້າ · ຍີ່ຫໍ້ · ຫົວໜ່ວຍ · ຄົງເຫຼືອ · ເຂົ້າ · ອອກ — ໜຶ່ງແຖວຕໍ່ໜຶ່ງລາຍການສິນຄ້າ ຕໍ່ເດືອນ"
        icon={<ListIcon className="h-6 w-6" />}
        tone="violet"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <MonthlyClient warehouses={warehouses} />
    </div>
  );
}

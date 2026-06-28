import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, TrendIcon } from "@/components/ui/Icons";
import MoversClient, { type WarehouseOption } from "./MoversClient";

export default async function MoversPage() {
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
        title="ສິນຄ້າເຄື່ອນໄຫວ / Movers"
        description="ສິນຄ້າเคลื່อนไหวໄວສຸດ (fast movers) ແລະ ແນວໂນ້ມ ເຂົ້າ/ອອກ ຕາມເວລາ"
        icon={<TrendIcon className="h-6 w-6" />}
        tone="blue"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <MoversClient warehouses={warehouses} />
    </div>
  );
}

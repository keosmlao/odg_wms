import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, SearchIcon } from "@/components/ui/Icons";
import AssortmentClient, { type WarehouseOption } from "./AssortmentClient";

/**
 * ຊ່ອງຫວ່າງລາຍການສິນຄ້າ — ຂາຍດີຢູ່ສາງໜຶ່ງ ແຕ່ອີກສາງບໍ່ຂາຍເລີຍ.
 *
 * ຄົນລະຄຳຖາມກັບໜ້າ "ຂໍ້ສະເໜີການໂອນ": ອັນນັ້ນຄືການຍ້າຍຂອງທີ່ທັງສອງບ່ອນຂາຍຢູ່ແລ້ວ
 * ອັນນີ້ຄືການ **ເປີດລາຍການໃໝ່** ຊຶ່ງເປັນການຕັດສິນໃຈທາງການຄ້າ.
 */
export default async function AssortmentPage() {
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
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 AND code IS NOT NULL ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຊ່ອງຫວ່າງລາຍການ / Assortment"
        description="ຂາຍໄດ້ຢູ່ສາງໜຶ່ງ ແຕ່ອີກສາງບໍ່ຂາຍເລີຍ — ລາຍການທີ່ຄວນພິຈາລະນາເປີດຂາຍເພີ່ມ"
        icon={<SearchIcon className="h-6 w-6" />}
        tone="navy"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <AssortmentClient warehouses={warehouses} />
    </div>
  );
}

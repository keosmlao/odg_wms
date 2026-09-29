import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { warehouseSnFlagMap } from "@/lib/warehouseConfig";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowLeftRightIcon } from "@/components/ui/Icons";
import RelocateClient, { type WarehouseOption } from "./RelocateClient";

export default async function RelocatePage() {
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

  const whRows =
    accessible === null
      ? await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1
           ORDER BY code`,
        )
      : await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE code = ANY($1)
           ORDER BY code`,
          [accessible],
        );

  // ນະໂຍບາຍ SN ຂອງໜ້ານີ້ ໃຊ້ flag ດຽວກັນກັບ "ຍ້າຍ pallet" (sn_pallet) — ທັງສອງເປັນ
  // ການຍ້າຍບ່ອນເກັບພາຍໃນສາງແບບດຽວກັນ, ຍັງບໍ່ໄດ້ແຍກ flag ໃໝ່ (ຕ້ອງການ migration).
  const snMove = await warehouseSnFlagMap(whRows.map((w) => w.code), "pallet");
  const warehouses: WarehouseOption[] = whRows.map((w) => ({ ...w, sn_move: snMove[w.code] ?? true }));

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຍ້າຍບ່ອນເກັບ"
        description="ຍ້າຍສິນຄ້າຈາກ ຈຸດທີ 1 → ຈຸດທີ 2 ພາຍໃນສາງດຽວກັນ — ສິນຄ້າ serial ຈະຍ້າຍ SN ໄປນຳ"
        icon={<ArrowLeftRightIcon className="h-6 w-6" />}
        tone="emerald"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <RelocateClient warehouses={warehouses} />
    </div>
  );
}

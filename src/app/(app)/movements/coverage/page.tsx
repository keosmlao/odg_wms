import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { warehouseTreeMap } from "@/lib/warehouseConfig";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, TrendIcon } from "@/components/ui/Icons";
import CoverageClient, { type WarehouseOption } from "./CoverageClient";

/**
 * ວິເຄາະຄວາມພຽງພໍຂອງສິນຄ້າຕໍ່ການຂາຍ — "ຂອງທີ່ຈັດເກັບ ພຽງພໍຂາຍບໍ?"
 *
 * ຕ່າງຈາກໜ້າ stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ທີ່ທຽບກັບຄ່າທີ່ຄົນຕັ້ງໄວ້ເອງ — ໜ້ານີ້ທຽບກັບ
 * **ຍອດຂາຍຈິງ** ຈຶ່ງບອກໄດ້ວ່າ ຂອງທີ່ມີ ພໍຂາຍໄປໄດ້ອີກຈັກມື້.
 */
export default async function CoveragePage() {
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

  // ດຶງເທື່ອດຽວແລ້ວແຍກສອງບົດບາດ: ວິເຄາະໄດ້ສະເພາະສາງທີ່ມີສິດ ແຕ່ **ຕົ້ນທາງ** ຂອງ
  // ໃບຂໍໂອນຕ້ອງເປັນສາງໃດກໍ່ໄດ້ (ຄືກັບໜ້າ /movements/transfer-request).
  const rows = await query<{ code: string; name: string | null }>(
    `SELECT code, name_1 AS name FROM public.ic_warehouse
     WHERE COALESCE(status, 1) = 1 AND code IS NOT NULL ORDER BY code`,
  );
  // ສາງຫຼັກ/ຍ່ອຍ ຢູ່ຕາຕະລາງ config ຂອງ WMS — ຕິດປ້າຍໃສ່ ເພື່ອໃຫ້ໜ້າຈໍຈັດກຸ່ມ
  // "ຫຼັກ + ຍ່ອຍ" ໄດ້ ໂດຍບໍ່ຕ້ອງເດົາຈາກລະຫັດສາງ.
  const tree = await warehouseTreeMap(rows.map((r) => r.code));
  const allWarehouses: WarehouseOption[] = rows.map((r) => ({
    ...r,
    kind: tree[r.code]?.kind ?? "main",
    parent_code: tree[r.code]?.parent_code ?? null,
  }));
  const warehouses =
    accessible === null
      ? allWarehouses
      : allWarehouses.filter((w) => accessible.includes(w.code));

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ວິເຄາະຄວາມພຽງພໍ / Coverage"
        description="ຂອງທີ່ຈັດເກັບໄວ້ ພຽງພໍສຳລັບການຂາຍບໍ — ທຽບຄົງເຫຼືອກັບຍອດຂາຍຈິງ ເປັນ ‘ວັນທີ່ພໍໃຊ້’"
        icon={<TrendIcon className="h-6 w-6" />}
        tone="navy"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />
      <CoverageClient warehouses={warehouses} allWarehouses={allWarehouses} />
    </div>
  );
}

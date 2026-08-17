import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listMinStockRules, listMinStockWarehouses } from "@/lib/minStock";
import MinStockClient from "./MinStockClient";

export default async function MinStockSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/");

  const warehouses = await listMinStockWarehouses();
  // ເປີດມາໃສ່ສາງທຳອິດທີ່ເປີດຄຸມຢູ່ແລ້ວ; ຖ້າຍັງບໍ່ມີ ໃຫ້ໃສ່ສາງທຳອິດທີ່ມີກົດ; ສຸດທ້າຍຄືສາງທຳອິດ.
  const initialWh =
    warehouses.find((w) => w.enabled)?.wh_code ??
    warehouses.find((w) => w.rules > 0)?.wh_code ??
    warehouses[0]?.wh_code ??
    "";
  const rules = initialWh ? await listMinStockRules(initialWh) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          ເລືອກວ່າ<b>ສາງໃດຄຸມ</b> stock ຂັ້ນຕ່ຳ/ຂັ້ນສູງ ແລ້ວຕັ້ງຄ່າເປັນລາຍສິນຄ້າ (ພິມເອງ ຫຼື ນຳເຂົ້າ Excel).
          ສາງທີ່ເປີດຄຸມຈະຖືກເຕືອນໃນ<b>ໜ້າຫຼັກ</b>, <b>ໜ້າຈ່າຍອອກ</b>, <b>ໜ້າຄົງເຫຼືອ</b> ແລະ <b>ລາຍງານທາງເມວ</b>.
        </p>
      </div>
      <MinStockClient initialWarehouses={warehouses} initialWh={initialWh} initialRules={rules} />
    </div>
  );
}

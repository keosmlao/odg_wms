import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getDepositSettings } from "@/lib/deposit-server";
import DepositSettingsForm from "./DepositSettingsForm";

export default async function DepositSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ສະເພາະຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດປ່ຽນຄ່າຝາກ
        </p>
      </div>
    );
  }

  const settings = await getDepositSettings();

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          ການຕັ້ງຄ່າ
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          ຄ່າຝາກເຄື່ອງ
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          ກຳນົດເງື່ອນໄຂການຄຳນວນຄ່າຝາກ. ຄ່າທີ່ປ່ຽນຈະໃຊ້ກັບການຝາກໃໝ່ເທົ່ານັ້ນ —
          ການຝາກທີ່ມີຢູ່ແລ້ວໃຊ້ rate ທີ່ snapshot ໄວ້ຕອນສ້າງ.
        </p>
      </header>

      <DepositSettingsForm initialSettings={settings} />
    </div>
  );
}

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { listReports } from "@/lib/emailReportConfig";
import { mailConfigError } from "@/lib/mailer";
import EmailReportsClient from "./EmailReportsClient";

export const dynamic = "force-dynamic";

export default async function EmailReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ສະເພາະຜູ້ຈັດການເທົ່ານັ້ນທີ່ສາມາດຕັ້ງຄ່າລາຍງານທາງເມວ
        </p>
      </div>
    );
  }

  const [reports, warehouses] = await Promise.all([
    listReports(),
    query<{ code: string; name: string | null }>(
      `SELECT code, name_1 AS name FROM public.ic_warehouse ORDER BY code`,
    ),
  ]);

  return (
    <div className="w-full space-y-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
          ການຕັ້ງຄ່າ
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          ລາຍງານທາງເມວ ອັດຕະໂນມັດ
        </h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          ຕັ້ງໃຫ້ລະບົບສົ່ງລາຍງານ (ຮັບເຂົ້າ/ຈ່າຍອອກ, ໃບຄ້າງຮັບ, ສະຖານະສາງ) ທາງເມວ
          ຕາມເວລາ ແລະ ຜູ້ຮັບທີ່ກຳນົດ. ລະບົບກວດທຸກນາທີ ແລະ ສົ່ງ 1 ຄັ້ງຕໍ່ມື້ຕໍ່ລາຍງານ.
        </p>
      </header>

      <EmailReportsClient
        initialReports={reports}
        warehouses={warehouses}
        mailError={mailConfigError()}
      />
    </div>
  );
}

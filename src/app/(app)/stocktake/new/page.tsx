import { redirect } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice } from "@/components/ui/Card";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
import NewSessionForm from "./NewSessionForm";

export default async function NewStocktakePage() {
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

  const whOptions =
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

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 px-4 sm:px-0">
      <Hero
        title="ສ້າງຮອບກວດນັບໃໝ່"
        description="ເລືອກສາງທີ່ຈະກວດນັບ ແລະ ກຳນົດວັນທີ"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="indigo"
      />

      <div className="shadow-card rounded-3xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800 sm:p-6">
        <NewSessionForm warehouses={whOptions} role={session.role} />
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <Link
            href="/stocktake"
            className="text-sm text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            ← ກັບໄປໜ້າຮອບກວດນັບ
          </Link>
        </div>
      </div>
    </div>
  );
}

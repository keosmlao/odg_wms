import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { ChevronRightIcon, PlusIcon } from "@/components/ui/Icons";
import { getDepositSettings } from "@/lib/deposit-server";
import NewDepositForm from "./NewDepositForm";

export default async function NewDepositPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ບໍ່ມີສິດເຂົ້າເຖິງ WMS
        </p>
      </div>
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ
        </p>
      </div>
    );
  }

  const whOptions =
    accessible === null
      ? await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 ORDER BY code`,
        )
      : await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  const settings = await getDepositSettings();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <nav className="mb-3 flex items-center gap-2 text-sm">
        <Link
          href="/deposits"
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          ຮັບຝາກເຄື່ອງ
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="font-semibold text-zinc-800 dark:text-zinc-100">
          ຮັບຝາກໃໝ່
        </span>
      </nav>

      <header className="mb-5 flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-white shadow-sm shadow-indigo-500/30">
          <PlusIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            ຮັບຝາກເຄື່ອງ
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            ສ້າງລາຍການຮັບຝາກ
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            ເລືອກສາງ ແລະ ບິນຄ້າງຈ່າຍ ເພື່ອບັນທຶກເປັນຮັບຝາກ — ຄ່າຝາກຈະຄິດເມື່ອມີການມາຮັບ
          </p>
        </div>
      </header>

      <NewDepositForm warehouses={whOptions} initialSettings={settings} />
    </div>
  );
}

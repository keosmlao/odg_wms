import { redirect } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon, ChevronRightIcon, PlusIcon } from "@/components/ui/Icons";
import StocktakeLayout from "../_components/StocktakeLayout";
import {
  stEyebrow,
  stMuted,
  stNavLink,
  stPanel,
  stPanelPad,
  stTitleLg,
} from "../_components/stocktake-theme";
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
    <StocktakeLayout>
      <nav className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/stocktake" className={stNavLink}>
          ກວດນັບສິນຄ້າ
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          ສ້າງຮອບໃໝ່
        </span>
      </nav>

      <div className="w-full">
        <header className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 text-white shadow-sm shadow-indigo-500/30">
            <PlusIcon className="h-5 w-5" />
          </div>
          <div>
            <p className={stEyebrow}>ກວດນັບສິນຄ້າ</p>
            <h1 className={`mt-1 ${stTitleLg}`}>ສ້າງຮອບກວດນັບໃໝ່</h1>
            <p className={`mt-1 ${stMuted}`}>
              ເລືອກສາງ ແລະ ວັນທີ່ນັບ — ຈາກນັ້ນສ້າງປ້າຍແລະເລີ່ມນັບໄດ້ທັນທີ
            </p>
          </div>
        </header>

        <div className={`${stPanel} ${stPanelPad}`}>
          <NewSessionForm warehouses={whOptions} role={session.role} />
        </div>

        <div className="mt-4 text-center">
          <Link href="/stocktake" className={stNavLink}>
            ← ກັບໄປໜ້າຮອບກວດນັບ
          </Link>
        </div>
      </div>
    </StocktakeLayout>
  );
}

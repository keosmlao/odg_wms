import { redirect } from "next/navigation";
import Link from "next/link";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon, CheckIcon } from "@/components/ui/Icons";
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
      <div className="mx-auto max-w-xl space-y-5">
        <div className={`${stPanel} ${stPanelPad}`}>
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-md shadow-indigo-600/25">
              <CheckIcon className="h-6 w-6" />
            </div>
            <div>
              <p className={stEyebrow}>ກວດນັບສິນຄ້າ</p>
              <h1 className={`mt-1 ${stTitleLg}`}>ສ້າງຮອບກວດນັບໃໝ່</h1>
              <p className={`mt-2 ${stMuted}`}>ເລືອກສາງ ແລະ ວັນທີ່ນັບ — ຈາກນັ້ນສ້າງປ້າຍແລະເລີ່ມນັບໄດ້ທັນທີ</p>
            </div>
          </div>
        </div>

        <div className={`${stPanel} ${stPanelPad}`}>
        <NewSessionForm warehouses={whOptions} role={session.role} />
        <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
          <Link href="/stocktake" className={stNavLink}>
            ← ກັບໄປໜ້າຮອບກວດນັບ
          </Link>
        </div>
        </div>
      </div>
    </StocktakeLayout>
  );
}

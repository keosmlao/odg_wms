import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ListIcon, PackageIcon } from "@/components/ui/Icons";
import SnCheckClient, { type WarehouseOption } from "./SnCheckClient";
import SnMoveHistory from "./SnMoveHistory";
import SnadjCleanup from "./SnadjCleanup";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function SnCheckPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = rawTab === "history" ? "history" : rawTab === "snadj" ? "snadj" : "check";

  const warehouses =
    tab === "check"
      ? accessible === null
        ? await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status, 1) = 1 ORDER BY code`,
          )
        : await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
            [accessible],
          )
      : [];

  const tabBase = "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition";
  const tabActive = "bg-gradient-to-r from-aqua-600 to-brand-700 text-white shadow-md shadow-aqua-500/20";
  const tabIdle = "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ກວດ SN ທຽບ Stock"
        description="ກວດສິນຄ້າ serial ທີ່ location ຂອງ SN ≠ location ຂອງ WMS stock ແລ້ວຍ້າຍ SN ໄປໃຫ້ຕົງກັບ WMS (ຖື location WMS ເປັນຫຼັກ)"
        icon={<PackageIcon className="h-6 w-6" />}
        tone="aqua"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href="/movements/sn-check" className={`${tabBase} ${tab === "check" ? tabActive : tabIdle}`}>
          <PackageIcon className="h-4 w-4" />
          ກວດ + ຍ້າຍ SN
        </Link>
        <Link href="/movements/sn-check?tab=history" className={`${tabBase} ${tab === "history" ? tabActive : tabIdle}`}>
          <ListIcon className="h-4 w-4" />
          ປະຫວັດການຍ້າຍ SN
        </Link>
        <Link href="/movements/sn-check?tab=snadj" className={`${tabBase} ${tab === "snadj" ? tabActive : tabIdle}`}>
          <AlertIcon className="h-4 w-4" />
          ລ້າງ SNADJ (ເກົ່າ)
        </Link>
      </div>

      {tab === "history" ? (
        <SnMoveHistory session={session} params={params} />
      ) : tab === "snadj" ? (
        <SnadjCleanup />
      ) : (
        <SnCheckClient warehouses={warehouses} />
      )}
    </div>
  );
}

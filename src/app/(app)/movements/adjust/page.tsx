import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { warehouseSnFlagMap } from "@/lib/warehouseConfig";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, CheckIcon, ListIcon } from "@/components/ui/Icons";
import AdjustClient, { type WarehouseOption } from "./AdjustClient";
import AdjustHistory from "./AdjustHistory";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AdjustPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
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

  const params = await searchParams;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab = rawTab === "history" ? "history" : "adjust";

  // Only the form tab needs the warehouse list up front.
  const whRows =
    tab === "adjust"
      ? accessible === null
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
          )
      : [];

  // The ADJUST menu's SN flag decides, per warehouse, whether serial items are
  // counted by scanning SN or by typing a quantity.
  const snAdjust = await warehouseSnFlagMap(whRows.map((w) => w.code), "adjust");
  const warehouses: WarehouseOption[] = whRows.map((w) => ({
    ...w,
    sn_adjust: snAdjust[w.code] ?? true,
  }));

  const tabBase =
    "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition";
  const tabActive =
    "bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/20";
  const tabIdle =
    "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ປັບປຸງ stock"
        description="ປັບຍອດສິນຄ້າຄົງເຫຼືອ ແລະ ກວດເບິ່ງຫຼັກຖານການປັບປຸງ (ວັນທີ, ຜູ້ປັບປຸງ, ເຫດຜົນ)"
        icon={<CheckIcon className="h-6 w-6" />}
        tone="amber"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      {/* Tabs — same menu, switch between the form and the audit history */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/movements/adjust" className={`${tabBase} ${tab === "adjust" ? tabActive : tabIdle}`}>
          <CheckIcon className="h-4 w-4" />
          ປັບປຸງ stock
        </Link>
        <Link href="/movements/adjust?tab=history" className={`${tabBase} ${tab === "history" ? tabActive : tabIdle}`}>
          <ListIcon className="h-4 w-4" />
          ປະຫວັດການປັບປຸງ
        </Link>
      </div>

      {tab === "history" ? (
        <AdjustHistory session={session} params={params} />
      ) : (
        <AdjustClient warehouses={warehouses} />
      )}
    </div>
  );
}

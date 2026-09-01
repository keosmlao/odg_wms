import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ListIcon, PlusIcon, TrendIcon, LayersIcon } from "@/components/ui/Icons";
import StockCardView, { type WarehouseOption } from "./StockCardView";
import StockCardEntry from "./StockCardEntry";
import StockCardSync from "./StockCardSync";
import StockCardDocs from "./StockCardDocs";

/**
 * ບັດສະຕັອກ (stock card) — a hand-kept side ledger, deliberately independent of
 * the WMS movement pages. Four tabs on one route:
 *   card → the card itself (ຍອດຕັ້ງຕົ້ນ + ເຂົ້າ − ອອກ = ຄົງເຫຼືອ)
 *   new  → filter items and post + / − entries down to rack → location
 *   docs → the batch documents those entries were posted under
 *   sync → re-baseline a warehouse's opening balance from the WMS ledger,
 *          per rack → location (migration 040)
 */
type SearchParams = Record<string, string | string[] | undefined>;
const TABS = ["card", "new", "docs", "sync"] as const;
type Tab = (typeof TABS)[number];

export default async function StockCardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
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
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "card";

  const warehouses: WarehouseOption[] =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 ORDER BY code`)
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`, [accessible]);

  const tabBase = "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition";
  const tabActive = "bg-gradient-to-r from-brand-500 to-aqua-600 text-white shadow-md shadow-brand-500/20";
  const tabIdle = "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";
  const link = (t: Tab, label: string, icon: React.ReactNode) => (
    <Link href={t === "card" ? "/stock-card" : `/stock-card?tab=${t}`} className={`${tabBase} ${tab === t ? tabActive : tabIdle}`}>
      {icon}{label}
    </Link>
  );

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ບັດສະຕັອກ (Stock card)"
        description="ຍອດຕັ້ງຕົ້ນ + ເຄື່ອນໄຫວເຂົ້າ-ອອກ = ຄົງເຫຼືອ · ບັນທຶກດ້ວຍມື ຮອດລະດັບ rack → location"
        icon={<LayersIcon className="h-6 w-6" />}
        tone="brand"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {link("card", "ບັດສະຕັອກ", <TrendIcon className="h-4 w-4" />)}
        {link("new", "ເພີ່ມຂໍ້ມູນ", <PlusIcon className="h-4 w-4" />)}
        {link("docs", "ປະຫວັດໃບບັນທຶກ", <ListIcon className="h-4 w-4" />)}
        {link("sync", "ຍອດຕັ້ງຕົ້ນ (sync)", <LayersIcon className="h-4 w-4" />)}
      </div>

      {tab === "new" ? <StockCardEntry warehouses={warehouses} />
        : tab === "sync" ? <StockCardSync />
        : tab === "docs" ? <StockCardDocs params={params} accessible={accessible} />
        : <StockCardView warehouses={warehouses} />}
    </div>
  );
}

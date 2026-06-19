import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowDownIcon, CheckIcon, ListIcon, PackageIcon } from "@/components/ui/Icons";
import ReceiveClient, { type WarehouseOption } from "./ReceiveClient";
import ReceiveHistory from "./ReceiveHistory";
import PendingList from "./PendingList";
import CountSheetList from "./CountSheetList";

type SearchParams = Record<string, string | string[] | undefined>;
type Tab = "pending" | "count" | "receive" | "history";

export default async function ReceivePage({
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
  const tab: Tab =
    rawTab === "count" ? "count"
    : rawTab === "receive" ? "receive"
    : rawTab === "history" ? "history"
    : "pending";

  const warehouses =
    tab === "receive"
      ? accessible === null
        ? await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`,
          )
        : await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
            [accessible],
          )
      : [];

  const tabBase = "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition";
  const tabActive = "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/20";
  const tabIdle = "bg-white text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800";
  // 3 tabs. "ຮັບອື່ນໆ" (transfer/return) is merged into ລາຍການຄ້າງຮັບ; its direct-
  // receive wizard is still reachable via ?tab=receive (deep-linked from a card).
  const tabs: { key: Tab; href: string; label: string; icon: React.ReactNode }[] = [
    { key: "pending", href: "/movements/receive", label: "ລາຍການຄ້າງຮັບ", icon: <PackageIcon className="h-4 w-4" /> },
    { key: "count", href: "/movements/receive?tab=count", label: "ໃບກວດນັບ", icon: <CheckIcon className="h-4 w-4" /> },
    { key: "history", href: "/movements/receive?tab=history", label: "ລາຍການຮັບສິນຄ້າ", icon: <ListIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຮັບສິນຄ້າເຂົ້າສາງ"
        description="ບິນຄ້າງຮັບ → ສ້າງໃບກວດນັບ (ອີງ packing list) → ຮັບເຂົ້າ WMS"
        icon={<ArrowDownIcon className="h-6 w-6" />}
        tone="emerald"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      <div className="flex flex-wrap items-center gap-2">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} className={`${tabBase} ${tab === t.key ? tabActive : tabIdle}`}>
            {t.icon} {t.label}
          </Link>
        ))}
      </div>

      <Suspense key={`${tab}:${Array.isArray(params.q) ? params.q[0] : params.q ?? ""}:${Array.isArray(params.page) ? params.page[0] : params.page ?? ""}`} fallback={<ListSkeleton />}>
        {tab === "history" ? (
          <ReceiveHistory session={session} params={params} />
        ) : tab === "count" ? (
          <CountSheetList session={session} params={params} />
        ) : tab === "receive" ? (
          <ReceiveClient
            warehouses={warehouses}
            initialSearch={Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "")}
            initialType={Array.isArray(params.type) ? (params.type[0] ?? "") : (params.type ?? "")}
            initialWh={Array.isArray(params.wh) ? (params.wh[0] ?? "") : (params.wh ?? "")}
          />
        ) : (
          <PendingList session={session} params={params} />
        )}
      </Suspense>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-[58px] animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800/50" />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="shadow-card flex items-center gap-3 rounded-2xl bg-white px-5 py-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-40 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
          </div>
          <div className="h-9 w-20 shrink-0 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        </div>
      ))}
    </div>
  );
}

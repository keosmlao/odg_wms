import { Fragment, Suspense } from "react";
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
import PackingListTab from "./PackingListTab";

type SearchParams = Record<string, string | string[] | undefined>;
type Tab = "packing" | "pending" | "count" | "receive" | "history";

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
    rawTab === "pending" ? "pending"
    : rawTab === "count" ? "count"
    : rawTab === "receive" ? "receive"
    : rawTab === "history" ? "history"
    : "packing";

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

  // Workflow steps: ① ໃບ packing → ② ຄ້າງຮັບ (PO) → ③ ໃບກວດນັບ → ຮັບເຂົ້າ.
  // History is separate.
  const steps = [
    { key: "packing", href: "/movements/receive", n: 1, label: "ໃບ packing", sub: "ນຳເຂົ້າ·ກວດ PO", icon: <PackageIcon className="h-4 w-4" /> },
    { key: "pending", href: "/movements/receive?tab=pending", n: 2, label: "ລາຍການຄ້າງຮັບ", sub: "ບິນ PO", icon: <PackageIcon className="h-4 w-4" /> },
    { key: "count", href: "/movements/receive?tab=count", n: 3, label: "ໃບກວດນັບ", sub: "ນັບ·ຮັບເຂົ້າ", icon: <CheckIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຮັບສິນຄ້າເຂົ້າສາງ"
        description="ໃບ packing (Excel/PDF) → ກວດ PO ອະນຸມັດ → ໃບກວດນັບ → ຮັບເຂົ້າ WMS"
        icon={<ArrowDownIcon className="h-6 w-6" />}
        tone="emerald"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Workflow segmented control: ① ຄ້າງຮັບ → ② ກວດນັບ */}
        <div className="inline-flex items-center gap-1 rounded-2xl border border-zinc-200/70 bg-white/70 p-1.5 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/70">
          {steps.map((s, idx) => {
            const on = tab === s.key;
            return (
              <Fragment key={s.key}>
                {idx > 0 && <span className="select-none px-0.5 text-base text-zinc-300 dark:text-zinc-600">›</span>}
                <Link
                  href={s.href}
                  className={`group inline-flex items-center gap-2.5 rounded-xl px-3.5 py-2 transition-all duration-200 ${
                    on
                      ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25"
                      : "text-zinc-500 hover:bg-zinc-100/80 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black transition ${on ? "bg-white/25 text-white ring-2 ring-white/30" : "bg-zinc-200 text-zinc-500 group-hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400"}`}>{s.n}</span>
                  <span className="text-left leading-tight">
                    <span className="block text-sm font-extrabold">{s.label}</span>
                    <span className={`block text-[10px] font-medium ${on ? "text-white/80" : "text-zinc-400 dark:text-zinc-500"}`}>{s.sub}</span>
                  </span>
                </Link>
              </Fragment>
            );
          })}
        </div>

        {/* ປະຫວັດ — ghost */}
        <Link
          href="/movements/receive?tab=history"
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
            tab === "history"
              ? "bg-zinc-900 text-white shadow-md dark:bg-white dark:text-zinc-900"
              : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          }`}
        >
          <ListIcon className="h-4 w-4" />
          ລາຍການຮັບສິນຄ້າ
        </Link>
      </div>

      <Suspense key={`${tab}:${Array.isArray(params.q) ? params.q[0] : params.q ?? ""}:${Array.isArray(params.page) ? params.page[0] : params.page ?? ""}`} fallback={<ListSkeleton />}>
        {tab === "history" ? (
          <ReceiveHistory session={session} params={params} />
        ) : tab === "packing" ? (
          <PackingListTab session={session} params={params} />
        ) : tab === "count" ? (
          <CountSheetList session={session} params={params} />
        ) : tab === "receive" ? (
          <ReceiveClient
            warehouses={warehouses}
            initialSearch={Array.isArray(params.q) ? (params.q[0] ?? "") : (params.q ?? "")}
            initialType={Array.isArray(params.type) ? (params.type[0] ?? "") : (params.type ?? "")}
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

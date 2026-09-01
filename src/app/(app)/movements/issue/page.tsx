import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Hero, Notice, Chip } from "@/components/ui/Card";
import { AlertIcon, ArrowUpIcon, ListIcon, PackageIcon } from "@/components/ui/Icons";
import SourceIssue, { type WarehouseOption } from "./SourceIssue";
import IssueHistory from "./IssueHistory";
import PendingConfirm from "./PendingConfirm";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function IssuePage({
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
  const tab = rawTab === "history" ? "history" : rawTab === "pending" ? "pending" : "issue";

  const warehouses =
    tab !== "history"
      ? accessible === null
        ? await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse
             WHERE COALESCE(status, 1) = 1 ORDER BY code`,
          )
        : await query<WarehouseOption>(
            `SELECT code, name_1 AS name FROM public.ic_warehouse
             WHERE code = ANY($1) ORDER BY code`,
            [accessible],
          )
      : [];

  const steps = [
    { key: "issue", href: "/movements/issue", n: 1, label: "ສ້າງໃບ pick", sub: "ເລືອກ-ຈັດສັນ", icon: <ArrowUpIcon className="h-4 w-4" /> },
    { key: "pending", href: "/movements/issue?tab=pending", n: 2, label: "ຢືນຢັນຈ່າຍ", sub: "forklift·ຍິງ SN", icon: <PackageIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="w-full space-y-5">
      <Hero
        title="ຈ່າຍສິນຄ້າອອກສາງ"
        description="ເບີກ/ຈ່າຍສິນຄ້າອອກຈາກສາງ ຕັດຍອດຄົງເຫຼືອທັນທີ ພ້ອມຫຼັກຖານ (ວັນທີ, ຜູ້ຈ່າຍ, serial)"
        icon={<ArrowUpIcon className="h-6 w-6" />}
        tone="red"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Workflow segmented control: ① ສ້າງ pick → ② ຢືນຢັນຈ່າຍ */}
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
                      ? "bg-gradient-to-r from-red-500 to-orange-600 text-white shadow-md shadow-red-500/25"
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
          href="/movements/issue?tab=history"
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
            tab === "history"
              ? "bg-zinc-900 text-white shadow-md dark:bg-white dark:text-zinc-900"
              : "bg-white text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          }`}
        >
          <ListIcon className="h-4 w-4" />
          ປະຫວັດການຈ່າຍ
        </Link>
      </div>

      {tab === "history" ? (
        <IssueHistory session={session} params={params} />
      ) : tab === "pending" ? (
        <PendingConfirm warehouses={warehouses} />
      ) : (
        <SourceIssue warehouses={warehouses} />
      )}
    </div>
  );
}

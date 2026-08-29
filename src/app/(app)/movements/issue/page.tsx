import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
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
    <div className="w-full space-y-4">
      {/* ແຖບຫົວ — ຊື່ໜ້າ, ຂັ້ນຕອນ ແລະ ປະຫວັດ ຢູ່ແຖວດຽວກັນ.
          ເມື່ອກ່ອນສ່ວນນີ້ກິນສູງເກືອບ 200px (ບັດ Hero + ແຖວ step ຕ່າງຫາກ)
          ກ່ອນຈະເຫັນເອກະສານໃບທຳອິດ. ໜ້ານີ້ຄືໜ້າທີ່ຄົນເປີດຄ້າງໄວ້ທັງມື້
          ພື້ນທີ່ຄວນເປັນຂອງລາຍການ ບໍ່ແມ່ນຂອງຫົວເລື່ອງ. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-950/40 dark:text-red-400 dark:ring-red-900/50">
            <ArrowUpIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-bold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
              ຈ່າຍສິນຄ້າອອກສາງ
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
                {ROLE_LABEL_LO[session.role]}
              </span>
            </h1>
            <p className="hidden truncate text-xs text-zinc-500 xl:block dark:text-zinc-400">
              ເບີກ/ຈ່າຍສິນຄ້າອອກຈາກສາງ ຕັດຍອດຄົງເຫຼືອທັນທີ ພ້ອມຫຼັກຖານ (ວັນທີ, ຜູ້ຈ່າຍ, serial)
            </p>
          </div>
        </div>

        {/* ຂັ້ນຕອນ ① → ② — ຄຳອະທິບາຍຍ່ອຍຢູ່ໃນແຖວດຽວກັນ ບໍ່ຊ້ອນສອງແຖວ */}
        <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200/70 bg-white/70 p-1 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/70">
          {steps.map((s, idx) => {
            const on = tab === s.key;
            return (
              <Fragment key={s.key}>
                {idx > 0 && (
                  <span className="select-none px-0.5 text-sm text-zinc-300 dark:text-zinc-600">›</span>
                )}
                <Link
                  href={s.href}
                  className={`group inline-flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
                    on
                      ? "bg-gradient-to-r from-red-500 to-orange-600 text-white shadow-sm shadow-red-500/25"
                      : "text-zinc-500 hover:bg-zinc-100/80 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black transition ${
                      on
                        ? "bg-white/25 text-white ring-1 ring-white/30"
                        : "bg-zinc-200 text-zinc-500 group-hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {s.n}
                  </span>
                  <span className="text-sm font-bold">{s.label}</span>
                  <span
                    className={`hidden text-[10px] font-medium lg:inline ${
                      on ? "text-white/70" : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    {s.sub}
                  </span>
                </Link>
              </Fragment>
            );
          })}
        </div>

        <Link
          href="/movements/issue?tab=history"
          className={`ml-auto inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${
            tab === "history"
              ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:ring-zinc-800 dark:hover:bg-zinc-800"
          }`}
        >
          <ListIcon className="h-4 w-4" />
          <span className="hidden sm:inline">ປະຫວັດການຈ່າຍ</span>
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

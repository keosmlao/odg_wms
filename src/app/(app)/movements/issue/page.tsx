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
    <div className="w-full space-y-4">
      {/* ໃຊ້ <Hero> ຄືກັບອີກ 51 ໜ້າ ແທນທີ່ຈະຂຽນຫົວໜ້າຂອງໂຕເອງ — ໜ້ານີ້ເຄີຍ
          ມີແຖບຫົວສະເພາະ ຊຶ່ງແປວ່າຖ້າປັບຫົວໜ້າທັງລະບົບ ໜ້ານີ້ຈະຕົກຄ້າງ.
          ຂັ້ນຕອນ ① → ② ແລະ ປະຫວັດ ຢູ່ໃນ `right` ຈຶ່ງອອກມາຢູ່ແຖວດຽວກັນ. */}
      <Hero
        title="ຈ່າຍສິນຄ້າອອກສາງ"
        description="ເບີກ/ຈ່າຍສິນຄ້າອອກຈາກສາງ ຕັດຍອດຄົງເຫຼືອທັນທີ ພ້ອມຫຼັກຖານ (ວັນທີ, ຜູ້ຈ່າຍ, serial)"
        icon={<ArrowUpIcon className="h-5 w-5" />}
        tone="red"
        chips={<Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>}
        right={
          <>
            {/* ຂັ້ນຕອນ ① → ② — ຄຳອະທິບາຍຍ່ອຍໃນແຖວດຽວກັນ ບໍ່ຊ້ອນສອງແຖວ */}
            <div className="inline-flex items-center gap-1 rounded-xl border border-zinc-200/70 bg-white/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/70">
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
                        className={`hidden text-[10px] font-medium 2xl:inline ${
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
              className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition ${
                tab === "history"
                  ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900"
                  : "text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:text-zinc-900 dark:text-zinc-400 dark:ring-zinc-800 dark:hover:bg-zinc-800"
              }`}
            >
              <ListIcon className="h-4 w-4" />
              <span className="hidden lg:inline">ປະຫວັດການຈ່າຍ</span>
            </Link>
          </>
        }
      />

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

import Link from "next/link";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import BootstrapManagerButton from "./BootstrapManagerButton";
import HealthBadges from "./HealthBadges";
import WarehouseCapacity from "@/components/WarehouseCapacity";
import { Hero, KpiCard, Notice, Chip } from "@/components/ui/Card";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BuildingIcon,
  CheckIcon,
  ChevronRightIcon,
  HomeIcon,
  LayersIcon,
  ListIcon,
  PackageIcon,
  SearchIcon,
  ShieldIcon,
  TrendIcon,
} from "@/components/ui/Icons";

type StatRow = {
  total_qty: string;
  movement_count: number;
  warehouse_count: number;
};

function formatQty(value: string | number) {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export default async function Home() {
  const session = await getSession();
  const role = session?.role ?? null;
  const displayName =
    session?.nickname?.trim() ||
    session?.fullname_lo?.trim() ||
    session?.employee_code ||
    null;
  const today = new Date().toISOString().slice(0, 10);

  // Bootstrap is offered only when the current user has no role AND no
  // manager exists in the system yet (one-shot first-run setup).
  let canBootstrap = false;
  if (session && !role) {
    const managers = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM public.wms_user_role WHERE role = 'manager'
       ) AS exists`,
    );
    canBootstrap = !managers[0]?.exists;
  }

  // Today's stats — scoped by warehouse access (null = all, [] = none, [..] = list).
  // A manager with an explicit warehouse list is scoped like anyone else.
  const accessible = accessibleWarehouses(session);
  const accessClause =
    accessible === null
      ? ""
      : accessible.length > 0
        ? `AND wh_code = ANY($2)`
        : `AND FALSE`;
  const accessArgs =
    accessible && accessible.length > 0 ? [accessible] : [];

  const [receiveStats, issueStats] = role
    ? await Promise.all([
        query<StatRow>(
          `SELECT
             COALESCE(SUM(qty * calc_flag), 0)::text AS total_qty,
             count(*)::int AS movement_count,
             count(DISTINCT wh_code)::int AS warehouse_count
           FROM public.odg_wms_trans_detail
           WHERE (status = 0 OR status IS NULL)
             AND calc_flag = 1
             AND doc_date = $1
             ${accessClause}`,
          [today, ...accessArgs],
        ),
        query<StatRow>(
          `SELECT
             COALESCE(SUM(qty * calc_flag), 0)::text AS total_qty,
             count(*)::int AS movement_count,
             count(DISTINCT wh_code)::int AS warehouse_count
           FROM public.odg_wms_trans_detail
           WHERE (status = 0 OR status IS NULL)
             AND calc_flag = -1
             AND doc_date = $1
             ${accessClause}`,
          [today, ...accessArgs],
        ),
      ])
    : [[{ total_qty: "0", movement_count: 0, warehouse_count: 0 }], [{ total_qty: "0", movement_count: 0, warehouse_count: 0 }]];

  const receiveCount = receiveStats[0]?.movement_count ?? 0;
  const issueCount = Math.abs(Number.parseFloat(issueStats[0]?.total_qty ?? "0"));
  const issueRows = issueStats[0]?.movement_count ?? 0;
  const totalWarehouses = accessible === null ? null : accessible.length;

  const scopeText = !role
    ? "—"
    : accessible === null
      ? "ເບິ່ງທຸກສາງ"
      : accessible.length > 0
        ? `${accessible.length} ສາງ ທີ່ຮັບຜິດຊອບ`
        : "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ";

  const menu = [
    {
      label: "ຮັບເຂົ້າ",
      href: "/movements/receive",
      desc: "ການເຄື່ອນໄຫວເຂົ້າຄັງ",
      icon: <ArrowDownIcon className="h-5 w-5" />,
      tone: "emerald" as const,
    },
    {
      label: "ຈ່າຍອອກ",
      href: "/movements/issue",
      desc: "ການເຄື່ອນໄຫວອອກຈາກຄັງ",
      icon: <ArrowUpIcon className="h-5 w-5" />,
      tone: "red" as const,
    },
    {
      label: "ຄົງເຫຼືອ",
      href: "/movements/balance",
      desc: "tree ຄົງເຫຼືອ 4 ລະດັບ",
      icon: <ListIcon className="h-5 w-5" />,
      tone: "blue" as const,
    },
    {
      label: "ຈັດການສິດ",
      href: "/settings/access",
      desc: "role + ສາງຂອງພະນັກງານ",
      icon: <ShieldIcon className="h-5 w-5" />,
      tone: "violet" as const,
      managerOnly: true,
    },
  ];

  return (
    <div className="w-full space-y-6">
      {session && !role && (
        <Notice
          tone="amber"
          icon={<AlertIcon className="h-5 w-5" />}
          title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS"
          description={
            canBootstrap
              ? "ຍັງບໍ່ມີ manager ໃນລະບົບ — ທ່ານສາມາດຕັ້ງຕົນເອງເປັນ manager ຄົນທຳອິດໄດ້."
              : "ກະລຸນາຕິດຕໍ່ຜູ້ຈັດການເພື່ອມອບໝາຍ role (ຜູ້ຈັດການ / Supervisor / ນາຍສາງ) ແລະ ສາງທີ່ຮັບຜິດຊອບ."
          }
          action={canBootstrap ? <BootstrapManagerButton /> : undefined}
        />
      )}

      {session && role && role !== "manager" && session.warehouses.length === 0 && (
        <Notice
          tone="amber"
          icon={<AlertIcon className="h-5 w-5" />}
          title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ"
          description={`role ຂອງທ່ານແມ່ນ ${ROLE_LABEL_LO[role]} ແຕ່ຍັງບໍ່ໄດ້ assign ສາງ — ຕິດຕໍ່ຜູ້ຈັດການ.`}
        />
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        {/* Left side: Main Stats & Capacity */}
        <div className="space-y-6 xl:col-span-3">
          <Hero
            title="ໜ້າຫຼັກ"
            description="ພາບລວມຄັງສິນຄ້າ ແລະ ການເຄື່ອນໄຫວປະຈຳວັນ"
            icon={<HomeIcon className="h-6 w-6" />}
            tone="neutral"
            chips={
              <>
                {role && <Chip tone="primary">{ROLE_LABEL_LO[role]}</Chip>}
                <Chip>
                  <BuildingIcon className="h-3.5 w-3.5" />
                  {scopeText}
                </Chip>
                <Chip>
                  <ListIcon className="h-3.5 w-3.5" />
                  ມື້ນີ້ {today}
                </Chip>
              </>
            }
            right={
              role && (
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                    ການເຄື່ອນໄຫວມື້ນີ້
                  </div>
                  <div className="mt-1 flex items-baseline gap-3">
                    <span className="font-mono text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{formatQty(receiveStats[0]?.total_qty ?? "0")}
                    </span>
                    <span className="text-zinc-400">/</span>
                    <span className="font-mono text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                      −{formatQty(issueCount)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {receiveCount + issueRows} ລາຍການ
                  </div>
                </div>
              )
            }
          />

          {role && (
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard
                icon={<ArrowDownIcon className="h-4 w-4" />}
                label="ຮັບເຂົ້າມື້ນີ້"
                value={formatQty(receiveStats[0]?.total_qty ?? "0")}
                sub={`${receiveCount} ລາຍການ · ${receiveStats[0]?.warehouse_count ?? 0} ສາງ`}
                tone="emerald"
                highlight
              />
              <KpiCard
                icon={<ArrowUpIcon className="h-4 w-4" />}
                label="ຈ່າຍອອກມື້ນີ້"
                value={formatQty(issueCount)}
                sub={`${issueRows} ລາຍການ · ${issueStats[0]?.warehouse_count ?? 0} ສາງ`}
                tone="red"
                highlight
              />
              <KpiCard
                icon={<TrendIcon className="h-4 w-4" />}
                label="ຍອດສຸດທິມື້ນີ້"
                value={formatQty(
                  Number.parseFloat(receiveStats[0]?.total_qty ?? "0") -
                    issueCount,
                )}
                sub="receive − issue"
                tone="blue"
                highlight
              />
              <KpiCard
                icon={<BuildingIcon className="h-4 w-4" />}
                label="ສາງໃນສິດ"
                value={totalWarehouses === null ? "ທຸກສາງ" : String(totalWarehouses)}
                sub={role === "manager" ? "ຜູ້ຈັດການ" : "ຮັບຜິດຊອບ"}
              />
            </section>
          )}

          {session && <WarehouseCapacity session={session} />}

          {role && (
            <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    ບໍລິຫານ & ກວດສອບ
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    ເຄື່ອງມືບໍລິຫານສາງແບບມືອາຊີບ — ຄວາມຖືກຕ້ອງ, ສິນຄ້າຄ້າງ, serial, pallet
                  </p>
                </div>
                <HealthBadges />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "ຄວາມຖືກຕ້ອງ stock", href: "/movements/accuracy", desc: "WMS ທຽບ SML/ERP — % ຄວາມแม่นยำ", icon: <TrendIcon className="h-5 w-5" />, tone: "blue" as const },
                  { label: "ສິນຄ້າຄ້າງ (Aging)", href: "/movements/aging", desc: "dead stock ບໍ່ເຄື່ອນໄຫວ > 90 ມື້", icon: <SearchIcon className="h-5 w-5" />, tone: "amber" as const },
                  { label: "ກວດ SN vs Stock", href: "/movements/sn-check", desc: "serial ທຽບ location — ປັບໃຫ້ຕົງ", icon: <PackageIcon className="h-5 w-5" />, tone: "violet" as const },
                  { label: "ປັບປຸງ stock", href: "/movements/adjust", desc: "ນັບ + ປັບ ISN/serial", icon: <CheckIcon className="h-5 w-5" />, tone: "emerald" as const },
                  { label: "ປະກອບ Pallet", href: "/movements/pallet-load", desc: "ໂຫລດສິນຄ້າເຂົ້າ pallet", icon: <PackageIcon className="h-5 w-5" />, tone: "emerald" as const },
                  { label: "ຍ້າຍ Pallet", href: "/movements/pallet-move", desc: "ຍ້າຍ pallet — ຂ້າມສາງໄດ້", icon: <LayersIcon className="h-5 w-5" />, tone: "blue" as const },
                  { label: "ໃບເກັບສິນຄ້າ (Pick)", href: "/movements/pick", desc: "ສ້າງໃບເກັບ — ຈັດ location walk order", icon: <ListIcon className="h-5 w-5" />, tone: "emerald" as const },
                  { label: "ສິນຄ້າເຄື່ອນໄຫວ", href: "/movements/movers", desc: "fast movers + ແນວໂນ້ມ ເຂົ້າ/ອອກ", icon: <TrendIcon className="h-5 w-5" />, tone: "blue" as const },
                  { label: "ບ່ອນວ່າງ (Putaway)", href: "/movements/putaway", desc: "ຫາ location ວ່າງ ໃສ່ສິນຄ້າ", icon: <BuildingIcon className="h-5 w-5" />, tone: "emerald" as const },
                  { label: "ປະຫວັດ (Audit)", href: "/movements/ledger", desc: "ບັນທຶກລວມທຸກເອກະສານ", icon: <ListIcon className="h-5 w-5" />, tone: "violet" as const },
                  { label: "ພິມ Label/Barcode", href: "/movements/labels", desc: "ປ້າຍ pallet / location ໄປ scan", icon: <PackageIcon className="h-5 w-5" />, tone: "violet" as const },
                ].map((m) => (
                  <Link
                    key={m.href}
                    href={m.href}
                    className="group flex items-center gap-3 rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:ring-1 hover:ring-zinc-200 dark:border-zinc-800/60 dark:bg-zinc-800/20 dark:hover:bg-zinc-900 dark:hover:ring-zinc-800"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${
                        m.tone === "emerald"
                          ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : m.tone === "blue"
                            ? "bg-blue-100/80 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                            : m.tone === "amber"
                              ? "bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                              : "bg-violet-100/80 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                      }`}
                    >
                      {m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-900 transition-colors group-hover:text-indigo-600 dark:text-zinc-50 dark:group-hover:text-indigo-400">
                        {m.label}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {m.desc}
                      </div>
                    </div>
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right side: Sidebar with Shortcuts & Session Info */}
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                ເມນູລັດ
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                ກົດເພື່ອເຂົ້າເບິ່ງລາຍລະອຽດ
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {menu
                .filter((m) => !m.managerOnly || role === "manager")
                .map((m) => (
                  <Link
                    key={m.label}
                    href={m.href}
                    className="group flex items-center gap-3.5 rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.02)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:ring-1 hover:ring-zinc-200 dark:border-zinc-800/60 dark:bg-zinc-800/20 dark:hover:bg-zinc-900 dark:hover:ring-zinc-800"
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${
                        m.tone === "emerald"
                          ? "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : m.tone === "red"
                            ? "bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300"
                            : m.tone === "blue"
                              ? "bg-blue-100/80 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                              : "bg-violet-100/80 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
                      }`}
                    >
                      {m.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-zinc-900 transition-colors group-hover:text-indigo-600 dark:text-zinc-50 dark:group-hover:text-indigo-400">
                        {m.label}
                      </div>
                      <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {m.desc}
                      </div>
                    </div>
                    <ChevronRightIcon className="h-4 w-4 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
                  </Link>
                ))}
            </div>
          </section>

          <div className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-indigo-50 to-violet-50/50 p-5 shadow-sm dark:border-zinc-800/80 dark:from-indigo-950/10 dark:to-zinc-950">
            <div className="absolute -right-6 -bottom-6 h-20 w-20 rounded-full bg-indigo-500/10 blur-xl" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">
              ຂໍ້ມູນຜູ້ໃຊ້ງານ
            </h3>
            <div className="mt-3.5 space-y-3">
              <div>
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                  ຊື່ຜູ້ໃຊ້
                </span>
                <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                  {displayName || "—"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                  ຕຳແໜ່ງ (Role)
                </span>
                <span className="inline-flex items-center rounded-md bg-indigo-100/60 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {role ? ROLE_LABEL_LO[role] : "—"}
                </span>
              </div>
              <div>
                <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">
                  ຂອບເຂດສິດ
                </span>
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {scopeText}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

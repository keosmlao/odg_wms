import Link from "next/link";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import BootstrapManagerButton from "./BootstrapManagerButton";
import HealthBadges from "./HealthBadges";
import WarehouseCapacity from "@/components/WarehouseCapacity";
import { KpiCard, Notice, Chip } from "@/components/ui/Card";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowLeftRightIcon,
  ArrowUpIcon,
  BuildingIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  LayersIcon,
  ListIcon,
  PackageIcon,
  RouteIcon,
  SearchIcon,
  ShieldIcon,
  TrendIcon,
  UsersIcon,
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

/* ── Quick-action card ─────────────────────────────────────────────── */
function QuickActionCard({
  href,
  label,
  desc,
  icon,
  tone,
}: {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  tone: "emerald" | "red" | "navy" | "aqua" | "amber" | "brand";
}) {
  const iconBg: Record<string, string> = {
    emerald:
      "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    red: "bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    navy: "bg-brand-100/80 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
    aqua: "bg-aqua-100/80 text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300",
    amber:
      "bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    brand:
      "bg-brand-100/80 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
  };

  const borderGlow: Record<string, string> = {
    emerald:
      "hover:ring-emerald-200/80 dark:hover:ring-emerald-900/40 hover:shadow-emerald-100/40 dark:hover:shadow-emerald-950/20",
    red: "hover:ring-red-200/80 dark:hover:ring-red-900/40 hover:shadow-red-100/40 dark:hover:shadow-red-950/20",
    navy: "hover:ring-brand-200/80 dark:hover:ring-brand-900/40 hover:shadow-brand-100/40 dark:hover:shadow-brand-950/20",
    aqua: "hover:ring-aqua-200/80 dark:hover:ring-aqua-900/40 hover:shadow-aqua-100/40 dark:hover:shadow-aqua-950/20",
    amber:
      "hover:ring-amber-200/80 dark:hover:ring-amber-900/40 hover:shadow-amber-100/40 dark:hover:shadow-amber-950/20",
    brand:
      "hover:ring-brand-200/80 dark:hover:ring-brand-900/40 hover:shadow-brand-100/40 dark:hover:shadow-brand-950/20",
  };

  return (
    <Link
      href={href}
      className={`group relative flex flex-col items-start gap-3 overflow-hidden rounded-2xl border border-zinc-200/60 bg-white p-5 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:ring-1 dark:border-zinc-800/60 dark:bg-zinc-900 ${borderGlow[tone]}`}
    >
      <div
        className={`flex h-12 w-12 items-center justify-center rounded-xl transition-transform duration-300 group-hover:scale-110 ${iconBg[tone]}`}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-zinc-900 transition-colors group-hover:text-zinc-700 dark:text-zinc-50 dark:group-hover:text-zinc-200">
          {label}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {desc}
        </div>
      </div>
      <ChevronRightIcon className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-300 transition-all duration-300 group-hover:translate-x-1 group-hover:text-zinc-500 dark:text-zinc-700 dark:group-hover:text-zinc-400" />
    </Link>
  );
}

/* ── Tool link item (compact, used inside groups) ──────────────────── */
function ToolLink({
  href,
  label,
  desc,
  icon,
  tone,
}: {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
  tone: "emerald" | "red" | "navy" | "aqua" | "amber" | "brand";
}) {
  const iconBg: Record<string, string> = {
    emerald:
      "bg-emerald-100/80 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
    red: "bg-red-100/80 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    navy: "bg-brand-100/80 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
    aqua: "bg-aqua-100/80 text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300",
    amber:
      "bg-amber-100/80 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300",
    brand:
      "bg-brand-100/80 text-brand-700 dark:bg-brand-950/60 dark:text-brand-300",
  };

  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-zinc-200/60 bg-zinc-50/50 p-3 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-md hover:ring-1 hover:ring-zinc-200 dark:border-zinc-800/60 dark:bg-zinc-800/20 dark:hover:bg-zinc-900 dark:hover:ring-zinc-800"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${iconBg[tone]}`}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-zinc-900 transition-colors group-hover:text-brand-600 dark:text-zinc-50 dark:group-hover:text-brand-400">
          {label}
        </div>
        <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
          {desc}
        </div>
      </div>
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
    </Link>
  );
}

/* ── Section header with coloured accent ───────────────────────────── */
function SectionHeader({
  title,
  desc,
  tone,
}: {
  title: string;
  desc: string;
  tone: "navy" | "emerald" | "aqua";
}) {
  const dot: Record<string, string> = {
    navy: "bg-brand-500",
    emerald: "bg-emerald-500",
    aqua: "bg-aqua-500",
  };
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[tone]}`}
      />
      <div>
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
          {title}
        </h3>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{desc}</p>
      </div>
    </div>
  );
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

  const hour = new Date().getHours();
  let greeting = "ສະບາຍດີ";
  if (hour >= 5 && hour < 12) greeting = "ສະບາຍດີຕອນເຊົ້າ";
  else if (hour >= 12 && hour < 17) greeting = "ສະບາຍດີຕອນແລງ";
  else greeting = "ສະບາຍດີຕອນຄ່ຳ";

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

  const netToday =
    Number.parseFloat(receiveStats[0]?.total_qty ?? "0") - issueCount;

  return (
    <div className="w-full space-y-6">
      {/* ── Notices ──────────────────────────────────────────────── */}
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
        {/* ── LEFT: main content ──────────────────────────────────── */}
        <div className="space-y-6 xl:col-span-3">
          {/* Welcome Banner */}
          <div className="shadow-card relative overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="pointer-events-none absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-brand-500/10 via-aqua-500/8 to-sunset-500/5 blur-3xl dark:from-brand-500/15 dark:via-aqua-500/10 dark:to-sunset-500/8" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-gradient-to-tr from-aqua-400/8 to-transparent blur-2xl dark:from-aqua-400/12" />
            <div className="relative p-7">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    {greeting}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                    {displayName || "ຜູ້ໃຊ້ງານ"}
                  </h1>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    ພາບລວມຄັງສິນຄ້າ ແລະ ການເຄື່ອນໄຫວປະຈຳວັນ
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
                    {role && (
                      <Chip tone="primary">{ROLE_LABEL_LO[role]}</Chip>
                    )}
                    <Chip>
                      <BuildingIcon className="h-3.5 w-3.5" />
                      {scopeText}
                    </Chip>
                    <Chip>
                      <ListIcon className="h-3.5 w-3.5" />
                      ມື້ນີ້ {today}
                    </Chip>
                  </div>
                </div>

                {role && (
                  <div className="text-right">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      ການເຄື່ອນໄຫວມື້ນີ້
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-3">
                      <span className="font-mono text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        +{formatQty(receiveStats[0]?.total_qty ?? "0")}
                      </span>
                      <span className="text-xl text-zinc-300 dark:text-zinc-600">/</span>
                      <span className="font-mono text-3xl font-bold tabular-nums text-red-600 dark:text-red-400">
                        −{formatQty(issueCount)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {receiveCount + issueRows} ລາຍການ · ສຸດທິ{" "}
                      <span className={`font-semibold ${netToday >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                        {netToday >= 0 ? "+" : ""}{formatQty(netToday)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* KPI Cards */}
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
                value={formatQty(netToday)}
                sub="receive − issue"
                tone="navy"
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

          {/* Quick Actions */}
          {role && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  ການກະທຳດ່ວນ
                </h2>
                <HealthBadges />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <QuickActionCard
                  href="/movements/receive"
                  label="ຮັບສິນຄ້າ"
                  desc="ການເຄື່ອນໄຫວເຂົ້າຄັງ"
                  icon={<ArrowDownIcon className="h-6 w-6" />}
                  tone="emerald"
                />
                <QuickActionCard
                  href="/movements/issue"
                  label="ຈ່າຍສິນຄ້າ"
                  desc="ການເຄື່ອນໄຫວອອກຈາກຄັງ"
                  icon={<ArrowUpIcon className="h-6 w-6" />}
                  tone="red"
                />
                <QuickActionCard
                  href="/movements/balance"
                  label="ຄົງເຫຼືອ"
                  desc="tree ຄົງເຫຼືອ 4 ລະດັບ"
                  icon={<ListIcon className="h-6 w-6" />}
                  tone="navy"
                />
                <QuickActionCard
                  href="/movements/transfer-dashboard"
                  label="ໂອນສາງ"
                  desc="ການໂອນຍ້າຍລະຫວ່າງສາງ"
                  icon={<ArrowLeftRightIcon className="h-6 w-6" />}
                  tone="aqua"
                />
                <QuickActionCard
                  href="/movements/adjust"
                  label="ປັບປຸງ stock"
                  desc="ນັບ + ປັບ ISN/serial"
                  icon={<CheckIcon className="h-6 w-6" />}
                  tone="amber"
                />
                <QuickActionCard
                  href="/stocktake"
                  label="ກວດນັບສິນຄ້າ"
                  desc="ຮອບກວດນັບ & ສ້າງໃໝ່"
                  icon={<PackageIcon className="h-6 w-6" />}
                  tone="brand"
                />
              </div>
            </section>
          )}

          {/* Grouped Tools */}
          {role && (
            <section className="space-y-5">
              {/* Inventory Control */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                <SectionHeader
                  title="ຄວບຄຸມສິນຄ້າຄົງເຫຼືອ"
                  desc="ຄວາມຖືກຕ້ອງ, ສິນຄ້າຄ້າງ, serial, ການປັບປຸງ"
                  tone="navy"
                />
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ToolLink
                    href="/movements/accuracy"
                    label="ຄວາມຖືກຕ້ອງ stock"
                    desc="WMS ທຽບ SML/ERP — % ຄວາມແມ່ນຍຳ"
                    icon={<TrendIcon className="h-5 w-5" />}
                    tone="navy"
                  />
                  <ToolLink
                    href="/movements/pending-out"
                    label="ຄ້າງຈ່າຍອອກສາງ"
                    desc="ໃບເບີກ/ໂອນ/ຂາຍ ທີ່ຈ່າຍອອກບໍ່ຄົບ"
                    icon={<ArrowUpIcon className="h-5 w-5" />}
                    tone="amber"
                  />
                  <ToolLink
                    href="/movements/aging"
                    label="ສິນຄ້າຄ້າງ (Aging)"
                    desc="dead stock ບໍ່ເຄື່ອນໄຫວ > 90 ມື້"
                    icon={<SearchIcon className="h-5 w-5" />}
                    tone="amber"
                  />
                  <ToolLink
                    href="/movements/min-stock"
                    label="stock ຂັ້ນຕ່ຳ / ຂັ້ນສູງ"
                    desc="ຕ່ຳກວ່າຂັ້ນຕ່ຳ = ຕ້ອງເຕີມ · ເກີນຂັ້ນສູງ = ຄ້າງ"
                    icon={<AlertIcon className="h-5 w-5" />}
                    tone="red"
                  />
                  <ToolLink
                    href="/movements/sn-check"
                    label="ກວດ SN vs Stock"
                    desc="serial ທຽບ location — ປັບໃຫ້ຕົງ"
                    icon={<PackageIcon className="h-5 w-5" />}
                    tone="aqua"
                  />
                  <ToolLink
                    href="/movements/adjust"
                    label="ປັບປຸງ stock"
                    desc="ນັບ + ປັບ ISN/serial"
                    icon={<CheckIcon className="h-5 w-5" />}
                    tone="emerald"
                  />
                </div>
              </div>

              {/* Movement & Logistics */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                <SectionHeader
                  title="ການເຄື່ອນໄຫວ & ໂລຈິສຕິກ"
                  desc="pallet, ໃບເກັບ, ບ່ອນຈັດເກັບ, ແນວໂນ້ມ"
                  tone="emerald"
                />
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ToolLink
                    href="/movements/pallet-load"
                    label="ປະກອບ Pallet"
                    desc="ໂຫລດສິນຄ້າເຂົ້າ pallet"
                    icon={<PackageIcon className="h-5 w-5" />}
                    tone="emerald"
                  />
                  <ToolLink
                    href="/movements/pallet-move"
                    label="ຍ້າຍ Pallet"
                    desc="ຍ້າຍ pallet — ຂ້າມສາງໄດ້"
                    icon={<LayersIcon className="h-5 w-5" />}
                    tone="navy"
                  />
                  <ToolLink
                    href="/movements/pick"
                    label="ໃບເກັບສິນຄ້າ (Pick)"
                    desc="ສ້າງໃບເກັບ — ຈັດ location walk order"
                    icon={<ListIcon className="h-5 w-5" />}
                    tone="emerald"
                  />
                  <ToolLink
                    href="/movements/putaway"
                    label="ບ່ອນວ່າງ (Putaway)"
                    desc="ຫາ location ວ່າງ ໃສ່ສິນຄ້າ"
                    icon={<BuildingIcon className="h-5 w-5" />}
                    tone="emerald"
                  />
                  <ToolLink
                    href="/movements/movers"
                    label="ສິນຄ້າເຄື່ອນໄຫວ"
                    desc="fast movers + ແນວໂນ້ມ ເຂົ້າ/ອອກ"
                    icon={<TrendIcon className="h-5 w-5" />}
                    tone="navy"
                  />
                </div>
              </div>

              {/* Audit & Print */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                <SectionHeader
                  title="ກວດສອບ & ພິມ"
                  desc="ບັນທຶກ, ລາຍງານ, ປ້າຍຕິດສິນຄ້າ"
                  tone="aqua"
                />
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ToolLink
                    href="/movements/daily"
                    label="ເຄື່ອນໄຫວປະຈຳວັນ"
                    desc="ຍອດຍົກມາ · ເປີດບິນ · ຮັບ/ຈ່າຍ · ຍົກໄປ"
                    icon={<TrendIcon className="h-5 w-5" />}
                    tone="navy"
                  />
                  <ToolLink
                    href="/movements/ledger"
                    label="ປະຫວັດ (Audit)"
                    desc="ບັນທຶກລວມທຸກເອກະສານ"
                    icon={<ListIcon className="h-5 w-5" />}
                    tone="aqua"
                  />
                  <ToolLink
                    href="/movements/labels"
                    label="ພິມ Label/Barcode"
                    desc="ປ້າຍ pallet / location ໄປ scan"
                    icon={<PackageIcon className="h-5 w-5" />}
                    tone="aqua"
                  />
                </div>
              </div>

              {/* ຄູ່ມືການເຮັດວຽກ */}
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800/80 dark:bg-zinc-900">
                <SectionHeader
                  title="ຄູ່ມືການເຮັດວຽກ"
                  desc="ຂະບວນການ, SOP, ວິທີເຮັດ, ແບບຟອມ ແລະ ໜ້າທີ່ຂອງແຕ່ລະຄົນ"
                  tone="navy"
                />
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <ToolLink
                    href="/manual/workflow"
                    label="ຂະບວນການ (Workflow)"
                    desc="ຮັບ · ຈັດເກັບ · ຈ່າຍ · ໂອນ · ນັບ ຕັ້ງແຕ່ຕົ້ນຈົນຈົບ"
                    icon={<RouteIcon className="h-5 w-5" />}
                    tone="brand"
                  />
                  <ToolLink
                    href="/manual/sop"
                    label="SOP & ວິທີເຮັດ (WI)"
                    desc="ລະບຽບປະຕິບັດງານ + ຂັ້ນຕອນກົດໃນລະບົບ"
                    icon={<ClipboardIcon className="h-5 w-5" />}
                    tone="emerald"
                  />
                  <ToolLink
                    href="/manual/roles"
                    label="ໜ້າທີ່ແຕ່ລະຄົນ"
                    desc="ໜ້າວຽກປະຈຳ · ອຳນາດ · ຂໍ້ຫ້າມ · RACI"
                    icon={<UsersIcon className="h-5 w-5" />}
                    tone="red"
                  />
                </div>
              </div>
            </section>
          )}

          {/* Settings shortcut for manager */}
          {role === "manager" && (
            <Link
              href="/settings/access"
              className="group flex items-center gap-3.5 rounded-2xl border border-zinc-200/60 bg-white p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-1 hover:ring-zinc-200 dark:border-zinc-800/60 dark:bg-zinc-900 dark:hover:ring-zinc-800"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-aqua-100/80 text-aqua-700 dark:bg-aqua-950/60 dark:text-aqua-300">
                <ShieldIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  ຈັດການສິດ
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  role + ສາງຂອງພະນັກງານ
                </div>
              </div>
              <ChevronRightIcon className="h-4 w-4 text-zinc-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
            </Link>
          )}
        </div>

        {/* ── RIGHT: sidebar ──────────────────────────────────────── */}
        <div className="space-y-6">
          {/* User Info */}
          <div className="relative overflow-hidden rounded-2xl border border-zinc-200/80 bg-gradient-to-br from-brand-50 to-aqua-50/50 p-5 shadow-sm dark:border-zinc-800/80 dark:from-brand-950/10 dark:to-zinc-950">
            <div className="absolute -right-6 -bottom-6 h-20 w-20 rounded-full bg-brand-500/10 blur-xl" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-brand-700 dark:text-brand-400">
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
                <span className="inline-flex items-center rounded-md bg-brand-100/60 px-2 py-0.5 text-xs font-semibold text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
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

          {/* Warehouse Capacity */}
          {session && <WarehouseCapacity session={session} />}
        </div>
      </div>
    </div>
  );
}

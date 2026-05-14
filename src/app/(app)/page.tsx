import Link from "next/link";
import { getSession } from "@/lib/session";
import { query } from "@/lib/db";
import { ROLE_LABEL_LO } from "@/lib/session-shared";
import BootstrapManagerButton from "./BootstrapManagerButton";
import { Hero, KpiCard, Notice, Chip } from "@/components/ui/Card";
import {
  AlertIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BuildingIcon,
  ChevronRightIcon,
  HomeIcon,
  ListIcon,
  PackageIcon,
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

  // Today's stats — scoped by role
  const accessClause = role && role !== "manager" && session
    ? session.warehouses.length > 0
      ? `AND wh_code = ANY($2)`
      : `AND FALSE`
    : "";
  const accessArgs =
    role && role !== "manager" && session && session.warehouses.length > 0
      ? [session.warehouses]
      : [];

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
  const totalWarehouses =
    role === "manager"
      ? null
      : (session?.warehouses.length ?? 0);

  const scopeText =
    role === "manager"
      ? "ເບິ່ງທຸກສາງ"
      : role
        ? session && session.warehouses.length > 0
          ? `${session.warehouses.length} ສາງ ທີ່ຮັບຜິດຊອບ`
          : "ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ"
        : "—";

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
    <div className="mx-auto w-full max-w-7xl space-y-5">
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

      {role && (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            ເມນູລັດ
          </h2>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            ກົດເພື່ອເຂົ້າເບິ່ງລາຍລະອຽດ
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {menu
            .filter((m) => !m.managerOnly || role === "manager")
            .map((m) => (
              <Link
                key={m.label}
                href={m.href}
                className="group relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      m.tone === "emerald"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                        : m.tone === "red"
                          ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          : m.tone === "blue"
                            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                            : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                    }`}
                  >
                    {m.icon}
                  </span>
                  <ChevronRightIcon className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-1 group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
                </div>
                <div className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {m.label}
                </div>
                <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {m.desc}
                </div>
              </Link>
            ))}
        </div>
      </section>

      <section>
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <PackageIcon className="mx-auto h-10 w-10 text-zinc-400" />
          <div className="mt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-200">
            ສະຫຼຸບເພີ່ມເຕີມຈະຖືກເພີ່ມໃນອະນາຄົດ
          </div>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500 dark:text-zinc-400">
            ຕົວຢ່າງ: graph ການເຄື່ອນໄຫວ 7 ມື້ຍ້ອນຫຼັງ, ສິນຄ້າທີ່ມີ stock ຕິດລົບ,
            top 10 ສິນຄ້າທີ່ເຄື່ອນໄຫວສູງສຸດ
          </p>
        </div>
      </section>
    </div>
  );
}

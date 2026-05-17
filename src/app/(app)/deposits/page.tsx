import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  ChevronRightIcon,
  PackageIcon,
  PlusIcon,
} from "@/components/ui/Icons";
import {
  calculateFee,
  formatMoney,
  type DepositStatus,
} from "@/lib/deposit";

type Row = {
  deposit_id: number;
  deposit_code: string;
  wh_code: string;
  wh_name: string | null;
  cust_code: string | null;
  cust_name: string | null;
  start_date: string;
  end_date: string | null;
  status: DepositStatus;
  free_days_max: number;
  tier1_days_max: number;
  tier1_pct: string;
  tier2_days_max: number;
  tier2_pct: string;
  tier3_days_max: number;
  tier3_pct: string;
  tier4_pct: string;
  min_charge: string;
  max_charge: string;
  currency: string;
  total_items: number;
  total_qty: string;
  total_value: string;
  bill_count: number;
  settled_fee: string | null;
  settled_days: number | null;
  created_at: string;
  created_employee: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;
type StatusKey = DepositStatus;

function pick(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

const STATUS_TABS: Array<{
  value: "" | StatusKey;
  label: string;
  dot: string;
  pillActive: string;
  pill: string;
  accentBar: string;
  chip: string;
}> = [
  {
    value: "",
    label: "ທັງໝົດ",
    dot: "bg-zinc-400",
    pillActive:
      "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900",
    pill:
      "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
    accentBar: "bg-zinc-300",
    chip:
      "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-300 dark:ring-zinc-700",
  },
  {
    value: "active",
    label: "ກຳລັງຝາກ",
    dot: "bg-indigo-500",
    pillActive: "border-indigo-500 bg-indigo-500 text-white shadow-sm",
    pill:
      "border-zinc-200 text-zinc-700 hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-indigo-950/30",
    accentBar: "bg-indigo-500",
    chip:
      "bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900/50",
  },
  {
    value: "settled",
    label: "ສຳເລັດ",
    dot: "bg-emerald-500",
    pillActive: "border-emerald-500 bg-emerald-500 text-white shadow-sm",
    pill:
      "border-zinc-200 text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-emerald-950/30",
    accentBar: "bg-emerald-500",
    chip:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
  },
  {
    value: "cancelled",
    label: "ຍົກເລີກ",
    dot: "bg-zinc-400",
    pillActive: "border-zinc-600 bg-zinc-600 text-white shadow-sm",
    pill:
      "border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400",
    accentBar: "bg-zinc-300",
    chip:
      "bg-zinc-100 text-zinc-500 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-400",
  },
];

export default async function DepositsListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ບໍ່ມີສິດເຂົ້າເຖິງ WMS
        </p>
      </div>
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ
        </p>
      </div>
    );
  }

  const params = await searchParams;
  const status = pick(params.status);
  const q = pick(params.q).toLowerCase();

  const args: unknown[] = [];
  const where: string[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`d.wh_code = ANY($${args.length})`);
  }
  if (status === "active" || status === "settled" || status === "cancelled") {
    args.push(status);
    where.push(`d.status = $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, statusCounts] = await Promise.all([
    query<Row>(
      `SELECT
         d.deposit_id, d.deposit_code, d.wh_code,
         w.name_1 AS wh_name,
         d.cust_code, d.cust_name,
         d.start_date::text AS start_date,
         d.end_date::text   AS end_date,
         d.status,
         d.free_days_max,
         d.tier1_days_max, d.tier1_pct::text AS tier1_pct,
         d.tier2_days_max, d.tier2_pct::text AS tier2_pct,
         d.tier3_days_max, d.tier3_pct::text AS tier3_pct,
         d.tier4_pct::text AS tier4_pct,
         d.min_charge::text AS min_charge,
         d.max_charge::text AS max_charge,
         d.currency,
         d.total_items,
         d.total_qty::text   AS total_qty,
         d.total_value::text AS total_value,
         (SELECT count(*)::int FROM public.wms_deposit_bill b WHERE b.deposit_id = d.deposit_id) AS bill_count,
         d.settled_fee::text AS settled_fee,
         d.settled_days,
         d.created_at::text  AS created_at,
         e.fullname_lo       AS created_employee
       FROM public.wms_deposit d
       LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_id = d.created_by
       ${whereSql}
       ORDER BY d.start_date DESC, d.deposit_id DESC
       LIMIT 200`,
      args,
    ),
    query<{ status: string; n: number }>(
      `SELECT d.status, count(*)::int AS n
       FROM public.wms_deposit d
       ${Array.isArray(accessible) ? "WHERE d.wh_code = ANY($1)" : ""}
       GROUP BY d.status`,
      Array.isArray(accessible) ? [accessible] : [],
    ),
  ]);

  const countByStatus = new Map(statusCounts.map((s) => [s.status, s.n]));
  const totalCount = statusCounts.reduce((s, r) => s + r.n, 0);

  const filteredRows = q
    ? rows.filter((r) => {
        const hay =
          `${r.deposit_code} ${r.cust_code ?? ""} ${r.cust_name ?? ""} ${r.wh_code} ${r.wh_name ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
    : rows;

  function tabHref(value: string) {
    const sp = new URLSearchParams();
    if (value) sp.set("status", value);
    if (q) sp.set("q", q);
    return sp.toString() ? `/deposits?${sp.toString()}` : "/deposits";
  }

  return (
    <div className="mx-auto w-full max-w-7xl">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            WMS · ຮັບຝາກເຄື່ອງ
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
            ລາຍການຮັບຝາກ
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            ທັງໝົດ{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {totalCount.toLocaleString("en-US")}
            </span>{" "}
            ຮັບຝາກ
          </p>
        </div>
        <Link
          href="/deposits/new"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          <PlusIcon className="h-4 w-4" />
          ຮັບຝາກໃໝ່
        </Link>
      </header>

      {/* Filter pills */}
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-zinc-200/70 bg-white/90 p-3 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800/70 dark:bg-zinc-900/80">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_TABS.map((t) => {
            const active = status === t.value;
            const n =
              t.value === "" ? totalCount : (countByStatus.get(t.value) ?? 0);
            return (
              <Link
                key={t.value}
                href={tabHref(t.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  active ? t.pillActive : t.pill
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${active ? "bg-current opacity-70" : t.dot}`}
                />
                {t.label}
                <span
                  className={`tabular-nums ${active ? "opacity-80" : "text-zinc-400"}`}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>
        <form method="get" className="flex items-center gap-2">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ຄົ້ນຫາ code, ລູກຄ້າ, ສາງ..."
            className="rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-56 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          />
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
          >
            ໃຊ້
          </button>
        </form>
      </div>

      {filteredRows.length === 0 ? (
        <EmptyState hasFilter={!!q || !!status} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 dark:border-zinc-800/70 dark:bg-zinc-900/80">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200/70 bg-zinc-50/60 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                <tr>
                  <th className="w-1 px-0" aria-hidden="true" />
                  <th className="px-4 py-3 text-left">ຮັບຝາກ</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    ສາງ
                  </th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">
                    ລູກຄ້າ
                  </th>
                  <th className="px-4 py-3 text-left">ສະຖານະ</th>
                  <th className="px-4 py-3 text-left">ໄລຍະ</th>
                  <th className="px-4 py-3 text-right">ຄ່າຝາກ</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    ສ້າງ
                  </th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredRows.map((r) => {
                  const cfg =
                    STATUS_TABS.find((t) => t.value === r.status) ??
                    STATUS_TABS[0];
                  const calc =
                    r.status === "active"
                      ? calculateFee({
                          start_date: r.start_date,
                          free_days_max: r.free_days_max,
                          tier1_days_max: r.tier1_days_max,
                          tier1_pct: r.tier1_pct,
                          tier2_days_max: r.tier2_days_max,
                          tier2_pct: r.tier2_pct,
                          tier3_days_max: r.tier3_days_max,
                          tier3_pct: r.tier3_pct,
                          tier4_pct: r.tier4_pct,
                          min_charge: r.min_charge,
                          max_charge: r.max_charge,
                          total_value: r.total_value,
                        })
                      : null;
                  const settled =
                    r.settled_fee !== null
                      ? Number.parseFloat(r.settled_fee)
                      : null;
                  return (
                    <tr
                      key={r.deposit_id}
                      className="group relative transition hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                    >
                      <td className="relative w-1 p-0">
                        <span
                          aria-hidden="true"
                          className={`absolute inset-y-0 left-0 w-[3px] ${cfg.accentBar}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/deposits/${r.deposit_id}`}
                          className="block"
                        >
                          <div className="font-mono font-semibold text-zinc-900 group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
                            {r.deposit_code}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                            {r.bill_count} ບິນ · {r.total_items} ສິນຄ້າ
                          </div>
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-zinc-700 md:table-cell dark:text-zinc-300">
                        <div className="font-medium">{r.wh_code}</div>
                        {r.wh_name && (
                          <div className="max-w-[140px] truncate text-[11px] text-zinc-500">
                            {r.wh_name}
                          </div>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <div className="text-sm text-zinc-700 dark:text-zinc-300">
                          {r.cust_name ?? r.cust_code ?? "—"}
                        </div>
                        {r.cust_code && r.cust_name && (
                          <div className="text-[11px] text-zinc-500">
                            {r.cust_code}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cfg.chip}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}
                          />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-700 dark:text-zinc-300">
                        <div>
                          {r.start_date}
                          {r.end_date && ` → ${r.end_date}`}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {r.settled_days ?? calc?.duration_days ?? "—"} ມື້
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-white">
                          {settled !== null
                            ? formatMoney(settled, r.currency)
                            : calc
                              ? formatMoney(calc.fee, r.currency)
                              : "—"}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {r.status === "active"
                            ? `ມູນຄ່າ ${formatMoney(r.total_value, r.currency)}`
                            : `ມູນຄ່າ ${formatMoney(r.total_value, r.currency)}`}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-zinc-500 md:table-cell">
                        <div>{r.created_at?.slice(0, 10)}</div>
                        {r.created_employee && (
                          <div className="max-w-[120px] truncate text-[10px]">
                            {r.created_employee}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <Link
                          href={`/deposits/${r.deposit_id}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-indigo-100 hover:text-indigo-600 group-hover:text-zinc-500 dark:text-zinc-600"
                          aria-label="open"
                        >
                          <ChevronRightIcon className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-zinc-200/70 bg-white/90 px-6 py-16 text-center dark:border-zinc-800/70 dark:bg-zinc-900/80">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <PackageIcon className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {hasFilter ? "ບໍ່ພົບລາຍການຮັບຝາກ" : "ຍັງບໍ່ມີລາຍການຮັບຝາກ"}
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        {hasFilter
          ? "ລອງປ່ຽນເງື່ອນໄຂການກອງ"
          : "ກົດ ‘ຮັບຝາກໃໝ່’ ເພື່ອເລີ່ມຕົ້ນ"}
      </p>
    </div>
  );
}

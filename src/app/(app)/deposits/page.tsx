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
  AGING_TONE,
  calculateFee,
  depositAging,
  formatDate,
  formatMoney,
  type DepositStatus,
} from "@/lib/deposit";
import {
  agingSummary,
  buildDepositListQuery,
  type AgingFilter,
  type DepositListRow,
} from "@/lib/deposit-server";

type SearchParams = Record<string, string | string[] | undefined>;
type StatusKey = DepositStatus;

const ROW_LIMIT = 500;

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

/** Aging quick-filters — everything past the free period is a red state. */
const AGING_TABS: Array<{ value: AgingFilter; label: string; hint: string }> = [
  { value: "over", label: "ເກີນໄລຍະຟຣີ", hint: "ຝາກເກີນມື້ຟຣີແລ້ວ" },
  { value: "soon", label: "ໃກ້ຂ້າມຂັ້ນ", hint: "ອີກ 1-2 ມື້ ອັດຕາຈະຂຶ້ນ" },
  { value: "tier3", label: "ດົນຫຼາຍ", hint: "ເກີນຂັ້ນ 2" },
  { value: "tier4", label: "ຄ້າງດົນເກີນ", hint: "ເກີນຂັ້ນ 3" },
];

function asAging(value: string): AgingFilter {
  return value === "over" ||
    value === "soon" ||
    value === "tier2" ||
    value === "tier3" ||
    value === "tier4"
    ? value
    : "";
}

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
  const q = pick(params.q);
  const aging = asAging(pick(params.aging));
  const from = pick(params.from);
  const to = pick(params.to);

  const listQuery = buildDepositListQuery(
    { status, q, aging, from, to },
    accessible,
    ROW_LIMIT,
  );

  const [rows, statusCounts, aging_] = await Promise.all([
    query<DepositListRow>(listQuery.sql, listQuery.args),
    query<{ status: string; n: number }>(
      `SELECT d.status, count(*)::int AS n
       FROM public.wms_deposit d
       ${Array.isArray(accessible) ? "WHERE d.wh_code = ANY($1)" : ""}
       GROUP BY d.status`,
      Array.isArray(accessible) ? [accessible] : [],
    ),
    agingSummary(accessible),
  ]);

  const countByStatus = new Map(statusCounts.map((s) => [s.status, s.n]));
  const totalCount = statusCounts.reduce((s, r) => s + r.n, 0);

  const agingByLevel = new Map(aging_.map((a) => [a.level, a]));
  const overCount = (["tier1", "tier2", "tier3", "tier4"] as const).reduce(
    (s, lv) => s + (agingByLevel.get(lv)?.n ?? 0),
    0,
  );
  const overValue = (["tier1", "tier2", "tier3", "tier4"] as const).reduce(
    (s, lv) => s + Number.parseFloat(agingByLevel.get(lv)?.value ?? "0"),
    0,
  );
  const overCurrency = rows.find((r) => r.status === "active")?.currency ?? "THB";

  function hrefWith(patch: Record<string, string>) {
    const sp = new URLSearchParams();
    const base: Record<string, string> = { status, q, aging, from, to };
    for (const [k, v] of Object.entries({ ...base, ...patch })) {
      if (v) sp.set(k, v);
    }
    return sp.toString() ? `/deposits?${sp.toString()}` : "/deposits";
  }

  const exportHref = (() => {
    const sp = new URLSearchParams({ format: "csv" });
    for (const [k, v] of Object.entries({ status, q, aging, from, to })) {
      if (v) sp.set(k, v);
    }
    return `/api/deposits/export?${sp.toString()}`;
  })();

  return (
    <div className="w-full">
      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            WMS · ຮັບຝາກເຄື່ອງ
          </p>
          <h1 className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-white">
            ລາຍການຮັບຝາກ
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            ທັງໝົດ{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {totalCount.toLocaleString("en-US")}
            </span>{" "}
            ຮັບຝາກ
            {overCount > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-rose-600 dark:text-rose-400">
                  {overCount} ລາຍການເກີນໄລຍະຟຣີ
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={exportHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Export CSV
          </a>
          <Link
            href="/deposits/new"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-500"
          >
            <PlusIcon className="h-4 w-4" />
            ຮັບຝາກໃໝ່
          </Link>
        </div>
      </header>

      {/* Aging alert strip */}
      {overCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/25">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-rose-600 text-xs font-bold text-white">
              !
            </span>
            <span className="text-sm font-semibold text-rose-800 dark:text-rose-200">
              ຝາກເກີນໄລຍະຟຣີ {overCount} ລາຍການ · ມູນຄ່າ{" "}
              {formatMoney(overValue, overCurrency)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["tier1", "tier2", "tier3", "tier4"] as const).map((lv) => {
              const n = agingByLevel.get(lv)?.n ?? 0;
              if (n === 0) return null;
              const tone = AGING_TONE[lv];
              const target: AgingFilter =
                lv === "tier1"
                  ? "over"
                  : lv === "tier2"
                    ? "tier2"
                    : lv === "tier3"
                      ? "tier3"
                      : "tier4";
              return (
                <Link
                  key={lv}
                  href={hrefWith({ aging: target, status: "active" })}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition hover:brightness-95 ${tone.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                  {
                    { tier1: "ຂັ້ນ 1", tier2: "ຂັ້ນ 2", tier3: "ຂັ້ນ 3", tier4: "ຂັ້ນ 4" }[
                      lv
                    ]
                  }
                  <span className="tabular-nums">{n}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-zinc-200/70 bg-white/90 p-3 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_TABS.map((t) => {
              const active = status === t.value;
              const n =
                t.value === "" ? totalCount : (countByStatus.get(t.value) ?? 0);
              return (
                <Link
                  key={t.value}
                  href={hrefWith({ status: t.value })}
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
          <form
            method="get"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {status && <input type="hidden" name="status" value={status} />}
            {aging && <input type="hidden" name="aging" value={aging} />}
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="ຄົ້ນຫາ code, ລູກຄ້າ, ສາງ..."
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-56 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
            <span className="text-xs text-zinc-400">→</span>
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900"
            >
              ໃຊ້
            </button>
          </form>
        </div>

        {/* Aging pills */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            ອາຍຸການຝາກ
          </span>
          <Link
            href={hrefWith({ aging: "" })}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              aging === ""
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900"
                : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300"
            }`}
          >
            ທັງໝົດ
          </Link>
          {AGING_TABS.map((t) => (
            <Link
              key={t.value}
              href={hrefWith({ aging: t.value })}
              title={t.hint}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                aging === t.value
                  ? "border-rose-600 bg-rose-600 text-white shadow-sm"
                  : "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/30"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState hasFilter={!!q || !!status || !!aging || !!from || !!to} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
          <div className="max-h-[calc(100dvh-250px)] overflow-auto overscroll-contain">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] border-b border-zinc-200/70 bg-zinc-50/95 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-400">
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
                {rows.map((r) => {
                  const cfg =
                    STATUS_TABS.find((t) => t.value === r.status) ??
                    STATUS_TABS[0];
                  const isActive = r.status === "active";
                  const calc = isActive
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
                  const age = isActive ? depositAging(r, r.start_date) : null;
                  const tone = age ? AGING_TONE[age.level] : null;
                  const settled =
                    r.settled_fee !== null
                      ? Number.parseFloat(r.settled_fee)
                      : null;
                  return (
                    <tr
                      key={r.deposit_id}
                      className={`group relative transition ${
                        age?.over
                          ? "bg-rose-50/40 hover:bg-rose-50/80 dark:bg-rose-950/15 dark:hover:bg-rose-950/30"
                          : "hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
                      }`}
                    >
                      <td className="relative w-1 p-0">
                        <span
                          aria-hidden="true"
                          className={`absolute inset-y-0 left-0 w-[3px] ${
                            age?.over ? tone!.bar : cfg.accentBar
                          }`}
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
                          {formatDate(r.start_date)}
                          {r.end_date && ` → ${formatDate(r.end_date)}`}
                        </div>
                        {age ? (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ring-inset ${tone!.chip}`}
                            >
                              {age.days} ມື້
                            </span>
                            {age.soon && (
                              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                                ອີກ {age.daysToNext} ມື້ຂຶ້ນຂັ້ນ
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-[10px] text-zinc-500">
                            {r.settled_days ?? "—"} ມື້
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div
                          className={`font-mono text-sm font-bold tabular-nums ${
                            age?.over
                              ? "text-rose-700 dark:text-rose-300"
                              : "text-zinc-900 dark:text-white"
                          }`}
                        >
                          {settled !== null
                            ? formatMoney(settled, r.currency)
                            : calc
                              ? formatMoney(calc.fee, r.currency)
                              : "—"}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          ມູນຄ່າ {formatMoney(r.total_value, r.currency)}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-zinc-500 md:table-cell">
                        <div>{formatDate(r.created_at)}</div>
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
          {rows.length >= ROW_LIMIT && (
            <p className="border-t border-zinc-100 px-4 py-2 text-[11px] text-amber-700 dark:border-zinc-800 dark:text-amber-400">
              ສະແດງພຽງ {ROW_LIMIT} ລາຍການລ່າສຸດ — ກະລຸນາກອງດ້ວຍວັນທີ ຫຼື ຄົ້ນຫາ
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-zinc-200/70 bg-white/90 px-6 py-16 text-center shadow-sm ring-1 ring-black/[0.02] lg:min-h-[calc(100dvh-265px)] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
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

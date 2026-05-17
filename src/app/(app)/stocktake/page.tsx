import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import {
  AlertIcon,
  ChevronRightIcon,
  LayersIcon,
  PlusIcon,
} from "@/components/ui/Icons";
import StocktakeLayout from "./_components/StocktakeLayout";
import {
  stBtnPrimary,
  stEyebrow,
  stMuted,
  stPanel,
  stPanelPad,
  stTitleLg,
} from "./_components/stocktake-theme";

type Row = {
  session_id: number;
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  name: string | null;
  status: "open" | "pending_approval" | "closed";
  count_date: string;
  created_at: string | null;
  created_employee: string | null;
  label_count: number;
  counted_labels: number;
  line_count: number;
  total_qty: string;
  snapshot_items: number;
  counted_sml_items: number;
  pending_bills: number;
};

type SearchParams = Record<string, string | string[] | undefined>;
type StatusKey = "open" | "pending_approval" | "closed";

function pick(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

type StatusConfig = {
  value: "" | StatusKey;
  label: string;
  dot: string;
  pill: string;
  pillActive: string;
};

const STATUS_TABS: StatusConfig[] = [
  {
    value: "",
    label: "ທັງໝົດ",
    dot: "bg-zinc-400",
    pill: "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
    pillActive:
      "border-zinc-900 bg-zinc-900 text-white shadow-sm dark:border-white dark:bg-white dark:text-zinc-900",
  },
  {
    value: "open",
    label: "ກຳລັງດຳເນີນ",
    dot: "bg-emerald-500",
    pill: "border-zinc-200 text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-emerald-950/30",
    pillActive:
      "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/20",
  },
  {
    value: "pending_approval",
    label: "ລໍຖ້າອະນຸມັດ",
    dot: "bg-amber-500",
    pill: "border-zinc-200 text-zinc-700 hover:border-amber-300 hover:bg-amber-50/50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-amber-950/30",
    pillActive:
      "border-amber-500 bg-amber-500 text-white shadow-sm shadow-amber-500/20",
  },
  {
    value: "closed",
    label: "ປິດແລ້ວ",
    dot: "bg-zinc-400",
    pill: "border-zinc-200 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800",
    pillActive:
      "border-zinc-600 bg-zinc-600 text-white shadow-sm dark:border-zinc-300 dark:bg-zinc-300 dark:text-zinc-900",
  },
];

const ROW_STATUS: Record<
  StatusKey,
  {
    label: string;
    dot: string;
    chip: string;
    accentBar: string;
  }
> = {
  open: {
    label: "ດຳເນີນ",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
    accentBar: "bg-emerald-500",
  },
  pending_approval: {
    label: "ລໍຖ້າອະນຸມັດ",
    dot: "bg-amber-500",
    chip: "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50",
    accentBar: "bg-amber-500",
  },
  closed: {
    label: "ປິດແລ້ວ",
    dot: "bg-zinc-400",
    chip: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-300 dark:ring-zinc-700",
    accentBar: "bg-zinc-300 dark:bg-zinc-600",
  },
};

export default async function StocktakeListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <NoticeCard text="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <NoticeCard text="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const params = await searchParams;
  const status = pick(params.status);
  const wh = pick(params.wh);
  const q = pick(params.q).toLowerCase();

  const args: unknown[] = [];
  const where: string[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`s.wh_code = ANY($${args.length})`);
  }
  if (
    status === "open" ||
    status === "closed" ||
    status === "pending_approval"
  ) {
    args.push(status);
    where.push(`s.status = $${args.length}`);
  }
  if (wh) {
    args.push(wh);
    where.push(`s.wh_code = $${args.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows, whOptions, statusCounts] = await Promise.all([
    query<Row>(
      `SELECT
         s.session_id,
         s.session_code,
         s.wh_code,
         w.name_1 AS wh_name,
         s.name,
         s.status,
         s.count_date::text AS count_date,
         s.created_at::text AS created_at,
         eC.fullname_lo AS created_employee,
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_label l
           WHERE l.session_id = s.session_id
         ), 0)::int AS label_count,
         COALESCE((
           SELECT count(DISTINCT label_id) FROM public.wms_stocktake_line ln
           WHERE ln.session_id = s.session_id
         ), 0)::int AS counted_labels,
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_line ln
           WHERE ln.session_id = s.session_id
         ), 0)::int AS line_count,
         COALESCE((
           SELECT SUM(ln.qty)::text FROM public.wms_stocktake_line ln
           WHERE ln.session_id = s.session_id
         ), '0') AS total_qty,
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_snapshot ss
           WHERE ss.session_id = s.session_id
         ), 0)::int AS snapshot_items,
         COALESCE((
           SELECT count(DISTINCT ln.item_code)
           FROM public.wms_stocktake_line ln
           JOIN public.wms_stocktake_snapshot ss
             ON ss.session_id = ln.session_id
            AND ss.item_code = ln.item_code
           WHERE ln.session_id = s.session_id
         ), 0)::int AS counted_sml_items,
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_pending_bill pb
           WHERE pb.session_id = s.session_id
         ), 0)::int AS pending_bills
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
       LEFT JOIN public.odg_employee eC ON eC.employee_id = s.created_by
       ${whereSql}
       ORDER BY s.count_date DESC, s.session_id DESC
       LIMIT 200`,
      args,
    ),
    Array.isArray(accessible)
      ? query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE code = ANY($1)
           ORDER BY code`,
          [accessible],
        )
      : query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1
           ORDER BY code`,
        ),
    query<{ status: string; n: number }>(
      `SELECT s.status, count(*)::int AS n
       FROM public.wms_stocktake_session s
       ${Array.isArray(accessible) ? "WHERE s.wh_code = ANY($1)" : ""}
       GROUP BY s.status`,
      Array.isArray(accessible) ? [accessible] : [],
    ),
  ]);

  const countByStatus = new Map(statusCounts.map((s) => [s.status, s.n]));
  const totalCount = statusCounts.reduce((s, r) => s + r.n, 0);

  // Client-side text filter on the already-fetched rows
  const filteredRows = q
    ? rows.filter((r) => {
        const hay = `${r.session_code} ${r.name ?? ""} ${r.wh_code} ${r.wh_name ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
    : rows;

  function tabHref(value: string) {
    const sp = new URLSearchParams();
    if (value) sp.set("status", value);
    if (wh) sp.set("wh", wh);
    if (q) sp.set("q", q);
    return sp.toString() ? `/stocktake?${sp.toString()}` : "/stocktake";
  }

  return (
    <StocktakeLayout wide>
      {/* Page header */}
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className={stEyebrow}>WMS · ກວດນັບສິນຄ້າ</p>
          <h1 className={`mt-1.5 ${stTitleLg}`}>ຮອບກວດນັບ</h1>
          <p className={`mt-1 ${stMuted}`}>
            ທັງໝົດ{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              {totalCount.toLocaleString("en-US")}
            </span>{" "}
            ຮອບ
          </p>
        </div>
        <Link href="/stocktake/new" className={stBtnPrimary}>
          <PlusIcon className="h-4 w-4" />
          ສ້າງຮອບໃໝ່
        </Link>
      </header>

      {/* KPI strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_TABS.filter((t) => t.value !== "").map((t) => {
          const n = countByStatus.get(t.value) ?? 0;
          const active = status === t.value;
          return (
            <Link
              key={t.value}
              href={tabHref(t.value)}
              className={`group ${stPanel} flex items-center justify-between px-4 py-3.5 transition hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-600 ${
                active
                  ? "ring-2 ring-indigo-500/40 dark:ring-indigo-400/40"
                  : ""
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${t.dot}`}
                    aria-hidden="true"
                  />
                  <p className="truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    {t.label}
                  </p>
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-900 dark:text-white">
                  {n}
                </p>
              </div>
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-zinc-300 transition group-hover:text-zinc-500 dark:text-zinc-600 dark:group-hover:text-zinc-400" />
            </Link>
          );
        })}
      </div>

      {/* Filter bar */}
      <div
        className={`${stPanel} mb-5 flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-3`}
      >
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
                  aria-hidden="true"
                />
                {t.label}
                <span
                  className={`tabular-nums ${active ? "opacity-80" : "text-zinc-400 dark:text-zinc-500"}`}
                >
                  {n}
                </span>
              </Link>
            );
          })}
        </div>

        <form
          method="get"
          className="flex flex-wrap items-center gap-2 sm:flex-nowrap"
        >
          {status && <input type="hidden" name="status" value={status} />}
          <div className="relative flex-1 sm:flex-none">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="ຄົ້ນຫາ session, ສາງ..."
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 px-3 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-48 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            />
          </div>
          {whOptions.length > 1 && (
            <select
              name="wh"
              defaultValue={wh}
              className="rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
            >
              <option value="">ທຸກສາງ</option>
              {whOptions.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code}
                  {w.name ? ` · ${w.name}` : ""}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            ໃຊ້
          </button>
        </form>
      </div>

      {/* Session table */}
      {filteredRows.length === 0 ? (
        <EmptyState hasSearch={!!q || !!status || !!wh} />
      ) : (
        <div className={`${stPanel} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200/70 bg-zinc-50/60 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40 dark:text-zinc-400">
                <tr>
                  <th className="w-1 px-0" aria-hidden="true" />
                  <th className="px-4 py-3 text-left">Session</th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    ສາງ
                  </th>
                  <th className="px-4 py-3 text-left">ສະຖານະ</th>
                  <th className="px-4 py-3 text-left">ຄວາມຄືບໜ້າ</th>
                  <th className="px-4 py-3 text-right">ຈຳນວນລວມ</th>
                  <th className="hidden px-4 py-3 text-left lg:table-cell">
                    Setup
                  </th>
                  <th className="hidden px-4 py-3 text-left md:table-cell">
                    ສ້າງ
                  </th>
                  <th className="w-10 px-2 py-3" aria-hidden="true" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredRows.map((r) => {
                  const cfg = ROW_STATUS[r.status];
                  const progress =
                    r.snapshot_items === 0
                      ? 0
                      : (r.counted_sml_items / r.snapshot_items) * 100;
                  return (
                    <tr
                      key={r.session_id}
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
                          href={`/stocktake/${r.session_id}`}
                          className="block"
                        >
                          <div className="font-medium text-zinc-900 group-hover:text-indigo-700 dark:text-white dark:group-hover:text-indigo-300">
                            {r.name ?? r.session_code}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            <span>{r.session_code}</span>
                            <span className="text-zinc-300 dark:text-zinc-600 md:hidden">
                              ·
                            </span>
                            <span className="md:hidden">{r.wh_code}</span>
                          </div>
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-zinc-700 md:table-cell dark:text-zinc-300">
                        <div className="font-medium">{r.wh_code}</div>
                        {r.wh_name && (
                          <div className="max-w-[160px] truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                            {r.wh_name}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cfg.chip}`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`}
                            aria-hidden="true"
                          />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="min-w-[140px] px-4 py-3">
                        <div className="flex items-baseline justify-between gap-2 text-[11px]">
                          <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
                            <span className="font-semibold">
                              {r.counted_sml_items}
                            </span>
                            <span className="text-zinc-400">
                              /{r.snapshot_items}
                            </span>{" "}
                            SML
                          </span>
                          <span className="font-mono tabular-nums text-zinc-500 dark:text-zinc-400">
                            {progress.toFixed(0)}%
                          </span>
                        </div>
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div
                            className={`h-full rounded-full ${
                              r.status === "closed"
                                ? "bg-zinc-400 dark:bg-zinc-500"
                                : "bg-gradient-to-r from-emerald-400 to-teal-500"
                            }`}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
                          {r.line_count.toLocaleString("en-US")} ລາຍ
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-zinc-900 dark:text-white">
                        {formatQty(r.total_qty)}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        <div className="flex flex-wrap items-center gap-1">
                          <SetupChip
                            tone={r.snapshot_items > 0 ? "indigo" : "zinc"}
                            label="SML"
                            value={r.snapshot_items.toLocaleString("en-US")}
                          />
                          {r.pending_bills > 0 && (
                            <SetupChip
                              tone="amber"
                              label="ບິນ"
                              value={r.pending_bills.toLocaleString("en-US")}
                            />
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 text-zinc-500 md:table-cell dark:text-zinc-400">
                        <div className="text-zinc-700 dark:text-zinc-300">
                          {r.count_date}
                        </div>
                        {r.created_employee && (
                          <div
                            className="max-w-[120px] truncate text-[11px]"
                            title={r.created_employee}
                          >
                            ໂດຍ {r.created_employee}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right">
                        <Link
                          href={`/stocktake/${r.session_id}`}
                          aria-label={`ເປີດ ${r.session_code}`}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-zinc-300 transition hover:bg-indigo-100 hover:text-indigo-600 group-hover:text-zinc-500 dark:text-zinc-600 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300"
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
          <div className="border-t border-zinc-100 bg-zinc-50/40 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-400">
            ສະແດງ {filteredRows.length.toLocaleString("en-US")} ຮອບ
            {filteredRows.length !== rows.length &&
              ` (ຈາກ ${rows.length.toLocaleString("en-US")})`}
          </div>
        </div>
      )}
    </StocktakeLayout>
  );
}

function SetupChip({
  tone,
  label,
  value,
}: {
  tone: "indigo" | "amber" | "zinc";
  label: string;
  value: string;
}) {
  const toneMap = {
    indigo:
      "bg-indigo-50 text-indigo-700 ring-indigo-200/70 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900/50",
    amber:
      "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50",
    zinc:
      "bg-zinc-50 text-zinc-500 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${toneMap[tone]}`}
    >
      <span className="opacity-70">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </span>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div
      className={`${stPanel} flex flex-col items-center justify-center px-6 py-16 text-center`}
    >
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <LayersIcon className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        {hasSearch ? "ບໍ່ພົບຮອບກວດນັບທີ່ກົງກັບການກອງ" : "ບໍ່ມີຮອບກວດນັບ"}
      </h3>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {hasSearch
          ? "ລອງປ່ຽນເງື່ອນໄຂການກອງ ຫຼື ລ້າງການກອງ"
          : "ກົດປຸ່ມ ‘ສ້າງຮອບໃໝ່’ ເພື່ອເລີ່ມຕົ້ນ"}
      </p>
      {hasSearch && (
        <Link
          href="/stocktake"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          ລ້າງການກອງ
        </Link>
      )}
    </div>
  );
}

function NoticeCard({ text }: { text: string }) {
  return (
    <StocktakeLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div
          className={`${stPanel} w-full max-w-md p-6 text-center text-amber-700 dark:text-amber-200`}
        >
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
            <AlertIcon className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">{text}</p>
        </div>
      </div>
    </StocktakeLayout>
  );
}

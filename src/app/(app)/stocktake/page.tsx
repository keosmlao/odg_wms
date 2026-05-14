import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
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
  label_count: number;
  line_count: number;
  total_qty: string;
};

type SearchParams = Record<string, string | string[] | undefined>;

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

const STATUS_TABS: Array<{ value: string; label: string; icon: string; color: string }> = [
  { value: "", label: "ທັງໝົດ", icon: "📋", color: "from-indigo-500 to-blue-600" },
  { value: "open", label: "ກຳລັງດຳເນີນ", icon: "●", color: "from-emerald-400 to-green-500" },
  { value: "pending_approval", label: "ລໍຖ້າອະນຸມັດ", icon: "●", color: "from-amber-400 to-orange-500" },
  { value: "closed", label: "ປິດແລ້ວ", icon: "●", color: "from-slate-400 to-gray-500" },
];

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
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_label l
           WHERE l.session_id = s.session_id
         ), 0)::int AS label_count,
         COALESCE((
           SELECT count(*) FROM public.wms_stocktake_line ln
           WHERE ln.session_id = s.session_id
         ), 0)::int AS line_count,
         COALESCE((
           SELECT SUM(ln.qty)::text FROM public.wms_stocktake_line ln
           WHERE ln.session_id = s.session_id
         ), '0') AS total_qty
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
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

  function tabHref(value: string) {
    const sp = new URLSearchParams();
    if (value) sp.set("status", value);
    if (wh) sp.set("wh", wh);
    const q = sp.toString();
    return q ? `/stocktake?${q}` : "/stocktake";
  }

  return (
    <StocktakeLayout wide>
      <header className={`${stPanel} ${stPanelPad} mb-6`}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={stEyebrow}>WMS · ກວດນັບສິນຄ້າ</p>
            <h1 className={`mt-2 ${stTitleLg}`}>ຮອບກວດນັບສິນຄ້າ</h1>
            <p className={`mt-1 ${stMuted}`}>
              ທັງໝົດ {totalCount.toLocaleString("en-US")} ຮອບ · ກອງ ແລະ ເລີ່ມນັບໄດ້ທັນທີ
            </p>
          </div>
          <Link href="/stocktake/new" className={stBtnPrimary}>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            ສ້າງຮອບໃໝ່
          </Link>
        </div>
      </header>

      <main>
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {STATUS_TABS.filter(t => t.value !== "").map(t => {
            const n = countByStatus.get(t.value) ?? 0;
            return (
              <Link
                key={t.value}
                href={tabHref(t.value)}
                className={`group relative overflow-hidden rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:shadow-md ${
                  status === t.value
                    ? "border-indigo-400 bg-indigo-50/80 shadow-indigo-100 dark:border-indigo-500 dark:bg-indigo-950/40 dark:shadow-none"
                    : "border-slate-200/80 bg-white/90 dark:border-slate-700 dark:bg-slate-900/80"
                } backdrop-blur-sm`}
              >
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${t.color}`} />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{t.label}</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{n}</p>
                  </div>
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${t.color} text-white text-sm`}>
                    {t.icon}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Toolbar: warehouse filter + view options */}
        <div
          className={`${stPanel} mb-6 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5`}
        >
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_TABS.map((t) => {
              const active = status === t.value;
              const n = t.value === "" ? totalCount : (countByStatus.get(t.value) ?? 0);
              return (
                <Link
                  key={t.value}
                  href={tabHref(t.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    active
                      ? "bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900"
                      : "border border-slate-200/80 bg-white/80 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/40"
                  }`}
                >
                  {t.icon} {t.label}
                  {n > 0 && <span className="opacity-60">{n}</span>}
                </Link>
              );
            })}
          </div>

          {whOptions.length > 1 && (
            <form method="get" className="flex flex-wrap items-center gap-2 text-sm">
              {status && <input type="hidden" name="status" value={status} />}
              <label htmlFor="wh-select" className="sr-only">
                ກອງຕາມສາງ
              </label>
              <select
                id="wh-select"
                name="wh"
                defaultValue={wh}
                className="min-w-[10rem] rounded-xl border border-slate-200 bg-white py-2 pl-3 pr-8 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="">ທຸກສາງ</option>
                {whOptions.map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.code}
                    {w.name ? ` · ${w.name}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                ໃຊ້
              </button>
            </form>
          )}
        </div>

        {/* Session cards grid */}
        {rows.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300/80 bg-white/70 px-6 py-20 text-center backdrop-blur-sm dark:border-slate-600 dark:bg-slate-900/60`}
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-700 dark:text-slate-200">
              ບໍ່ມີຮອບກວດນັບ
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              ກົດ &quot;+ ສ້າງຮອບໃໝ່&quot; ເພື່ອເລີ່ມຕົ້ນ
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {rows.map((r) => {
              const statusConfig = {
                open: {
                  border: "border-l-emerald-500",
                  accent: "from-emerald-500/90 to-teal-600",
                  dot: "bg-emerald-500",
                  label: "ດຳເນີນ",
                  text: "text-emerald-700 dark:text-emerald-300",
                  chip: "bg-emerald-50 dark:bg-emerald-950/50",
                },
                pending_approval: {
                  border: "border-l-amber-500",
                  accent: "from-amber-500/90 to-orange-600",
                  dot: "bg-amber-500",
                  label: "ລໍຖ້າອະນຸມັດ",
                  text: "text-amber-800 dark:text-amber-200",
                  chip: "bg-amber-50 dark:bg-amber-950/40",
                },
                closed: {
                  border: "border-l-slate-400",
                  accent: "from-slate-500 to-slate-600",
                  dot: "bg-slate-400",
                  label: "ປິດແລ້ວ",
                  text: "text-slate-600 dark:text-slate-400",
                  chip: "bg-slate-100 dark:bg-slate-800/80",
                },
              }[r.status];

              return (
                <Link
                  key={r.session_id}
                  href={`/stocktake/${r.session_id}`}
                  className={`group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/85 dark:hover:border-indigo-900 ${statusConfig.border} border-l-[5px] backdrop-blur-sm`}
                >
                  <div
                    className={`pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-90 ${statusConfig.accent}`}
                    aria-hidden
                  />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                        {r.name ?? r.session_code}
                      </h3>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                          {r.session_code}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">·</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {r.wh_code}{r.wh_name ? ` (${r.wh_name})` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        {r.count_date}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ring-black/5 ${statusConfig.text} ${statusConfig.chip} dark:ring-white/10`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${statusConfig.dot}`} />
                      {statusConfig.label}
                    </span>
                  </div>

                  <div className="mt-4 flex items-end justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                    <div className="space-y-0.5">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-medium text-slate-700 dark:text-slate-300">{r.label_count}</span> ປ້າຍ ·{" "}
                        <span className="font-medium text-slate-700 dark:text-slate-300">{r.line_count}</span> ລາຍການ
                      </div>
                      <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatQty(r.total_qty)}
                      </div>
                    </div>
                    <div className="text-slate-300 transition group-hover:text-indigo-600 dark:text-slate-600 dark:group-hover:text-indigo-400">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </StocktakeLayout>
  );
}

function NoticeCard({ text }: { text: string }) {
  return (
    <StocktakeLayout>
      <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-200/90 bg-white/95 p-6 text-center shadow-sm backdrop-blur-md dark:border-amber-900/50 dark:bg-slate-900/90">
        <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
        </svg>
        <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200">{text}</p>
      </div>
      </div>
    </StocktakeLayout>
  );
}
import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

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

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "", label: "ທັງໝົດ" },
  { value: "open", label: "ກຳລັງດຳເນີນ" },
  { value: "pending_approval", label: "ລໍຖ້າອະນຸມັດ" },
  { value: "closed", label: "ປິດແລ້ວ" },
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
    // Counts per status for tab badges (ignores wh filter so tabs stay stable)
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
    <div className="space-y-5 pb-12">
      {/* Hero with gradient */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-6 shadow-lg shadow-indigo-500/20 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-fuchsia-300/15 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-white/75">
              📦 ODG WMS
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-white drop-shadow-sm sm:text-4xl">
              ກວດນັບສິນຄ້າ
            </h1>
            <p className="mt-1.5 text-sm text-white/85">
              {totalCount.toLocaleString("en-US")} ຮອບກວດນັບທັງໝົດ
            </p>
          </div>
          <Link
            href="/stocktake/new"
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-bold text-indigo-700 shadow-lg shadow-indigo-900/10 transition hover:-translate-y-0.5 hover:shadow-xl active:scale-95"
          >
            <span className="text-base leading-none">+</span>
            ສ້າງຮອບໃໝ່
          </Link>
        </div>
      </header>

      {/* Status tabs — pill style */}
      <nav className="flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = status === t.value;
          const n =
            t.value === ""
              ? totalCount
              : (countByStatus.get(t.value) ?? 0);
          const accent = {
            "": "from-indigo-500 to-violet-600 shadow-indigo-500/30",
            open: "from-emerald-500 to-teal-600 shadow-emerald-500/30",
            pending_approval:
              "from-amber-400 to-orange-500 shadow-amber-500/30",
            closed: "from-zinc-500 to-zinc-700 shadow-zinc-500/20",
          }[t.value] ?? "from-zinc-500 to-zinc-700";
          return (
            <Link
              key={t.value || "all"}
              href={tabHref(t.value)}
              className={
                active
                  ? `inline-flex items-center gap-2 rounded-full bg-gradient-to-r ${accent} px-4 py-2 text-sm font-semibold text-white shadow-md`
                  : "inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-900 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800/50"
              }
            >
              {t.label}
              <span
                className={
                  active
                    ? "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-white/25 px-1.5 text-[10px] font-bold"
                    : "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-zinc-100 px-1.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800"
                }
              >
                {n}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Warehouse filter (inline, optional) */}
      {whOptions.length > 1 && (
        <form
          method="get"
          className="flex items-center gap-2 text-sm"
          aria-label="ກອງຕາມສາງ"
        >
          {status && <input type="hidden" name="status" value={status} />}
          <span className="text-zinc-500">ສາງ:</span>
          <select
            name="wh"
            defaultValue={wh}
            className="rounded-lg bg-white px-3 py-1.5 text-sm ring-1 ring-zinc-200 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-900 dark:ring-zinc-800"
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
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
          >
            ໃຊ້
          </button>
        </form>
      )}

      {/* Sessions list */}
      {rows.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-violet-50/30 px-6 py-20 text-center dark:border-indigo-900/40 dark:from-indigo-950/20 dark:to-violet-950/10">
          <div className="text-4xl">📦</div>
          <p className="mt-3 text-base font-semibold text-zinc-800 dark:text-zinc-100">
            ບໍ່ມີຮອບກວດນັບ
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            ກົດ &quot;+ ສ້າງຮອບໃໝ່&quot; ເພື່ອເລີ່ມຕົ້ນ
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => {
            const accent = {
              open: "from-emerald-400 to-teal-500",
              pending_approval: "from-amber-400 to-orange-500",
              closed: "from-zinc-400 to-zinc-500",
            }[r.status];
            return (
            <li key={r.session_id}>
              <Link
                href={`/stocktake/${r.session_id}`}
                className="group relative grid grid-cols-[1fr_auto] gap-3 overflow-hidden rounded-2xl bg-white px-5 py-4 shadow-sm ring-1 ring-zinc-200 transition hover:-translate-y-0.5 hover:shadow-lg hover:ring-zinc-300 active:translate-y-0 dark:bg-zinc-900 dark:ring-zinc-800 dark:hover:ring-zinc-700 sm:grid-cols-[1fr_160px_120px_auto]"
              >
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent}`}
                />
                <div className="min-w-0 pl-2">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                      {r.name ?? r.session_code}
                    </h3>
                    <StatusDot status={r.status} />
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-zinc-500">
                    {r.session_code}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-zinc-500">
                    {r.wh_code}
                    {r.wh_name ? ` · ${r.wh_name}` : ""} · {r.count_date}
                  </div>
                </div>

                <div className="hidden text-right sm:block">
                  <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {r.line_count.toLocaleString("en-US")}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {r.label_count} ປ້າຍ · {r.line_count} ລາຍການ
                  </div>
                </div>

                <div className="hidden text-right sm:block">
                  <div className="font-mono text-sm font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                    {formatQty(r.total_qty)}
                  </div>
                  <div className="text-[10px] text-zinc-500">ຍອດລວມ</div>
                </div>

                <div className="self-center text-zinc-300 transition group-hover:text-zinc-900 dark:text-zinc-700">
                  →
                </div>
              </Link>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusDot({
  status,
}: {
  status: "open" | "pending_approval" | "closed";
}) {
  const config = {
    open: {
      color: "bg-emerald-500",
      label: "ດຳເນີນ",
      pillBg: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    },
    pending_approval: {
      color: "bg-amber-500",
      label: "ລໍຖ້າອະນຸມັດ",
      pillBg: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    },
    closed: {
      color: "bg-zinc-400",
      label: "ປິດແລ້ວ",
      pillBg: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${config.pillBg}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.color}`} />
      {config.label}
    </span>
  );
}

function NoticeCard({ text }: { text: string }) {
  return (
    <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        {text}
      </p>
    </div>
  );
}

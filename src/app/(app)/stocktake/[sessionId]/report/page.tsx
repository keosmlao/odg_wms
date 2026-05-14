import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";

type SessionInfo = {
  session_id: number;
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  name: string | null;
  status: "open" | "pending_approval" | "closed";
  count_date: string;
};

type VarianceRow = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  counted_qty: string;
  sml_qty: string;
  variance: string;
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

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "ທັງໝົດ" },
  { value: "variance", label: "ມີສ່ວນຕ່າງ" },
  { value: "uncounted", label: "ໃນ SML ບໍ່ໄດ້ນັບ" },
  { value: "extra", label: "ນັບໄດ້ ບໍ່ມີໃນ SML" },
];

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return <NoticeCard text="ບໍ່ມີສິດເຂົ້າເຖິງ WMS" tone="amber" />;
  }
  const { sessionId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(sid)) notFound();

  const info = (
    await query<SessionInfo>(
      `SELECT s.session_id, s.session_code, s.wh_code,
              w.name_1 AS wh_name,
              s.name, s.status, s.count_date::text
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w ON w.code = s.wh_code
       WHERE s.session_id = $1`,
      [sid],
    )
  )[0];
  if (!info) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(info.wh_code)) {
    return <NoticeCard text="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້" tone="red" />;
  }

  const sp = await searchParams;
  const filter = pick(sp.filter) || "all";
  const q = pick(sp.q).toLowerCase();

  const rows = await query<VarianceRow>(
    `WITH counted AS (
       SELECT
         item_code,
         MAX(item_name) AS item_name,
         MAX(unit_code) AS unit_code,
         SUM(qty)::numeric AS counted_qty
       FROM public.wms_stocktake_line
       WHERE session_id = $1
       GROUP BY item_code
     )
     SELECT
       COALESCE(c.item_code, ss.item_code)            AS item_code,
       COALESCE(c.item_name, ss.item_name)            AS item_name,
       COALESCE(c.unit_code, ss.unit_code)            AS unit_code,
       COALESCE(c.counted_qty, 0)::text               AS counted_qty,
       COALESCE(ss.snapshot_qty, 0)::text             AS sml_qty,
       (COALESCE(c.counted_qty, 0) - COALESCE(ss.snapshot_qty, 0))::text AS variance
     FROM counted c
     FULL OUTER JOIN public.wms_stocktake_snapshot ss
       ON ss.item_code = c.item_code AND ss.session_id = $1
     ORDER BY ABS(COALESCE(c.counted_qty, 0) - COALESCE(ss.snapshot_qty, 0)) DESC,
              COALESCE(c.item_code, ss.item_code)`,
    [sid],
  );

  const filtered = rows.filter((r) => {
    const counted = Number.parseFloat(r.counted_qty);
    const sml = Number.parseFloat(r.sml_qty);
    const variance = counted - sml;
    if (filter === "variance" && variance === 0) return false;
    if (filter === "uncounted" && (counted > 0 || sml === 0)) return false;
    if (filter === "extra" && (counted <= 0 || sml > 0)) return false;
    if (q) {
      const text = `${r.item_code} ${r.item_name ?? ""}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    all: rows.length,
    variance: rows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) !== Number.parseFloat(r.sml_qty),
    ).length,
    uncounted: rows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) === 0 &&
        Number.parseFloat(r.sml_qty) > 0,
    ).length,
    extra: rows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) > 0 &&
        Number.parseFloat(r.sml_qty) === 0,
    ).length,
  };

  function filterHref(value: string) {
    const params = new URLSearchParams();
    if (value !== "all") params.set("filter", value);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 pb-12">
      <header>
        <Link
          href={`/stocktake/${sid}`}
          className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          ← {info.session_code}
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          ປຽບທຽບກັບ SML
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {info.name ?? info.session_code} · {info.wh_code}
          {info.wh_name ? ` · ${info.wh_name}` : ""} · {info.count_date}
        </p>
      </header>

      {/* Stat strip — horizontal compact */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ສິນຄ້າທັງໝົດ" value={counts.all} />
        <Stat
          label="ມີສ່ວນຕ່າງ"
          value={counts.variance}
          accent={counts.variance > 0 ? "red" : "emerald"}
        />
        <Stat
          label="ໃນ SML ບໍ່ໄດ້ນັບ"
          value={counts.uncounted}
          accent={counts.uncounted > 0 ? "amber" : "default"}
        />
        <Stat
          label="ນັບໄດ້ ບໍ່ມີໃນ SML"
          value={counts.extra}
          accent={counts.extra > 0 ? "amber" : "default"}
        />
      </section>

      {/* Search bar */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
      >
        {filter !== "all" && (
          <input type="hidden" name="filter" value={filter} />
        )}
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="ຄົ້ນຫາ ລະຫັດ ຫຼື ຊື່..."
          className="min-w-0 flex-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-zinc-200 outline-none focus:bg-white focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700"
        />
        <button
          type="submit"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900"
        >
          ຄົ້ນຫາ
        </button>
      </form>

      {/* Filter tabs */}
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {FILTERS.map((f) => {
          const active = filter === f.value;
          const count =
            f.value === "all"
              ? counts.all
              : f.value === "variance"
                ? counts.variance
                : f.value === "uncounted"
                  ? counts.uncounted
                  : counts.extra;
          return (
            <Link
              key={f.value}
              href={filterHref(f.value)}
              className={`relative px-3 py-2.5 text-sm font-medium transition ${
                active
                  ? "text-zinc-900 dark:text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {f.label}
              <span
                className={`ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {count}
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 bg-zinc-900 dark:bg-zinc-50" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Results */}
      <section>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              ບໍ່ມີລາຍການໃນຕົວກອງນີ້
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((r) => {
                const counted = Number.parseFloat(r.counted_qty) || 0;
                const sml = Number.parseFloat(r.sml_qty) || 0;
                const variance = counted - sml;
                return (
                  <li
                    key={r.item_code}
                    className="grid grid-cols-[1fr_auto] gap-3 px-5 py-3.5 sm:grid-cols-[1fr_100px_100px_120px]"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                        {r.item_code}
                      </div>
                      <div
                        className="truncate text-sm text-zinc-700 dark:text-zinc-300"
                        title={r.item_name ?? ""}
                      >
                        {r.item_name ?? "—"}
                      </div>
                      {r.unit_code && (
                        <div className="text-[10px] text-zinc-500">
                          {r.unit_code}
                        </div>
                      )}
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="font-mono text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-300">
                        {formatQty(counted)}
                      </div>
                      <div className="text-[10px] text-zinc-500">ນັບໄດ້</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="font-mono text-sm font-semibold tabular-nums text-zinc-500">
                        {formatQty(sml)}
                      </div>
                      <div className="text-[10px] text-zinc-500">SML</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-mono text-base font-bold tabular-nums ${
                          variance === 0
                            ? "text-zinc-400"
                            : variance > 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-red-700 dark:text-red-400"
                        }`}
                      >
                        {variance > 0 ? "+" : ""}
                        {formatQty(variance)}
                      </div>
                      <div className="text-[10px] text-zinc-500 sm:hidden">
                        ນັບ {formatQty(counted)} / SML {formatQty(sml)}
                      </div>
                      <div className="hidden text-[10px] text-zinc-500 sm:block">
                        ສ່ວນຕ່າງ
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-zinc-100 px-5 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
              ສະແດງ {filtered.length.toLocaleString("en-US")} ຈາກ{" "}
              {rows.length.toLocaleString("en-US")} ລາຍການ
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: number;
  accent?: "default" | "emerald" | "red" | "amber";
}) {
  const colorMap = {
    default: "text-zinc-900 dark:text-zinc-50",
    emerald: "text-emerald-700 dark:text-emerald-400",
    red: "text-red-700 dark:text-red-400",
    amber: "text-amber-700 dark:text-amber-400",
  };
  return (
    <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-2xl font-bold tabular-nums ${colorMap[accent]}`}
      >
        {value.toLocaleString("en-US")}
      </div>
    </div>
  );
}

function NoticeCard({
  text,
  tone,
}: {
  text: string;
  tone: "amber" | "red";
}) {
  const cls =
    tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
      : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200";
  return (
    <div
      className={`mx-auto mt-12 max-w-md rounded-2xl border p-6 text-center ${cls}`}
    >
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}

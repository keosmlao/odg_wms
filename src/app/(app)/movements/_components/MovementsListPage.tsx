import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses, ROLE_LABEL_LO } from "@/lib/session-shared";

const PAGE_SIZE = 50;

type MovementRow = {
  roworder: number;
  doc_date: string | null;
  doc_time: string | null;
  doc_no: string | null;
  doc_ref: string | null;
  item_code: string | null;
  item_name: string | null;
  qty: string;
  unit_code: string | null;
  wh_code: string | null;
  shelf_code: string | null;
  shelf_code1: string | null;
  user_created: string | null;
  trans_flag: number | null;
};

type WarehouseOption = { code: string; name: string | null };

type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return value?.toString() ?? "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function formatDate(d: string | null) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("lo-LA");
  } catch {
    return d;
  }
}

export default async function MovementsListPage({
  direction,
  title,
  description,
  basePath,
  searchParams,
  accentColor,
}: {
  /** 1 = receive (ຮັບເຂົ້າ), -1 = issue (ຈ່າຍອອກ) */
  direction: 1 | -1;
  title: string;
  description: string;
  basePath: string;
  searchParams: Promise<SearchParams>;
  accentColor: "emerald" | "red";
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Notice text="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />
    );
  }

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <Notice text="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const params = await searchParams;
  const search = pickStr(params.q);
  const requestedWh = pickStr(params.wh);
  const allTime = pickStr(params.all) === "1";
  const today = new Date().toISOString().slice(0, 10);
  const explicitFrom = pickStr(params.from);
  const explicitTo = pickStr(params.to);
  // Default to today on first visit; ?all=1 to see everything; explicit dates override.
  const fromDate = allTime
    ? ""
    : explicitFrom || (explicitTo ? "" : today);
  const toDate = allTime ? "" : explicitTo || (explicitFrom ? "" : today);
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  const whOptions =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1
           ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name
           FROM public.ic_warehouse
           WHERE code = ANY($1)
           ORDER BY code`,
          [accessible],
        );

  const allowedSet = new Set(whOptions.map((w) => w.code));
  const wh = requestedWh && allowedSet.has(requestedWh) ? requestedWh : "";

  const where: string[] = [
    "(t.status = 0 OR t.status IS NULL)",
    `t.calc_flag = ${direction}`,
  ];
  const args: unknown[] = [];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`t.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`t.wh_code = $${args.length}`);
  }
  if (search) {
    args.push(`%${search}%`);
    const i = args.length;
    where.push(
      `(t.item_code ILIKE $${i} OR t.item_name ILIKE $${i} OR t.doc_no ILIKE $${i} OR t.doc_ref ILIKE $${i})`,
    );
  }
  if (fromDate) {
    args.push(fromDate);
    where.push(`t.doc_date >= $${args.length}`);
  }
  if (toDate) {
    args.push(toDate);
    where.push(`t.doc_date <= $${args.length}`);
  }

  const whereSql = where.join(" AND ");

  const [countRows, totalQtyRows, groupRows, rows] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM public.odg_wms_trans_detail t
       WHERE ${whereSql}`,
      args,
    ),
    query<{ qty: string | null }>(
      `SELECT COALESCE(SUM(t.qty), 0)::text AS qty
       FROM public.odg_wms_trans_detail t
       WHERE ${whereSql}`,
      args,
    ),
    query<{ wh_code: string | null; n: number; qty: string }>(
      `SELECT
         t.wh_code,
         count(*)::int AS n,
         COALESCE(SUM(t.qty), 0)::text AS qty
       FROM public.odg_wms_trans_detail t
       WHERE ${whereSql}
       GROUP BY t.wh_code
       ORDER BY t.wh_code`,
      args,
    ),
    (async () => {
      const argsP = [...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE];
      return query<MovementRow>(
        `SELECT
           t.roworder,
           t.doc_date,
           t.doc_time,
           t.doc_no,
           t.doc_ref,
           t.item_code,
           t.item_name,
           t.qty::text AS qty,
           t.unit_code,
           t.wh_code,
           t.shelf_code,
           t.shelf_code1,
           t.user_created,
           t.trans_flag
         FROM public.odg_wms_trans_detail t
         WHERE ${whereSql}
         ORDER BY t.wh_code ASC NULLS LAST,
                  t.doc_date DESC NULLS LAST,
                  t.doc_time DESC NULLS LAST,
                  t.roworder DESC
         LIMIT $${argsP.length - 1} OFFSET $${argsP.length}`,
        argsP,
      );
    })(),
  ]);

  const groupTotals = new Map<
    string,
    { count: number; qty: number }
  >(
    groupRows.map((g) => [
      g.wh_code ?? "",
      { count: g.n, qty: Number.parseFloat(g.qty) || 0 },
    ]),
  );

  const total = countRows[0]?.n ?? 0;
  const totalQty = Number.parseFloat(totalQtyRows[0]?.qty ?? "0");
  const hasNext = rows.length > PAGE_SIZE;
  const pageRows = hasNext ? rows.slice(0, PAGE_SIZE) : rows;

  function buildHref(overrides: Partial<{
    q: string;
    wh: string;
    from: string;
    to: string;
    page: string;
    all: string;
  }>) {
    const sp = new URLSearchParams();
    const next = {
      q: overrides.q ?? search,
      wh: overrides.wh ?? wh,
      from: overrides.from ?? (allTime ? "" : explicitFrom),
      to: overrides.to ?? (allTime ? "" : explicitTo),
      page: overrides.page ?? String(page),
      all: overrides.all ?? (allTime ? "1" : ""),
    };
    if (next.q) sp.set("q", next.q);
    if (next.wh) sp.set("wh", next.wh);
    if (next.from) sp.set("from", next.from);
    if (next.to) sp.set("to", next.to);
    if (next.all) sp.set("all", next.all);
    if (next.page && next.page !== "1") sp.set("page", next.page);
    const s = sp.toString();
    return s ? `?${s}` : "";
  }

  const accentText =
    accentColor === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";

  const whNameOnly = (code: string | null) => {
    if (!code) return "—";
    const found = whOptions.find((o) => o.code === code);
    return found?.name ?? "";
  };

  const dateLabel = allTime
    ? "ທຸກວັນ"
    : fromDate && toDate && fromDate === toDate
      ? fromDate === today
        ? "ມື້ນີ້"
        : fromDate
      : fromDate && toDate
        ? `${fromDate} → ${toDate}`
        : fromDate || toDate || "—";

  // Group page rows by warehouse for the new card-based layout.
  const groupedPage: Array<{ wh_code: string | null; rows: MovementRow[] }> =
    [];
  for (const r of pageRows) {
    const last = groupedPage[groupedPage.length - 1];
    if (last && last.wh_code === r.wh_code) last.rows.push(r);
    else groupedPage.push({ wh_code: r.wh_code, rows: [r] });
  }

  return (
    <div className="w-full space-y-5">
      {/* Hero */}
      <header className="shadow-card relative overflow-hidden rounded-2xl bg-white p-7 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div
          className={`pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full blur-3xl ${
            accentColor === "emerald"
              ? "bg-gradient-to-br from-emerald-500/15 via-teal-500/8 to-transparent dark:from-emerald-500/20"
              : "bg-gradient-to-br from-red-500/15 via-orange-500/8 to-transparent dark:from-red-500/20"
          }`}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="flex items-center gap-3.5">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                  accentColor === "emerald"
                    ? "bg-emerald-50 dark:bg-emerald-950/40"
                    : "bg-red-50 dark:bg-red-950/40"
                } ${accentText}`}
              >
                {direction === 1 ? <ArrowDownIcon /> : <ArrowUpIcon />}
              </div>
              <div className="min-w-0">
                <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                  {title}
                </h2>
                <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                  {description}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <Chip tone="primary">{ROLE_LABEL_LO[session.role]}</Chip>
              <Chip>
                <BuildingIcon />
                {accessible === null
                  ? "ທຸກສາງ"
                  : `${accessible.length} ສາງ ໃນສິດ`}
              </Chip>
              <Chip>
                <CalendarIcon />
                {dateLabel}
              </Chip>
              {wh && (
                <Chip tone="accent" accentColor={accentColor}>
                  ສາງ {wh}
                </Chip>
              )}
              {search && (
                <Chip tone="accent" accentColor={accentColor}>
                  ⌕ {search}
                </Chip>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
              ຍອດລວມທັງໝົດ
            </div>
            <div
              className={`mt-1 font-mono text-4xl font-bold tabular-nums ${accentText}`}
            >
              {direction === 1 ? "+" : "−"}
              {formatQty(totalQty)}
            </div>
            <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {total.toLocaleString("en-US")} ລາຍການ ·{" "}
              {groupRows.length} ສາງ
            </div>
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<ListIcon />}
          label="ຈຳນວນລາຍການ"
          value={total.toLocaleString("en-US")}
        />
        <KpiCard
          icon={<BuildingIcon />}
          label="ຈຳນວນສາງ"
          value={`${groupRows.length}`}
          sub={accessible === null ? "ທຸກສາງ" : `ຈາກ ${whOptions.length} ສິດ`}
        />
        <KpiCard
          icon={<TrendIcon />}
          label="ຍອດລວມ"
          value={formatQty(totalQty)}
          accentColor={accentColor}
          highlight
        />
        <KpiCard
          icon={<CalendarIcon />}
          label="ຊ່ວງວັນທີ"
          value={dateLabel}
        />
      </section>

      {/* Filter card */}
      <form
        method="get"
        className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
      >
        <div className="grid gap-3 lg:grid-cols-[1fr_240px_180px_180px]">
          <Field label="ຄົ້ນຫາ" hint="ລະຫັດ ຫຼື ຊື່ສິນຄ້າ / doc_no">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
                <SearchIcon />
              </span>
              <input
                type="text"
                name="q"
                defaultValue={search}
                placeholder="ເຊັ່ນ 130202 ຫຼື 20260501243"
                className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition placeholder:text-zinc-400 hover:ring-zinc-300 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-zinc-100"
              />
            </div>
          </Field>
          <Field label="ສາງ">
            <select
              name="wh"
              defaultValue={wh}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-zinc-100"
            >
              <option value="">
                {accessible === null
                  ? "ທຸກສາງ"
                  : `ສາງທີ່ຮັບຜິດຊອບ (${whOptions.length})`}
              </option>
              {whOptions.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} {w.name ? `· ${w.name}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ຈາກວັນທີ">
            <input
              type="date"
              name="from"
              defaultValue={fromDate}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-zinc-100"
            />
          </Field>
          <Field label="ຫາວັນທີ">
            <input
              type="date"
              name="to"
              defaultValue={toDate}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:ring-zinc-700 dark:focus:ring-zinc-100"
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={basePath}
              className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
            >
              ມື້ນີ້
            </Link>
            <Link
              href={`${basePath}?all=1`}
              className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
            >
              ທຸກວັນ
            </Link>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg hover:shadow-indigo-500/30 active:from-indigo-600 active:to-violet-700"
          >
            ກອງ
          </button>
        </div>
      </form>

      {/* Per-warehouse cards */}
      {pageRows.length === 0 ? (
        <EmptyState direction={direction} />
      ) : (
        <div className="space-y-4">
          {groupedPage.map((group) => {
            const grp = groupTotals.get(group.wh_code ?? "");
            const whLabel = group.wh_code ?? "—";
            const whSubname = whNameOnly(group.wh_code);
            return (
              <article
                key={group.wh_code ?? "_none"}
                className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 transition-all hover:shadow-card-hover dark:bg-zinc-900 dark:ring-zinc-800"
              >
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 dark:border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg font-mono text-xs font-bold ${
                        accentColor === "emerald"
                          ? "bg-emerald-50 dark:bg-emerald-950/40"
                          : "bg-red-50 dark:bg-red-950/40"
                      } ${accentText}`}
                    >
                      {whLabel.slice(-2) || "?"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {whLabel}
                        </span>
                        {whSubname && (
                          <span className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                            · {whSubname}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {grp?.count.toLocaleString("en-US") ?? 0} ລາຍການ ·
                        ສະແດງ {group.rows.length}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      ຍອດລວມສາງ
                    </div>
                    <div
                      className={`font-mono text-2xl font-bold tabular-nums ${accentText}`}
                    >
                      {direction === 1 ? "+" : "−"}
                      {formatQty(grp?.qty ?? 0)}
                    </div>
                  </div>
                </header>

                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {group.rows.map((r) => (
                    <div
                      key={r.roworder}
                      className="flex items-center gap-4 px-5 py-3 transition"
                    >
                      <div className="hidden w-20 shrink-0 sm:block">
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                          {formatDate(r.doc_date)}
                        </div>
                        {r.doc_time && (
                          <div className="text-[10px] text-zinc-500">
                            {r.doc_time}
                          </div>
                        )}
                      </div>
                      <div className="hidden w-32 shrink-0 lg:block">
                        <div className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                          {r.doc_no ?? "—"}
                        </div>
                        {r.doc_ref && (
                          <div className="text-[10px] text-zinc-500">
                            ref: {r.doc_ref}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                            {r.item_code ?? "—"}
                          </span>
                          {r.shelf_code1 && (
                            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                              {r.shelf_code1}
                            </span>
                          )}
                        </div>
                        <div
                          className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300"
                          title={r.item_name ?? ""}
                        >
                          {r.item_name ?? "—"}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500 sm:hidden">
                          <span>{formatDate(r.doc_date)}</span>
                          {r.doc_no && <span>· {r.doc_no}</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className={`font-mono text-lg font-bold tabular-nums ${accentText}`}
                        >
                          {direction === 1 ? "+" : "−"}
                          {formatQty(r.qty)}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {r.unit_code ?? ""}
                          {r.user_created && (
                            <> · {r.user_created}</>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pageRows.length > 0 && (
        <nav className="shadow-card flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            ໜ້າ <span className="font-semibold text-zinc-700 dark:text-zinc-200">{page}</span>{" "}
            · ສະແດງ {pageRows.length.toLocaleString("en-US")} ຈາກ{" "}
            {total.toLocaleString("en-US")}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={`${basePath}${buildHref({ page: String(page - 1) })}`}
                className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
              >
                ← ກ່ອນໜ້າ
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">
                ← ກ່ອນໜ້າ
              </span>
            )}
            {hasNext ? (
              <Link
                href={`${basePath}${buildHref({ page: String(page + 1) })}`}
                className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
              >
                ໜ້າຕໍ່ →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">
                ໜ້າຕໍ່ →
              </span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {label}
        {hint && (
          <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-500">
            ({hint})
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

function Chip({
  children,
  tone = "default",
  accentColor,
}: {
  children: React.ReactNode;
  tone?: "default" | "primary" | "accent";
  accentColor?: "emerald" | "red";
}) {
  const cls =
    tone === "primary"
      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
      : tone === "accent"
        ? accentColor === "emerald"
          ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/50"
          : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/50"
        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  highlight = false,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  accentColor?: "emerald" | "red";
}) {
  const valueClass = highlight
    ? accentColor === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400"
    : "text-zinc-900 dark:text-zinc-50";

  const iconColor = highlight
    ? accentColor === "emerald"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400"
    : "text-zinc-500 dark:text-zinc-400";

  const iconBg = highlight
    ? accentColor === "emerald"
      ? "bg-emerald-50 dark:bg-emerald-950/40"
      : "bg-red-50 dark:bg-red-950/40"
    : "bg-zinc-100 dark:bg-zinc-800";

  return (
    <div className="shadow-card hover:shadow-card-hover group relative overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-zinc-200 transition-all hover:-translate-y-0.5 dark:bg-zinc-900 dark:ring-zinc-800">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg} ${iconColor}`}
        >
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
      </div>
      <div className={`mt-3 font-mono text-2xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-500">
          {sub}
        </div>
      )}
    </div>
  );
}

function EmptyState({ direction }: { direction: 1 | -1 }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="4" y="6" width="16" height="14" rx="2" />
          <path d="M9 3h6v3H9z" />
          <path d="M8 12h8M8 16h5" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">
        ບໍ່ມີ{direction === 1 ? "ການຮັບສິນຄ້າ" : "ການຈ່າຍສິນຄ້າ"}ໃນຊ່ວງທີ່ເລືອກ
      </div>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
        ລອງປ່ຽນຊ່ວງວັນທີ ຫຼື ກົດ "ທຸກວັນ" ເພື່ອເບິ່ງລາຍການທັງໝົດ
      </p>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl bg-amber-50/40 p-4 ring-1 ring-amber-200 dark:bg-amber-950/20 dark:ring-amber-900/50">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path d="M12 9v4m0 4h.01" strokeLinecap="round" />
            <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          </svg>
        </span>
        <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          {text}
        </div>
      </div>
    </div>
  );
}

function ArrowDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14" />
      <path d="m6 13 6 6 6-6" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5" />
      <path d="m6 11 6-6 6 6" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h.01M9 13h.01M9 17h.01M14 9h.01M14 13h.01M14 17h.01" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M14 7h7v7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

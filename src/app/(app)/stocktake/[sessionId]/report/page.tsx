import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import StocktakeLayout from "../../_components/StocktakeLayout";

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
  counted_unit: string | null;
  sml_unit: string | null;
  counted_qty: string;
  sml_qty: string;
  pending_qty: string;
  reference_qty: string;
  variance: string;
};

type PendingBillLine = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
};

type SearchParams = Record<string, string | string[] | undefined>;
type CompareScope = "counted" | "all";

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

function signedQty(value: number) {
  return `${value > 0 ? "+" : ""}${formatQty(value)}`;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "ທຸກປະເພດ" },
  { value: "variance", label: "ມີສ່ວນຕ່າງ" },
  { value: "uncounted", label: "ໃນຍອດອ້າງອີງ ບໍ່ໄດ້ນັບ" },
  { value: "extra", label: "ນັບໄດ້ ບໍ່ມີໃນຍອດອ້າງອີງ" },
];

const COMPARE_SCOPES: Array<{ value: CompareScope; label: string; detail: string }> =
  [
    {
      value: "counted",
      label: "ນັບແລ້ວ",
      detail: "ສະເພາະສິນຄ້າທີ່ມີຈຳນວນນັບ",
    },
    {
      value: "all",
      label: "ທັງໝົດ",
      detail: "ລວມ SML/ຄ້າງຈ່າຍທີ່ຍັງບໍ່ໄດ້ນັບ",
    },
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
  const scope: CompareScope = pick(sp.scope) === "all" ? "all" : "counted";

  const pendingLines = await query<PendingBillLine>(
    `SELECT
       pb.doc_no,
       pb.trans_flag,
       t.doc_date::text AS doc_date,
       t.cust_code,
       d.item_code,
       d.item_name,
       d.unit_code,
       d.qty::text AS qty
     FROM public.wms_stocktake_pending_bill pb
     JOIN public.ic_trans t
       ON t.doc_no = pb.doc_no AND t.trans_flag = pb.trans_flag
     JOIN public.ic_trans_detail d
       ON d.doc_no = pb.doc_no AND d.trans_flag = pb.trans_flag
     WHERE pb.session_id = $1
       AND d.wh_code = $2
       AND (d.status = 0 OR d.status IS NULL)
       AND d.item_code IS NOT NULL
       AND d.item_code <> ''
     ORDER BY t.doc_date DESC, pb.doc_no, d.item_code`,
    [sid, info.wh_code],
  );

  const billGroups: Array<{
    doc_no: string;
    trans_flag: number;
    doc_date: string | null;
    cust_code: string | null;
    lines: PendingBillLine[];
    total_qty: number;
  }> = [];
  {
    const idx = new Map<string, (typeof billGroups)[number]>();
    for (const l of pendingLines) {
      const key = `${l.doc_no}::${l.trans_flag}`;
      let g = idx.get(key);
      if (!g) {
        g = {
          doc_no: l.doc_no,
          trans_flag: l.trans_flag,
          doc_date: l.doc_date,
          cust_code: l.cust_code,
          lines: [],
          total_qty: 0,
        };
        idx.set(key, g);
        billGroups.push(g);
      }
      g.lines.push(l);
      g.total_qty += Number.parseFloat(l.qty) || 0;
    }
  }

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
     ),
     universe AS (
       SELECT item_code, item_name, unit_code FROM counted
       UNION
       SELECT item_code, item_name, unit_code
       FROM public.wms_stocktake_snapshot
       WHERE session_id = $1
       UNION
       SELECT item_code, item_name, unit_code
       FROM public.wms_stocktake_pending
       WHERE session_id = $1
     )
     SELECT
       u.item_code                                    AS item_code,
       COALESCE(c.item_name, u.item_name)             AS item_name,
       c.unit_code                                    AS counted_unit,
       ss.unit_code                                   AS sml_unit,
       COALESCE(c.counted_qty, 0)::text               AS counted_qty,
       COALESCE(ss.snapshot_qty, 0)::text             AS sml_qty,
       COALESCE(p.pending_qty, 0)::text               AS pending_qty,
       (COALESCE(ss.snapshot_qty, 0) + COALESCE(p.pending_qty, 0))::text AS reference_qty,
       (COALESCE(c.counted_qty, 0)
          - COALESCE(ss.snapshot_qty, 0)
          - COALESCE(p.pending_qty, 0))::text AS variance
     FROM (
       SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code
       FROM universe
       WHERE item_code IS NOT NULL
       GROUP BY item_code
     ) u
     LEFT JOIN counted c
       ON c.item_code = u.item_code
     LEFT JOIN public.wms_stocktake_snapshot ss
       ON ss.item_code = u.item_code AND ss.session_id = $1
     LEFT JOIN public.wms_stocktake_pending p
       ON p.item_code = u.item_code AND p.session_id = $1
     ORDER BY ABS(
                COALESCE(c.counted_qty, 0)
                - COALESCE(ss.snapshot_qty, 0)
                - COALESCE(p.pending_qty, 0)
              ) DESC,
              u.item_code`,
    [sid],
  );

  const correctedItemRows = await query<{ item_code: string; n: number }>(
    `SELECT item_code, count(*)::int AS n
     FROM public.wms_stocktake_unit_log
     WHERE session_id = $1
     GROUP BY item_code`,
    [sid],
  );
  const correctedItems = new Map(
    correctedItemRows.map((r) => [r.item_code, r.n]),
  );

  const countedRows = rows.filter(
    (r) => (Number.parseFloat(r.counted_qty) || 0) > 0,
  );
  const scopedRows = scope === "counted" ? countedRows : rows;

  const filtered = scopedRows.filter((r) => {
    const counted = Number.parseFloat(r.counted_qty);
    const ref = Number.parseFloat(r.reference_qty);
    const variance = counted - ref;
    if (filter === "variance" && variance === 0) return false;
    if (filter === "uncounted" && (counted > 0 || ref === 0)) return false;
    if (filter === "extra" && (counted <= 0 || ref > 0)) return false;
    if (q) {
      const text = `${r.item_code} ${r.item_name ?? ""}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    all: scopedRows.length,
    variance: scopedRows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) !==
        Number.parseFloat(r.reference_qty),
    ).length,
    uncounted: scopedRows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) === 0 &&
        Number.parseFloat(r.reference_qty) > 0,
    ).length,
    extra: scopedRows.filter(
      (r) =>
        Number.parseFloat(r.counted_qty) > 0 &&
        Number.parseFloat(r.reference_qty) === 0,
    ).length,
  };
  const totals = scopedRows.reduce(
    (acc, r) => {
      const counted = Number.parseFloat(r.counted_qty) || 0;
      const sml = Number.parseFloat(r.sml_qty) || 0;
      const pending = Number.parseFloat(r.pending_qty) || 0;
      const ref = Number.parseFloat(r.reference_qty) || 0;
      const variance = counted - ref;
      acc.counted += counted;
      acc.sml += sml;
      acc.pending += pending;
      acc.reference += ref;
      acc.variance += variance;
      acc.absVariance += Math.abs(variance);
      return acc;
    },
    {
      counted: 0,
      sml: 0,
      pending: 0,
      reference: 0,
      variance: 0,
      absVariance: 0,
    },
  );
  const accuracy =
    counts.all === 0 ? 100 : ((counts.all - counts.variance) / counts.all) * 100;
  const activeScope = COMPARE_SCOPES.find((s) => s.value === scope);

  function filterHref(value: string) {
    const params = new URLSearchParams();
    if (scope !== "counted") params.set("scope", scope);
    if (value !== "all") params.set("filter", value);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  function scopeHref(value: CompareScope) {
    const params = new URLSearchParams();
    if (value !== "counted") params.set("scope", value);
    if (filter !== "all") params.set("filter", filter);
    if (q) params.set("q", q);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  function filterCount(value: string) {
    if (value === "all") return counts.all;
    if (value === "variance") return counts.variance;
    if (value === "uncounted") return counts.uncounted;
    return counts.extra;
  }

  return (
    <StocktakeLayout wide>
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-8">
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_380px] lg:p-6">
          <div className="min-w-0">
            <Link
              href={`/stocktake/${sid}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
            >
              ← {info.session_code}
            </Link>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                ລາຍງານປຽບທຽບ
              </p>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {info.status === "open"
                  ? "ກຳລັງດຳເນີນ"
                  : info.status === "pending_approval"
                    ? "ລໍຖ້າອະນຸມັດ"
                    : "ປິດແລ້ວ"}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
              ປຽບທຽບກັບ SML
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {info.name ?? info.session_code} · {info.wh_code}
              {info.wh_name ? ` · ${info.wh_name}` : ""} · {info.count_date}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={scope === "counted" ? "ນັບແລ້ວ" : "ທັງໝົດ"}
                value={counts.all.toLocaleString("en-US")}
                sub={activeScope?.label ?? ""}
                tone="zinc"
              />
              <MetricCard
                label="ມີສ່ວນຕ່າງ"
                value={counts.variance.toLocaleString("en-US")}
                sub={`${accuracy.toFixed(1)}% ກົງ`}
                tone={counts.variance > 0 ? "red" : "emerald"}
              />
              <MetricCard
                label="ນັບໄດ້ລວມ"
                value={formatQty(totals.counted)}
                sub={`ອ້າງອີງ ${formatQty(totals.reference)}`}
                tone="indigo"
              />
              <MetricCard
                label="ສ່ວນຕ່າງ net"
                value={signedQty(totals.variance)}
                sub={`abs ${formatQty(totals.absVariance)}`}
                tone={
                  Math.abs(totals.variance) < 0.0001
                    ? "emerald"
                    : totals.variance > 0
                      ? "amber"
                      : "red"
                }
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              ມຸມມອງການປຽບທຽບ
            </div>
            <nav className="mt-3 grid gap-2">
              {COMPARE_SCOPES.map((s) => {
                const active = scope === s.value;
                const count =
                  s.value === "counted" ? countedRows.length : rows.length;
                return (
                  <Link
                    key={s.value}
                    href={scopeHref(s.value)}
                    className={`rounded-xl px-3 py-3 ring-1 transition ${
                      active
                        ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:ring-zinc-100"
                        : "bg-white text-zinc-700 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold">{s.label}</div>
                        <div
                          className={`mt-0.5 text-xs ${
                            active
                              ? "text-white/70 dark:text-zinc-600"
                              : "text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {s.detail}
                        </div>
                      </div>
                      <div className="font-mono text-xl font-bold tabular-nums">
                        {count.toLocaleString("en-US")}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <form method="get" className="flex flex-col gap-3 lg:flex-row">
          {scope !== "counted" && (
            <input type="hidden" name="scope" value={scope} />
          )}
          {filter !== "all" && (
            <input type="hidden" name="filter" value={filter} />
          )}
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ສິນຄ້າ..."
            className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
          <button
            type="submit"
            className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            ຄົ້ນຫາ
          </button>
        </form>

        <nav className="mt-3 flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const count = filterCount(f.value);
            return (
              <Link
                key={f.value}
                href={filterHref(f.value)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                  active
                    ? "bg-indigo-600 text-white ring-indigo-600"
                    : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-950 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                {f.label}
                <span
                  className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                    active
                      ? "bg-white/20 text-white"
                      : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {count.toLocaleString("en-US")}
                </span>
              </Link>
            );
          })}
        </nav>
      </section>

      {/* Results */}
      <section>
        {filtered.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              ບໍ່ມີລາຍການໃນຕົວກອງນີ້
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <div className="hidden grid-cols-[minmax(220px,1fr)_110px_110px_110px_120px_130px] gap-3 border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 md:grid">
              <div>ສິນຄ້າ</div>
              <div className="text-right">ນັບໄດ້</div>
              <div className="text-right">SML</div>
              <div className="text-right">ຄ້າງຈ່າຍ</div>
              <div className="text-right">ອ້າງອີງ</div>
              <div className="text-right">ສ່ວນຕ່າງ</div>
            </div>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {filtered.map((r) => {
                const counted = Number.parseFloat(r.counted_qty) || 0;
                const sml = Number.parseFloat(r.sml_qty) || 0;
                const pending = Number.parseFloat(r.pending_qty) || 0;
                const ref = Number.parseFloat(r.reference_qty) || 0;
                const variance = counted - ref;
                const tone =
                  variance === 0
                    ? "neutral"
                    : variance > 0
                      ? "over"
                      : "under";
                return (
                  <ComparisonRow
                    key={r.item_code}
                    row={r}
                    counted={counted}
                    sml={sml}
                    pending={pending}
                    refQty={ref}
                    variance={variance}
                    tone={tone}
                    correctedCount={correctedItems.get(r.item_code)}
                  />
                );
              })}
            </ul>
            <div className="border-t border-zinc-100 px-5 py-2.5 text-xs text-zinc-500 dark:border-zinc-800">
              ສະແດງ {filtered.length.toLocaleString("en-US")} ຈາກ{" "}
              {scopedRows.length.toLocaleString("en-US")} ລາຍການ
            </div>
          </div>
        )}
      </section>

      {/* Pending bills breakdown */}
      {billGroups.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              ບິນຄ້າງຈ່າຍທີ່ຮວມໃນຍອດອ້າງອີງ
            </h2>
            <span className="text-xs text-zinc-500">
              {billGroups.length.toLocaleString("en-US")} ບິນ ·{" "}
              {pendingLines.length.toLocaleString("en-US")} ລາຍການ
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {billGroups.map((g) => (
              <details
                key={`${g.doc_no}::${g.trans_flag}`}
                className="group overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                open={g.lines.length <= 5}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
                        {g.doc_no}
                      </span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        flag {g.trans_flag}
                      </span>
                      {g.doc_date && (
                        <span className="text-[10px] text-zinc-500">
                          {g.doc_date}
                        </span>
                      )}
                    </div>
                    {g.cust_code && (
                      <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {g.cust_code}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">
                      +{formatQty(g.total_qty)}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {g.lines.length} ລາຍ
                    </div>
                  </div>
                  <span className="ml-1 text-xs text-zinc-400 transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <ul className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                  {g.lines.map((l, i) => (
                    <li
                      key={`${l.item_code}-${i}`}
                      className="flex items-center justify-between gap-3 px-4 py-1.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
                          {l.item_code}
                        </span>
                        {l.item_name && (
                          <span
                            className="ml-2 truncate text-zinc-500 dark:text-zinc-400"
                            title={l.item_name}
                          >
                            {l.item_name}
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-mono font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                          +{formatQty(Number.parseFloat(l.qty) || 0)}
                        </span>
                        {l.unit_code && (
                          <span className="ml-1 text-[10px] text-zinc-400">
                            {l.unit_code}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
    </StocktakeLayout>
  );
}

function MetricCard({
  label,
  value,
  sub,
  tone = "zinc",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "zinc" | "emerald" | "red" | "amber" | "indigo";
}) {
  const toneMap = {
    zinc: "border-zinc-200 bg-zinc-50/80 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-100",
    emerald:
      "border-emerald-200 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200",
    red: "border-red-200 bg-red-50/70 text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200",
    amber:
      "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200",
    indigo:
      "border-indigo-200 bg-indigo-50/70 text-indigo-800 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-200",
  } as const;
  return (
    <div className={`rounded-xl border px-3 py-3 ${toneMap[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-black tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium opacity-70">{sub}</div>
    </div>
  );
}

function ComparisonRow({
  row,
  counted,
  sml,
  pending,
  refQty,
  variance,
  tone,
  correctedCount,
}: {
  row: VarianceRow;
  counted: number;
  sml: number;
  pending: number;
  refQty: number;
  variance: number;
  tone: "neutral" | "over" | "under";
  correctedCount?: number;
}) {
  const accent =
    tone === "neutral"
      ? "bg-zinc-300 dark:bg-zinc-700"
      : tone === "over"
        ? "bg-emerald-500"
        : "bg-red-500";
  const varianceColor =
    tone === "neutral"
      ? "text-zinc-400"
      : tone === "over"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-red-700 dark:text-red-400";
  const countedUnit = row.counted_unit?.trim() || null;
  const smlUnit = row.sml_unit?.trim() || null;
  const unitMismatch =
    countedUnit !== null &&
    smlUnit !== null &&
    countedUnit.toUpperCase() !== smlUnit.toUpperCase();
  return (
    <li className="relative grid gap-3 px-4 py-3 transition hover:bg-zinc-50/70 md:grid-cols-[minmax(220px,1fr)_110px_110px_110px_120px_130px] dark:hover:bg-zinc-950/30">
      <span className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${accent}`} />
      <div className="min-w-0 pl-2 md:pl-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="truncate font-mono text-xs font-bold text-zinc-900 dark:text-zinc-50">
            {row.item_code}
          </div>
          {correctedCount !== undefined && (
            <span
              title={`ປັບຫົວໜ່ວຍແລ້ວ ${correctedCount} ຄັ້ງ`}
              className="inline-flex shrink-0 items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50"
            >
              ປັບແລ້ວ
            </span>
          )}
        </div>
        <div
          className="mt-0.5 truncate text-sm text-zinc-700 dark:text-zinc-300"
          title={row.item_name ?? ""}
        >
          {row.item_name ?? "—"}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono font-semibold ring-1 ${
              unitMismatch
                ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60"
                : "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
            }`}
            title="ຫົວໜ່ວຍນັບ"
          >
            ນັບ: {countedUnit ?? "—"}
          </span>
          <span
            className={`rounded-md px-1.5 py-0.5 font-mono font-semibold ring-1 ${
              unitMismatch
                ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/60"
                : "bg-zinc-50 text-zinc-600 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700"
            }`}
            title="ຫົວໜ່ວຍ SML"
          >
            SML: {smlUnit ?? "—"}
          </span>
          {unitMismatch && (
            <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-bold text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60">
              ຫົວໜ່ວຍບໍ່ກົງ
            </span>
          )}
        </div>
      </div>

      <QtyCell label="ນັບໄດ້" value={formatQty(counted)} strong />
      <QtyCell label="SML" value={formatQty(sml)} />
      <QtyCell
        label="ຄ້າງຈ່າຍ"
        value={pending > 0 ? `+${formatQty(pending)}` : "—"}
        tone={pending > 0 ? "amber" : "muted"}
      />
      <QtyCell label="ອ້າງອີງ" value={formatQty(refQty)} strong />

      <div className="flex items-end justify-between gap-3 border-t border-zinc-100 pt-2 md:block md:border-t-0 md:pt-0 md:text-right dark:border-zinc-800">
        <span className="text-[10px] font-medium text-zinc-500 md:hidden">
          ສ່ວນຕ່າງ
        </span>
        <div className={`font-mono text-lg font-black tabular-nums ${varianceColor}`}>
          {signedQty(variance)}
        </div>
      </div>
    </li>
  );
}

function QtyCell({
  label,
  value,
  tone = "default",
  strong,
}: {
  label: string;
  value: string;
  tone?: "default" | "amber" | "muted";
  strong?: boolean;
}) {
  const color =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "muted"
        ? "text-zinc-400"
        : "text-zinc-700 dark:text-zinc-300";
  return (
    <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
      <div className="text-[10px] font-medium text-zinc-500 md:hidden">
        {label}
      </div>
      <div
        className={`font-mono text-sm tabular-nums ${color} ${
          strong ? "font-bold" : "font-medium"
        }`}
      >
        {value}
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

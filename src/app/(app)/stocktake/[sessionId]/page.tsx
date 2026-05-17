import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { CheckIcon, ChevronRightIcon, PlusIcon } from "@/components/ui/Icons";
import StocktakeLayout from "../_components/StocktakeLayout";
import {
  stEyebrow,
  stMuted,
  stNavLink,
  stPanel,
  stPanelPad,
} from "../_components/stocktake-theme";
import SessionActions from "./SessionActions";
import SnapshotPanel from "./SnapshotPanel";
import LabelBulkCreate from "./LabelBulkCreate";
import LabelFromLocation from "./LabelFromLocation";
import LabelGrid from "./LabelGrid";
import ExcelImport from "./ExcelImport";

type SessionDetail = {
  session_id: number;
  session_code: string;
  wh_code: string;
  wh_name: string | null;
  name: string | null;
  note: string | null;
  status: "open" | "pending_approval" | "closed";
  count_date: string;
  blind: boolean;
  created_at: string;
  submitted_at: string | null;
  closed_at: string | null;
  approval_note: string | null;
  created_employee: string | null;
  submitted_employee: string | null;
  approved_employee: string | null;
  closed_employee: string | null;
  snapshot_items: number;
  snapshot_qty: string;
  counted_items: number;
  pending_items: number;
  pending_bills: number;
};

export type LabelInfo = {
  label_id: number;
  label_code: string;
  note: string | null;
  rack_code: string | null;
  location_code: string | null;
  line_count: number;
  qty_sum: string;
  last_counted_at: string | null;
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

type TabKey = "count" | "results" | "settings";

const TAB_KEYS: TabKey[] = ["count", "results", "settings"];

function resolveTab(value: string | string[] | undefined): TabKey {
  const v = Array.isArray(value) ? value[0] : value;
  return TAB_KEYS.includes(v as TabKey) ? (v as TabKey) : "count";
}

export default async function SessionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const userSession = await getSession();
  if (!userSession) redirect("/login");
  if (!userSession.role) {
    return (
      <StocktakeLayout>
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            ບໍ່ມີສິດເຂົ້າເຖິງ WMS
          </p>
        </div>
      </StocktakeLayout>
    );
  }
  const { sessionId } = await params;
  const id = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(id)) notFound();
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);

  const detail = (
    await query<SessionDetail>(
      `SELECT
         s.session_id,
         s.session_code,
         s.wh_code,
         w.name_1 AS wh_name,
         s.name,
         s.note,
         s.status,
         s.count_date::text AS count_date,
         s.blind,
         s.created_at::text   AS created_at,
         s.submitted_at::text AS submitted_at,
         s.closed_at::text    AS closed_at,
         s.approval_note,
         eC.fullname_lo AS created_employee,
         eS.fullname_lo AS submitted_employee,
         eA.fullname_lo AS approved_employee,
         eX.fullname_lo AS closed_employee,
         (SELECT count(*)::int FROM public.wms_stocktake_snapshot ss
          WHERE ss.session_id = s.session_id) AS snapshot_items,
         (SELECT COALESCE(SUM(snapshot_qty), 0)::text
          FROM public.wms_stocktake_snapshot ss
          WHERE ss.session_id = s.session_id) AS snapshot_qty,
         (SELECT count(DISTINCT item_code)::int
          FROM public.wms_stocktake_line ln
          WHERE ln.session_id = s.session_id) AS counted_items,
         (SELECT count(*)::int FROM public.wms_stocktake_pending p
          WHERE p.session_id = s.session_id) AS pending_items,
         (SELECT count(*)::int FROM public.wms_stocktake_pending_bill pb
          WHERE pb.session_id = s.session_id) AS pending_bills
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w  ON w.code = s.wh_code
       LEFT JOIN public.odg_employee  eC ON eC.employee_id = s.created_by
       LEFT JOIN public.odg_employee  eS ON eS.employee_id = s.submitted_by
       LEFT JOIN public.odg_employee  eA ON eA.employee_id = s.approved_by
       LEFT JOIN public.odg_employee  eX ON eX.employee_id = s.closed_by
       WHERE s.session_id = $1`,
      [id],
    )
  )[0];

  if (!detail) notFound();

  const accessible = accessibleWarehouses(userSession);
  if (Array.isArray(accessible) && !accessible.includes(detail.wh_code)) {
    return (
      <StocktakeLayout>
        <div className="mx-auto mt-12 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
          <p className="text-sm font-medium text-red-900 dark:text-red-200">
            ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້
          </p>
        </div>
      </StocktakeLayout>
    );
  }

  const [labels, locMaster, varianceRows] = await Promise.all([
    query<LabelInfo>(
      `SELECT
         l.label_id,
         l.label_code,
         l.note,
         l.rack_code,
         l.location_code,
         COALESCE(stats.line_count, 0)::int AS line_count,
         COALESCE(stats.qty_sum, '0')      AS qty_sum,
         stats.last_counted_at::text       AS last_counted_at
       FROM public.wms_stocktake_label l
       LEFT JOIN (
         SELECT label_id,
                count(*)::int      AS line_count,
                SUM(qty)::text     AS qty_sum,
                MAX(counted_at)    AS last_counted_at
         FROM public.wms_stocktake_line
         WHERE session_id = $1
         GROUP BY label_id
       ) stats ON stats.label_id = l.label_id
       WHERE l.session_id = $1
       ORDER BY l.label_code`,
      [id],
    ),
    query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM public.odg_wms_location1
       WHERE wh_code = $1 AND code IS NOT NULL AND code <> ''`,
      [detail.wh_code],
    ),
    query<{
      item_code: string;
      item_name: string | null;
      counted_unit: string | null;
      sml_unit: string | null;
      counted_qty: string;
      sml_qty: string;
      pending_qty: string;
    }>(
      `WITH counted AS (
         SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code,
                SUM(qty)::numeric AS counted_qty
         FROM public.wms_stocktake_line
         WHERE session_id = $1
         GROUP BY item_code
       ),
       universe AS (
         SELECT item_code, item_name FROM counted
         UNION
         SELECT item_code, item_name
         FROM public.wms_stocktake_snapshot
         WHERE session_id = $1
         UNION
         SELECT item_code, item_name
         FROM public.wms_stocktake_pending
         WHERE session_id = $1
       )
       SELECT
         u.item_code                          AS item_code,
         COALESCE(c.item_name, u.item_name)   AS item_name,
         c.unit_code                          AS counted_unit,
         ss.unit_code                         AS sml_unit,
         COALESCE(c.counted_qty, 0)::text     AS counted_qty,
         COALESCE(ss.snapshot_qty, 0)::text   AS sml_qty,
         COALESCE(p.pending_qty, 0)::text     AS pending_qty
       FROM (
         SELECT item_code, MAX(item_name) AS item_name
         FROM universe
         WHERE item_code IS NOT NULL
         GROUP BY item_code
       ) u
       LEFT JOIN counted c
         ON c.item_code = u.item_code
       LEFT JOIN public.wms_stocktake_snapshot ss
         ON ss.item_code = u.item_code AND ss.session_id = $1
       LEFT JOIN public.wms_stocktake_pending p
         ON p.item_code = u.item_code AND p.session_id = $1`,
      [id],
    ),
  ]);
  const locationCount = locMaster[0]?.n ?? 0;

  const summary = {
    labels: labels.length,
    counted: labels.filter((l) => l.line_count > 0).length,
    pending: labels.filter((l) => l.line_count === 0).length,
    lines: labels.reduce((s, l) => s + l.line_count, 0),
    qty: labels.reduce(
      (s, l) => s + (Number.parseFloat(l.qty_sum) || 0),
      0,
    ),
  };
  const progress =
    summary.labels === 0 ? 0 : (summary.counted / summary.labels) * 100;
  const snapshotQty = Number.parseFloat(detail.snapshot_qty) || 0;
  const itemProgress =
    detail.snapshot_items === 0
      ? 0
      : Math.min(100, (detail.counted_items / detail.snapshot_items) * 100);
  const qtyProgress =
    snapshotQty === 0 ? 0 : Math.min(100, (summary.qty / snapshotQty) * 100);

  type VarItem = {
    item_code: string;
    item_name: string | null;
    counted_unit: string | null;
    sml_unit: string | null;
    unit_code: string | null;
    counted_qty: number;
    reference_qty: number;
    variance: number;
    absVar: number;
    unit_mismatch: boolean;
  };
  const varEnriched: VarItem[] = [];
  for (const r of varianceRows) {
    const c = Number.parseFloat(r.counted_qty) || 0;
    const s = Number.parseFloat(r.sml_qty) || 0;
    const p = Number.parseFloat(r.pending_qty) || 0;
    const ref = s + p;
    const v = c - ref;
    const cu = (r.counted_unit ?? "").trim().toUpperCase();
    const su = (r.sml_unit ?? "").trim().toUpperCase();
    const mismatch = cu !== "" && su !== "" && cu !== su;
    varEnriched.push({
      item_code: r.item_code,
      item_name: r.item_name,
      counted_unit: r.counted_unit,
      sml_unit: r.sml_unit,
      unit_code: r.counted_unit ?? r.sml_unit,
      counted_qty: c,
      reference_qty: ref,
      variance: v,
      absVar: Math.abs(v),
      unit_mismatch: mismatch,
    });
  }
  const topVar = [...varEnriched]
    .filter((r) => r.counted_qty > 0 && r.absVar > 0)
    .sort((a, b) => b.absVar - a.absVar)
    .slice(0, 5);
  const countedVarItems = varEnriched.filter((r) => r.counted_qty > 0);
  const countedMatched = countedVarItems.filter((r) => r.variance === 0).length;
  const countedOver = countedVarItems.filter(
    (r) => r.reference_qty > 0 && r.variance > 0,
  ).length;
  const countedUnder = countedVarItems.filter(
    (r) => r.reference_qty > 0 && r.variance < 0,
  ).length;
  const countedOnly = countedVarItems.filter((r) => r.reference_qty === 0).length;
  const countedNetVarianceQty = countedVarItems.reduce(
    (sum, r) => sum + r.variance,
    0,
  );
  const unitMismatches = countedVarItems.filter((r) => r.unit_mismatch);
  const totalVarItems = countedVarItems.length;
  const accuracyPct =
    totalVarItems === 0 ? 100 : (countedMatched / totalVarItems) * 100;
  const hasResults = totalVarItems > 0 && summary.lines > 0;

  const isOpen = detail.status === "open";
  const isPending = detail.status === "pending_approval";
  const isClosed = detail.status === "closed";

  const nextLabel = labels.find((l) => l.line_count === 0);
  const canApprove =
    userSession.role === "manager" || userSession.role === "supervisor";
  const mainProgress =
    detail.snapshot_items > 0 ? itemProgress : progress;
  const mainProgressLabel =
    detail.snapshot_items > 0 ? "ຄວາມຄືບໜ້າທຽບ SML" : "ຄວາມຄືບໜ້າຕາມປ້າຍ";

  return (
    <StocktakeLayout wide>
      {/* Breadcrumb */}
      <nav className={`mb-3 flex flex-wrap items-center gap-2 ${stMuted}`}>
        <Link href="/stocktake" className={stNavLink}>
          ກວດນັບສິນຄ້າ
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
        <span className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          {detail.session_code}
        </span>
      </nav>

      <section className={`${stPanel} mb-4 overflow-hidden`}>
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_360px] lg:p-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className={stEyebrow}>ຮອບກວດນັບ</p>
              <StatusBadge status={detail.status} />
              {detail.blind && (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  Blind
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-white">
              {detail.name ?? "ຮອບກວດນັບ"}
            </h1>
            <div
              className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${stMuted}`}
            >
              <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                {detail.session_code}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>
                {detail.wh_code}
                {detail.wh_name ? ` (${detail.wh_name})` : ""}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span>{detail.count_date}</span>
              {detail.created_employee && (
                <>
                  <span className="text-zinc-300 dark:text-zinc-600">·</span>
                  <span>ໂດຍ {detail.created_employee}</span>
                </>
              )}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <HeroMetric
                label="SML ນັບແລ້ວ"
                value={
                  detail.snapshot_items > 0
                    ? `${detail.counted_items.toLocaleString("en-US")}/${detail.snapshot_items.toLocaleString("en-US")}`
                    : "ຍັງບໍ່ມີ"
                }
                sub={
                  detail.snapshot_items > 0
                    ? `${itemProgress.toFixed(0)}%`
                    : "snapshot"
                }
                tone={
                  itemProgress >= 90
                    ? "emerald"
                    : itemProgress >= 50
                      ? "amber"
                      : "indigo"
                }
              />
              <HeroMetric
                label="ປ້າຍ"
                value={`${summary.counted}/${summary.labels}`}
                sub={`${summary.pending} ຍັງເຫຼືອ`}
                tone={
                  summary.pending === 0 && summary.labels > 0
                    ? "emerald"
                    : "amber"
                }
              />
              <HeroMetric
                label="ລາຍການນັບ"
                value={summary.lines.toLocaleString("en-US")}
                sub={`${detail.counted_items.toLocaleString("en-US")} ລະຫັດ`}
                tone="zinc"
              />
              <HeroMetric
                label="ສ່ວນຕ່າງທີ່ນັບແລ້ວ"
                value={`${countedNetVarianceQty > 0 ? "+" : ""}${formatQty(countedNetVarianceQty)}`}
                sub={`${accuracyPct.toFixed(1)}% ກົງ`}
                tone={
                  Math.abs(countedNetVarianceQty) < 0.0001
                    ? "emerald"
                    : countedNetVarianceQty > 0
                      ? "amber"
                      : "red"
                }
              />
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  {mainProgressLabel}
                </div>
                <div className="mt-1 font-mono text-4xl font-black tabular-nums text-zinc-900 dark:text-white">
                  {mainProgress.toFixed(0)}%
                </div>
              </div>
              <div className="grid shrink-0 gap-2 text-right">
                <div className="rounded-xl bg-white px-3 py-2 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                  <div className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-white">
                    {formatQty(summary.qty)}
                  </div>
                  <div className="text-[10px] text-zinc-500">qty ນັບໄດ້</div>
                </div>
                <div
                  className={`rounded-xl px-3 py-2 ring-1 ${
                    Math.abs(countedNetVarianceQty) < 0.0001
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/25 dark:text-emerald-300 dark:ring-emerald-900/50"
                      : countedNetVarianceQty > 0
                        ? "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/25 dark:text-amber-300 dark:ring-amber-900/50"
                        : "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/25 dark:text-red-300 dark:ring-red-900/50"
                  }`}
                >
                  <div className="font-mono text-sm font-bold tabular-nums">
                    {countedNetVarianceQty > 0 ? "+" : ""}
                    {formatQty(countedNetVarianceQty)}
                  </div>
                  <div className="text-[10px] opacity-75">ສ່ວນຕ່າງທີ່ນັບແລ້ວ</div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <ProgressLine
                label={mainProgressLabel}
                value={mainProgress}
                detail={
                  detail.snapshot_items > 0
                    ? `${detail.counted_items.toLocaleString("en-US")}/${detail.snapshot_items.toLocaleString("en-US")} ລະຫັດ`
                    : `${summary.counted}/${summary.labels} ປ້າຍ`
                }
                tone="indigo"
              />
              <ProgressLine
                label="ປ້າຍກວດນັບ"
                value={progress}
                detail={`${summary.counted}/${summary.labels} ປ້າຍ`}
                tone="emerald"
              />
              {snapshotQty > 0 && (
                <ProgressLine
                  label="qty ທຽບ SML"
                  value={qtyProgress}
                  detail={`${formatQty(summary.qty)}/${formatQty(snapshotQty)}`}
                  tone="violet"
                />
              )}
            </div>

            <div className="mt-4">
              <PrimaryAction
                status={detail.status}
                canApprove={canApprove}
                sessionId={detail.session_id}
                nextLabelId={nextLabel?.label_id}
                nextLabelCode={nextLabel?.label_code}
                labelCount={summary.labels}
                countedCount={summary.counted}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Variance alert */}
      {hasResults &&
        (() => {
          const variantCount = countedOver + countedUnder + countedOnly;
          if (variantCount === 0 && unitMismatches.length === 0) return null;
          const isCritical =
            countedUnder > 0 || unitMismatches.length > 0;
          return (
            <div
              className={`mb-4 flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
                isCritical
                  ? "border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30"
                  : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className={`h-5 w-5 shrink-0 ${
                  isCritical
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              </svg>
              <div className="min-w-0 flex-1">
                <div
                  className={`text-sm font-bold ${
                    isCritical
                      ? "text-amber-900 dark:text-amber-200"
                      : "text-emerald-900 dark:text-emerald-200"
                  }`}
                >
                  {variantCount > 0
                    ? `ມີ ${variantCount} ລາຍການທີ່ນັບແລ້ວມີສ່ວນຕ່າງ`
                    : "ການນັບກົງກັນທັງໝົດ"}
                  {unitMismatches.length > 0 &&
                    ` · ${unitMismatches.length} ຫົວໜ່ວຍບໍ່ກົງ`}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-700 dark:text-zinc-300">
                  {countedOver > 0 && (
                    <span>
                      <b className="text-emerald-700 dark:text-emerald-400">
                        +{countedOver}
                      </b>{" "}
                      ສູງກວ່າ
                    </span>
                  )}
                  {countedUnder > 0 && (
                    <span>
                      <b className="text-red-700 dark:text-red-400">
                        −{countedUnder}
                      </b>{" "}
                      ຕ່ຳກວ່າ
                    </span>
                  )}
                  {countedOnly > 0 && (
                    <span>
                      <b className="text-amber-700 dark:text-amber-400">
                        {countedOnly}
                      </b>{" "}
                      ນອກ SML
                    </span>
                  )}
                  <span className="text-zinc-500">
                    · ສ່ວນຕ່າງທີ່ນັບແລ້ວ{" "}
                    <b
                      className={`font-mono tabular-nums ${
                        Math.abs(countedNetVarianceQty) < 0.0001
                          ? "text-zinc-700 dark:text-zinc-200"
                          : countedNetVarianceQty > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400"
                      }`}
                    >
                      {countedNetVarianceQty > 0 ? "+" : ""}
                      {formatQty(countedNetVarianceQty)}
                    </b>
                  </span>
                </div>
              </div>
              <Link
                href={`/stocktake/${detail.session_id}/report?filter=variance`}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  isCritical
                    ? "bg-amber-600 text-white hover:bg-amber-700"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                ເບິ່ງລາຍລະອຽດ →
              </Link>
            </div>
          );
        })()}

      {/* Tab navigation */}
      <TabNav
        active={activeTab}
        sessionId={detail.session_id}
        countBadge={summary.pending > 0 ? summary.pending : undefined}
        resultsBadge={
          countedOver + countedUnder + countedOnly + unitMismatches.length || undefined
        }
        resultsTone={
          countedUnder + unitMismatches.length > 0
            ? "amber"
            : countedOver + countedOnly > 0
              ? "emerald"
              : undefined
        }
        settingsBadge={isPending ? "!" : undefined}
      />

      {/* TAB: ກວດນັບ */}
      {activeTab === "count" && (
        <div className="space-y-4">
          <section className={`${stPanel} ${stPanelPad}`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-white">
                  ປ້າຍກວດນັບ
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {summary.counted}/{summary.labels} ນັບແລ້ວ ·{" "}
                  {summary.lines.toLocaleString("en-US")} ລາຍການ
                </p>
              </div>
            </div>
            {labels.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                <p>ຍັງບໍ່ມີປ້າຍ</p>
                {isOpen && (
                  <p className="mt-1 text-xs">ສ້າງປ້າຍດ້ານລຸ່ມເພື່ອເລີ່ມ</p>
                )}
              </div>
            ) : (
              <LabelGrid
                sessionId={detail.session_id}
                labels={labels}
                canEdit={isOpen}
              />
            )}
          </section>

          {isOpen && (
            <details
              className={`${stPanel} group overflow-hidden`}
              open={summary.labels === 0}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium text-zinc-700 transition hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400">
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
                </svg>
                ນຳເຂົ້າ Excel
                <span className="text-xs text-zinc-500">
                  · ສ້າງປ້າຍ ແລະ ບັນທຶກການນັບພ້ອມກັນ
                </span>
                <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-zinc-100 px-5 pb-5 pt-4 dark:border-zinc-800">
                <ExcelImport sessionId={detail.session_id} />
              </div>
            </details>
          )}

          {isOpen && (
            <details
              className={`${stPanel} group overflow-hidden`}
              open={summary.labels === 0}
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium text-zinc-700 transition hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400">
                <PlusIcon className="h-4 w-4" />
                ສ້າງປ້າຍກວດນັບ
                {locationCount > 0 && (
                  <span className="text-xs text-zinc-500">
                    · {locationCount} locations
                  </span>
                )}
                <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
              </summary>
              <div className="border-t border-zinc-100 px-5 pb-5 pt-4 dark:border-zinc-800">
                {locationCount > 0 ? (
                  <>
                    <LabelFromLocation
                      sessionId={detail.session_id}
                      locationCount={locationCount}
                    />
                    <details className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                      <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                        ຫຼື ສ້າງດ້ວຍ prefix + ຊ່ວງເລກ
                      </summary>
                      <div className="mt-3">
                        <LabelBulkCreate sessionId={detail.session_id} />
                      </div>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                      ສາງນີ້ບໍ່ມີ location ໃນ master.
                    </div>
                    <LabelBulkCreate sessionId={detail.session_id} />
                  </>
                )}
              </div>
            </details>
          )}
        </div>
      )}

      {/* TAB: ຜົນ */}
      {activeTab === "results" && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
          {/* Live count results */}
          {!hasResults && (
            <div className={`${stPanel} ${stPanelPad} text-center text-sm text-zinc-500 dark:text-zinc-400`}>
              ຍັງບໍ່ມີຜົນກວດນັບທີ່ຈະປຽບທຽບ. ໄປແທັບ <b>ກວດນັບ</b> ເພື່ອເລີ່ມ.
            </div>
          )}
          {hasResults && (
            <section className={`${stPanel} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                <h3 className={stEyebrow}>ຜົນການກວດນັບ</h3>
                <Link
                  href={`/stocktake/${detail.session_id}/summary`}
                  className="text-[10px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  ສະຫຼຸບເຕັມ →
                </Link>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    ຄວາມຖືກຕ້ອງ
                  </span>
                  <span
                    className={`font-mono text-xl font-bold tabular-nums ${
                      accuracyPct >= 95
                        ? "text-emerald-600 dark:text-emerald-400"
                        : accuracyPct >= 80
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {accuracyPct.toFixed(1)}%
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <ResultChip label="ກົງກັນ" value={countedMatched} tone="ok" />
                  <ResultChip
                    label="ສູງກວ່າ"
                    value={countedOver}
                    tone="ok"
                    sign="+"
                  />
                  <ResultChip
                    label="ຕ່ຳກວ່າ"
                    value={countedUnder}
                    tone="bad"
                  />
                  <ResultChip
                    label="ນອກ SML"
                    value={countedOnly}
                    tone="warn"
                    sign="+"
                  />
                  <ResultChip
                    label="ສ່ວນຕ່າງທີ່ນັບແລ້ວ"
                    value={countedNetVarianceQty}
                    tone={
                      Math.abs(countedNetVarianceQty) < 0.0001
                        ? "neutral"
                        : countedNetVarianceQty > 0
                          ? "ok"
                          : "bad"
                    }
                    isQty
                  />
                </div>

                {unitMismatches.length > 0 && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-800/60">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <Link
                        href={`/stocktake/${detail.session_id}/units`}
                        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-800 hover:underline dark:text-amber-300"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                        </svg>
                        ຫົວໜ່ວຍບໍ່ກົງກັບ SML
                      </Link>
                      <span className="font-mono text-xs font-bold text-amber-700 dark:text-amber-300">
                        {unitMismatches.length}
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {unitMismatches.slice(0, 4).map((r) => (
                        <li
                          key={`um-${r.item_code}`}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <span className="truncate font-mono font-semibold text-zinc-800 dark:text-zinc-100">
                            {r.item_code}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] tabular-nums">
                            <span className="text-zinc-600 dark:text-zinc-300">
                              {r.counted_unit ?? "—"}
                            </span>
                            <span className="mx-1 text-zinc-400">≠</span>
                            <span className="text-zinc-500">{r.sml_unit}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={`/stocktake/${detail.session_id}/units`}
                      className="mt-1 block text-[10px] font-semibold text-amber-800 hover:underline dark:text-amber-300"
                    >
                      {unitMismatches.length > 4
                        ? `+ ${unitMismatches.length - 4} ລາຍການອື່ນ → ກວດສອບ ແລະ ແກ້ໄຂ`
                        : "ກວດສອບ ແລະ ແກ້ໄຂ →"}
                    </Link>
                  </div>
                )}

                {topVar.length > 0 && (
                  <div>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      ສ່ວນຕ່າງສຸງສຸດ
                    </div>
                    <ul className="space-y-1">
                      {topVar.map((r) => (
                        <li key={r.item_code}>
                          <Link
                            href={`/stocktake/${detail.session_id}/report?q=${encodeURIComponent(r.item_code)}`}
                            className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-2 py-1 text-[11px] transition hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 dark:bg-zinc-800/40 dark:hover:bg-indigo-950/30 dark:hover:ring-indigo-800/60"
                          >
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                              {r.item_code}
                            </div>
                            {r.item_name && (
                              <div className="truncate text-[10px] text-zinc-500">
                                {r.item_name}
                              </div>
                            )}
                          </div>
                          <div
                            className={`shrink-0 text-right font-mono text-xs font-bold tabular-nums ${
                              r.variance > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {r.variance > 0 ? "+" : ""}
                            {formatQty(r.variance)}
                            {r.unit_code && (
                              <span
                                className={`ml-0.5 text-[9px] font-normal ${
                                  r.unit_mismatch
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-zinc-400"
                                }`}
                                title={
                                  r.unit_mismatch
                                    ? `ກວດນັບ: ${r.counted_unit ?? "—"} · SML: ${r.sml_unit ?? "—"}`
                                    : undefined
                                }
                              >
                                {r.unit_code}
                                {r.unit_mismatch && " ⚠"}
                              </span>
                            )}
                          </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            {isOpen && (
              <div className={`${stPanel} ${stPanelPad}`}>
                <SnapshotPanel
                  sessionId={detail.session_id}
                  snapshotItems={detail.snapshot_items}
                  pendingItems={detail.pending_items}
                  pendingBills={detail.pending_bills}
                  countedLines={summary.lines}
                />
              </div>
            )}

            {(summary.lines > 0 || summary.labels > 0) && (
              <div className={`${stPanel} overflow-hidden`}>
                <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                  <h3 className={stEyebrow}>ລາຍງານ ແລະ ພິມ</h3>
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-3 py-3">
                  {summary.lines > 0 && (
                    <SecondaryActionLink
                      href={`/stocktake/${detail.session_id}/summary`}
                      label="ສະຫຼຸບ"
                    />
                  )}
                  {summary.lines > 0 && (
                    <SecondaryActionLink
                      href={`/stocktake/${detail.session_id}/report`}
                      label="ປຽບທຽບ"
                    />
                  )}
                  {summary.lines > 0 && (
                    <SecondaryActionLink
                      href={`/stocktake/${detail.session_id}/details`}
                      label="ລາຍລະອຽດ"
                    />
                  )}
                  {summary.labels > 0 && (
                    <SecondaryActionLink
                      href={`/stocktake/${detail.session_id}/print`}
                      label="ພິມປ້າຍ"
                    />
                  )}
                  {unitMismatches.length > 0 && (
                    <SecondaryActionLink
                      href={`/stocktake/${detail.session_id}/units`}
                      label={`ກວດສອບຫົວໜ່ວຍ (${unitMismatches.length})`}
                    />
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}

      {/* TAB: ຕັ້ງຄ່າ */}
      {activeTab === "settings" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className={`${stPanel} overflow-hidden`}>
              <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                <h3 className={stEyebrow}>ການດຳເນີນ</h3>
              </div>
              <div className="px-3 py-3">
                <SessionActions
                  sessionId={detail.session_id}
                  status={detail.status}
                  blind={detail.blind}
                  role={userSession.role}
                />
              </div>
            </div>

            {(detail.note || detail.approval_note) && (
              <div className="space-y-3">
                {detail.note && (
                  <div className={`${stPanel} ${stPanelPad}`}>
                    <h3 className={stEyebrow}>ບັນທຶກ</h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                      {detail.note}
                    </p>
                  </div>
                )}
                {detail.approval_note && (
                  <div
                    className={`${stPanelPad} rounded-2xl border border-amber-200/70 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/20`}
                  >
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
                      ບັນທຶກອະນຸມັດ
                    </h3>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
                      {detail.approval_note}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className={`${stPanel} overflow-hidden`}>
              <div className="border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
                <h3 className={stEyebrow}>ປະຫວັດ ແລະ ການອະນຸມັດ</h3>
              </div>
              <div className="px-5 pb-5 pt-4">
                <ol className="relative space-y-5 border-l-2 border-zinc-100 pl-6 dark:border-zinc-800">
                  <AuditStep
                    label="ສ້າງຮອບ"
                    employee={detail.created_employee}
                    at={detail.created_at}
                    done
                  />
                  {(detail.submitted_at || isPending || isClosed) && (
                    <AuditStep
                      label="ສົ່ງເພື່ອອະນຸມັດ"
                      employee={detail.submitted_employee}
                      at={detail.submitted_at}
                      done={!!detail.submitted_at}
                      pending={isPending}
                    />
                  )}
                  {(isClosed || isPending) && (
                    <AuditStep
                      label="ອະນຸມັດ ແລະ ປິດ"
                      employee={
                        detail.approved_employee ?? detail.closed_employee
                      }
                      at={detail.closed_at}
                      done={isClosed}
                      pending={isPending}
                    />
                  )}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}
    </StocktakeLayout>
  );
}

/* ---------- Sub-components ---------- */

function StatusBadge({
  status,
}: {
  status: "open" | "pending_approval" | "closed";
}) {
  const config = {
    open: {
      chip: "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
      dot: "bg-emerald-500",
      label: "ກຳລັງດຳເນີນ",
    },
    pending_approval: {
      chip: "bg-amber-50 text-amber-700 ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/50",
      dot: "bg-amber-500",
      label: "ລໍຖ້າອະນຸມັດ",
    },
    closed: {
      chip: "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-300 dark:ring-zinc-700",
      dot: "bg-zinc-400",
      label: "ປິດແລ້ວ",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${config.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "amber" | "indigo" | "red" | "zinc";
}) {
  const toneMap = {
    emerald:
      "border-emerald-200 bg-emerald-50/70 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300",
    amber:
      "border-amber-200 bg-amber-50/70 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300",
    indigo:
      "border-indigo-200 bg-indigo-50/70 text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-300",
    red: "border-red-200 bg-red-50/70 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300",
    zinc: "border-zinc-200 bg-zinc-50/80 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950/30 dark:text-zinc-300",
  } as const;
  return (
    <div className={`rounded-xl border px-3 py-3 ${toneMap[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-75">
        {label}
      </div>
      <div className="mt-1 font-mono text-lg font-black tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-medium opacity-75">{sub}</div>
    </div>
  );
}

function ProgressLine({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "indigo" | "emerald" | "violet";
}) {
  const toneMap = {
    indigo: "from-sky-400 to-indigo-500",
    emerald: "from-emerald-400 to-teal-500",
    violet: "from-violet-400 to-fuchsia-500",
  } as const;
  const width = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px]">
        <span className="font-medium text-zinc-500 dark:text-zinc-400">
          {label}
        </span>
        <span className="font-mono tabular-nums text-zinc-700 dark:text-zinc-200">
          {detail}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200/70 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${toneMap[tone]} transition-all duration-500`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function PrimaryAction({
  status,
  canApprove,
  sessionId,
  nextLabelId,
  nextLabelCode,
  labelCount,
  countedCount,
}: {
  status: "open" | "pending_approval" | "closed";
  canApprove: boolean;
  sessionId: number;
  nextLabelId: number | undefined;
  nextLabelCode: string | undefined;
  labelCount: number;
  countedCount: number;
}) {
  if (status === "open") {
    if (labelCount === 0) {
      return (
        <div
          className="rounded-xl border border-dashed border-zinc-300 px-4 py-3 text-center text-sm font-medium text-zinc-500 dark:border-zinc-700 dark:text-zinc-400"
        >
          ສ້າງປ້າຍກວດນັບກ່ອນ ແລ້ວເລີ່ມຕົ້ນ
        </div>
      );
    }
    if (nextLabelId !== undefined) {
      return (
        <Link
          href={`/stocktake/${sessionId}/count/${nextLabelId}`}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-white px-5 py-4 transition hover:border-indigo-300 hover:shadow-md dark:border-indigo-900/50 dark:from-indigo-950/40 dark:to-zinc-900/40 dark:hover:border-indigo-800"
        >
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-indigo-600 dark:text-indigo-300">
              {countedCount === 0 ? "ເລີ່ມນັບ" : "ສືບຕໍ່ນັບ"}
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-zinc-900 dark:text-white">
              {nextLabelCode}
            </p>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition group-hover:bg-indigo-500">
            <ChevronRightIcon className="h-5 w-5" />
          </span>
        </Link>
      );
    }
    return (
      <div
        className={`flex items-center gap-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/60 px-5 py-4 text-sm font-medium text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-300`}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white">
          <CheckIcon className="h-4 w-4" />
        </span>
        ນັບຄົບທຸກປ້າຍແລ້ວ — ສົ່ງເພື່ອອະນຸມັດ
      </div>
    );
  }
  if (status === "pending_approval") {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-center text-sm font-medium text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300"
      >
        {canApprove
          ? "ກວດສອບ ແລະ ອະນຸມັດໄດ້ທີ່ປຸ່ມດ້ານລຸ່ມ"
          : "ລໍຖ້າ supervisor ອະນຸມັດ"}
      </div>
    );
  }
  return (
    <Link
      href={`/stocktake/${sessionId}/summary`}
      className="group flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 transition hover:border-indigo-200 hover:bg-indigo-50/60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"
    >
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        ເບິ່ງລາຍງານສະຫຼຸບ
      </span>
      <ChevronRightIcon className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
    </Link>
  );
}

function TabNav({
  active,
  sessionId,
  countBadge,
  resultsBadge,
  resultsTone,
  settingsBadge,
}: {
  active: TabKey;
  sessionId: number;
  countBadge?: number;
  resultsBadge?: number;
  resultsTone?: "emerald" | "amber";
  settingsBadge?: string;
}) {
  const tabs: {
    key: TabKey;
    label: string;
    badge?: string | number;
    tone?: "emerald" | "amber" | "indigo";
  }[] = [
    {
      key: "count",
      label: "ກວດນັບ",
      badge: countBadge,
      tone: "indigo",
    },
    {
      key: "results",
      label: "ຜົນ ແລະ ສ່ວນຕ່າງ",
      badge: resultsBadge,
      tone: resultsTone,
    },
    {
      key: "settings",
      label: "ຕັ້ງຄ່າ ແລະ ປະຫວັດ",
      badge: settingsBadge,
      tone: "amber",
    },
  ];

  return (
    <nav
      role="tablist"
      className="mb-4 flex flex-wrap items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <Link
            key={t.key}
            href={
              t.key === "count"
                ? `/stocktake/${sessionId}`
                : `/stocktake/${sessionId}?tab=${t.key}`
            }
            role="tab"
            aria-selected={isActive}
            className={`group relative inline-flex items-center gap-2 rounded-t-lg px-4 py-2.5 text-sm font-semibold transition ${
              isActive
                ? "text-indigo-700 dark:text-indigo-300"
                : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && (
              <span
                className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${
                  t.tone === "amber"
                    ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                    : t.tone === "emerald"
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                      : "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                }`}
              >
                {t.badge}
              </span>
            )}
            {isActive && (
              <span
                aria-hidden="true"
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-indigo-500"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function ResultChip({
  label,
  value,
  tone,
  sign,
  isQty,
}: {
  label: string;
  value: number;
  tone: "ok" | "warn" | "bad" | "neutral";
  sign?: "+";
  isQty?: boolean;
}) {
  const toneMap = {
    ok: "text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60",
    warn: "text-amber-700 dark:text-amber-300 ring-amber-200 dark:ring-amber-800/60",
    bad: "text-red-700 dark:text-red-300 ring-red-200 dark:ring-red-800/60",
    neutral: "text-zinc-700 dark:text-zinc-300 ring-zinc-200 dark:ring-zinc-700",
  } as const;
  const dotMap = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    neutral: "bg-zinc-400",
  } as const;
  const display = isQty
    ? `${value > 0 ? "+" : ""}${formatQty(value)}`
    : `${sign && value > 0 ? sign : ""}${value}`;
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1 ring-1 ${toneMap[tone]} dark:bg-zinc-900`}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-600 dark:text-zinc-300">
        <span className={`h-1.5 w-1.5 rounded-full ${dotMap[tone]}`} />
        {label}
      </span>
      <span className="font-mono text-xs font-bold tabular-nums">{display}</span>
    </div>
  );
}

function SecondaryActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 rounded-xl border border-zinc-200/70 bg-white/80 px-3.5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm transition hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/30 dark:hover:text-indigo-300"
    >
      <span className="truncate">{label}</span>
      <ChevronRightIcon className="h-3.5 w-3.5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
    </Link>
  );
}

function AuditStep({
  label,
  employee,
  at,
  done,
  pending,
}: {
  label: string;
  employee: string | null;
  at: string | null;
  done: boolean;
  pending?: boolean;
}) {
  return (
    <li className="relative">
      <span
        className={`absolute -left-[29px] mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-900 ${
          done
            ? "bg-emerald-500 text-white"
            : pending
              ? "bg-amber-500 text-white"
              : "bg-zinc-200 dark:bg-zinc-700"
        }`}
      >
        {done && <CheckIcon className="h-3 w-3" />}
        {pending && <span className="text-[8px] font-bold">!</span>}
      </span>
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </h4>
      <p className="mt-0.5 text-sm font-medium text-zinc-900 dark:text-white">
        {employee ?? (done || pending ? "—" : "ຍັງບໍ່ໄດ້ດຳເນີນ")}
      </p>
      {at && (
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {at.slice(0, 16)}
        </p>
      )}
    </li>
  );
}

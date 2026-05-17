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
  stTitleLg,
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

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
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

  const [labels, locMaster] = await Promise.all([
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

  const isOpen = detail.status === "open";
  const isPending = detail.status === "pending_approval";
  const isClosed = detail.status === "closed";

  const nextLabel = labels.find((l) => l.line_count === 0);
  const canApprove =
    userSession.role === "manager" || userSession.role === "supervisor";

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

      {/* Hero: title + meta + progress (one tight card) */}
      <section className={`${stPanel} mb-4 overflow-hidden`}>
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="min-w-0 flex-1">
            <p className={stEyebrow}>ຮອບກວດນັບ</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className={stTitleLg}>{detail.name ?? "ຮອບກວດນັບ"}</h1>
              <StatusBadge status={detail.status} />
              {detail.blind && (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                  Blind
                </span>
              )}
            </div>
            <div
              className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs ${stMuted}`}
            >
              <span className="font-mono">{detail.session_code}</span>
              <span className="text-zinc-300 dark:text-zinc-600">·</span>
              <span className="truncate">
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
          </div>
        </div>

        {/* Progress strip */}
        <div className="border-t border-zinc-100 bg-zinc-50/40 px-5 py-3 sm:px-6 dark:border-zinc-800 dark:bg-zinc-950/30">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-[11px]">
                <span className="font-medium text-zinc-500 dark:text-zinc-400">
                  ຄວາມຄືບໜ້າ
                </span>
                <span className="font-mono text-zinc-600 dark:text-zinc-300">
                  <span className="font-bold text-zinc-900 dark:text-white">
                    {summary.counted}
                  </span>
                  <span className="text-zinc-400">/{summary.labels}</span> ປ້າຍ
                  <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">
                    ·
                  </span>
                  <span className="text-amber-700 dark:text-amber-400">
                    {summary.pending}
                  </span>{" "}
                  ຍັງເຫຼືອ
                  <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">
                    ·
                  </span>
                  <span className="text-zinc-700 dark:text-zinc-200">
                    {summary.lines.toLocaleString("en-US")}
                  </span>{" "}
                  ລາຍ
                  <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">
                    ·
                  </span>
                  <span className="font-bold tabular-nums text-indigo-600 dark:text-indigo-300">
                    {formatQty(summary.qty)}
                  </span>{" "}
                  ລວມ
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-200/60 dark:bg-zinc-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isClosed
                      ? "bg-zinc-400 dark:bg-zinc-500"
                      : "bg-gradient-to-r from-emerald-400 to-teal-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-2xl font-bold tabular-nums leading-none text-zinc-900 dark:text-white">
                {progress.toFixed(0)}%
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Primary CTA (full width, prominent) */}
      <div className="mb-4">
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

      {/* 2-column dashboard */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left: Main work (Labels + Create) */}
        <div className="space-y-4 lg:col-span-2">
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

          {/* Excel import (open only) */}
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

          {/* Create labels (open only) */}
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

        {/* Right: Sidebar (sticky on lg) */}
        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {/* Reference / Snapshot — open sessions only */}
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

          {/* Workflow + quick links */}
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
            {(summary.lines > 0 || summary.labels > 0) && (
              <>
                <div className="border-t border-zinc-100 px-4 py-2 dark:border-zinc-800">
                  <h3 className={stEyebrow}>ລາຍງານ ແລະ ພິມ</h3>
                </div>
                <div className="grid grid-cols-2 gap-1.5 px-3 pb-3">
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
                </div>
              </>
            )}
          </div>

          {/* Notes */}
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

          {/* Audit trail */}
          <details className={`${stPanel} group overflow-hidden`}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium text-zinc-700 transition hover:text-indigo-600 dark:text-zinc-300 dark:hover:text-indigo-400">
              ປະຫວັດ ແລະ ການອະນຸມັດ
              <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-zinc-400 transition-transform group-open:rotate-90" />
            </summary>
            <div className="border-t border-zinc-100 px-5 pb-5 pt-4 dark:border-zinc-800">
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
          </details>
        </aside>
      </div>
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
          className={`${stPanel} px-5 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400`}
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
        className={`${stPanel} px-5 py-4 text-center text-sm text-amber-700 dark:text-amber-300`}
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
      className={`${stPanel} group flex items-center justify-between px-5 py-4 transition hover:border-indigo-200 hover:bg-indigo-50/30 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20`}
    >
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        ເບິ່ງລາຍງານສະຫຼຸບ
      </span>
      <ChevronRightIcon className="h-4 w-4 text-zinc-400 transition group-hover:translate-x-0.5 group-hover:text-indigo-500" />
    </Link>
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

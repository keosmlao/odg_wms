import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import StocktakeLayout from "../_components/StocktakeLayout";
import {
  stEyebrow,
  stMuted,
  stNavLink,
  stPanel,
  stPanelInset,
  stPanelPad,
  stTitleLg,
} from "../_components/stocktake-theme";
import SessionActions from "./SessionActions";
import LabelBulkCreate from "./LabelBulkCreate";
import LabelFromLocation from "./LabelFromLocation";
import LabelGrid from "./LabelGrid";

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
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ບໍ່ມີສິດເຂົ້າເຖິງ WMS
        </p>
      </div>
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
          WHERE ss.session_id = s.session_id) AS snapshot_items
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
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-900 dark:text-red-200">
          ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້
        </p>
      </div>
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
    <StocktakeLayout>
      <nav className={`mb-5 flex flex-wrap items-center gap-2 ${stMuted}`}>
        <Link href="/stocktake" className={stNavLink}>
          ກວດນັບສິນຄ້າ
        </Link>
        <span className="text-slate-300 dark:text-slate-600">/</span>
        <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-100">
          {detail.session_code}
        </span>
      </nav>

      <div className="space-y-5">
      <div className={`${stPanel} overflow-hidden`}>
        <div className={stPanelPad}>
          <p className={stEyebrow}>ຮອບກວດນັບ</p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className={stTitleLg}>{detail.name ?? "ຮອບກວດນັບ"}</h1>
                <StatusBadge status={detail.status} blind={detail.blind} />
              </div>
              <div className={`mt-2 flex flex-wrap items-center gap-2 ${stMuted}`}>
                <span className="font-mono">{detail.session_code}</span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>
                  {detail.wh_code}{detail.wh_name ? ` (${detail.wh_name})` : ""}
                </span>
                <span className="text-slate-300 dark:text-slate-600">·</span>
                <span>{detail.count_date}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {detail.blind && (
                <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  Blind
                </span>
              )}
            </div>
          </div>
        </div>
        <div className={stPanelInset}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard label="ປ້າຍທັງໝົດ" value={summary.labels} color="slate" />
        <StatCard label="ນັບແລ້ວ" value={summary.counted} color="emerald" />
        <StatCard label="ຍັງບໍ່ໄດ້ນັບ" value={summary.pending} color="amber" />
        <StatCard label="ຈຳນວນລວມ" value={formatQty(summary.qty)} color="indigo" />
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className={`${stPanel} ${stPanelPad}`}>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-500">ຄວາມຄືບໜ້າ</h3>
          <span className="text-sm font-bold text-slate-900 dark:text-white">
            {progress.toFixed(0)}%
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 text-xs text-slate-500">
          {summary.counted} / {summary.labels} ປ້າຍ · {summary.lines} ລາຍການ
        </div>
      </div>

      {/* Primary action */}
      <div className={`${stPanel} p-1`}>
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

      {/* Workflow actions */}
      <div className={`${stPanel} p-1`}>
        <SessionActions
          sessionId={detail.session_id}
          status={detail.status}
          blind={detail.blind}
          role={userSession.role}
        />
      </div>

      {/* Secondary actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.lines > 0 && (
          <SecondaryActionLink href={`/stocktake/${detail.session_id}/summary`} label="ສະຫຼຸບ" />
        )}
        {summary.lines > 0 && (
          <SecondaryActionLink href={`/stocktake/${detail.session_id}/report`} label="ປຽບທຽບ SML" />
        )}
        {summary.lines > 0 && (
          <SecondaryActionLink href={`/stocktake/${detail.session_id}/details`} label="ລາຍລະອຽດ" />
        )}
        {summary.labels > 0 && (
          <SecondaryActionLink href={`/stocktake/${detail.session_id}/print`} label="ພິມປ້າຍ" />
        )}
      </div>

      {/* Note / Approval note */}
      {detail.note && (
        <div className={`${stPanel} ${stPanelPad} bg-slate-50/80 dark:bg-slate-800/30`}>
          <h3 className="text-sm font-medium text-slate-500">ບັນທຶກ</h3>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
            {detail.note}
          </p>
        </div>
      )}
      {detail.approval_note && (
        <div className={`${stPanel} ${stPanelPad} border-amber-200/80 bg-amber-50/90 dark:border-amber-900/40 dark:bg-amber-950/25`}>
          <h3 className="text-sm font-medium text-amber-700 dark:text-amber-300">ບັນທຶກອະນຸມັດ</h3>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-200 whitespace-pre-wrap">
            {detail.approval_note}
          </p>
        </div>
      )}

      {/* Labels section */}
      <section className={`${stPanel} ${stPanelPad}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
            ປ້າຍກວດນັບ
          </h2>
          <span className="text-sm text-slate-500">
            {summary.counted}/{summary.labels} ນັບແລ້ວ
          </span>
        </div>
        {labels.length === 0 ? (
          <div className="py-12 text-center text-slate-500">
            <p>ຍັງບໍ່ມີປ້າຍ</p>
            {isOpen && <p className="text-xs mt-1">ສ້າງປ້າຍດ້ານລຸ່ມ</p>}
          </div>
        ) : (
          <LabelGrid
            sessionId={detail.session_id}
            labels={labels}
            canEdit={isOpen}
          />
        )}
      </section>

      {/* Create labels (open only) */}
      {isOpen && (
        <details
          className={`${stPanel} group overflow-hidden`}
          open={summary.labels === 0}
        >
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">
            + ສ້າງປ້າຍກວດນັບ
            {locationCount > 0 && (
              <span className="ml-2 text-xs text-slate-500">
                ({locationCount} locations)
              </span>
            )}
          </summary>
          <div className="border-t border-slate-100 dark:border-slate-800 px-5 pb-5 pt-4">
            {locationCount > 0 ? (
              <>
                <LabelFromLocation
                  sessionId={detail.session_id}
                  locationCount={locationCount}
                />
                <details className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                    ຫຼື ສ້າງດ້ວຍ prefix + ຊ່ວງເລກ
                  </summary>
                  <div className="mt-3">
                    <LabelBulkCreate sessionId={detail.session_id} />
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="mb-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                  ສາງນີ້ບໍ່ມີ location ໃນ master.
                </div>
                <LabelBulkCreate sessionId={detail.session_id} />
              </>
            )}
          </div>
        </details>
      )}

      {/* Audit trail */}
      <details className={`${stPanel} group overflow-hidden`}>
        <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400">
          ປະຫວັດ ແລະ ການອະນຸມັດ
        </summary>
        <div className="border-t border-slate-100 dark:border-slate-800 px-5 pb-5 pt-4">
          <ol className="relative space-y-6 border-l-2 border-slate-100 dark:border-slate-800 pl-6">
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
                employee={detail.approved_employee ?? detail.closed_employee}
                at={detail.closed_at}
                done={isClosed}
                pending={isPending}
              />
            )}
          </ol>
        </div>
      </details>
      </div>
    </StocktakeLayout>
  );
}

/* ---------- Sub-components (redesigned) ---------- */

function StatusBadge({
  status,
  blind,
}: {
  status: "open" | "pending_approval" | "closed";
  blind: boolean;
}) {
  const config = {
    open: {
      bg: "bg-emerald-50 dark:bg-emerald-950",
      text: "text-emerald-700 dark:text-emerald-300",
      ring: "ring-emerald-200 dark:ring-emerald-900",
      label: "ກຳລັງດຳເນີນ",
    },
    pending_approval: {
      bg: "bg-amber-50 dark:bg-amber-950",
      text: "text-amber-700 dark:text-amber-300",
      ring: "ring-amber-200 dark:ring-amber-900",
      label: "ລໍຖ້າອະນຸມັດ",
    },
    closed: {
      bg: "bg-slate-100 dark:bg-slate-800",
      text: "text-slate-600 dark:text-slate-400",
      ring: "ring-slate-200 dark:ring-slate-700",
      label: "ປິດແລ້ວ",
    },
  }[status];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${config.bg} ${config.text} ${config.ring}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
      {blind && " · Blind"}
    </span>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: "slate" | "emerald" | "amber" | "indigo";
}) {
  const colorMap = {
    slate: "bg-slate-50 dark:bg-slate-800/50",
    emerald: "bg-emerald-50 dark:bg-emerald-950/30",
    amber: "bg-amber-50 dark:bg-amber-950/30",
    indigo: "bg-indigo-50 dark:bg-indigo-950/30",
  };
  return (
    <div className={`rounded-xl p-4 ${colorMap[color]}`}>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
        {value}
      </p>
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
        <div className="px-5 py-4 text-center text-sm text-slate-500">
          ສ້າງປ້າຍກວດນັບກ່ອນ ແລ້ວເລີ່ມຕົ້ນ
        </div>
      );
    }
    if (nextLabelId !== undefined) {
      return (
        <Link
          href={`/stocktake/${sessionId}/count/${nextLabelId}`}
          className="flex items-center justify-between px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-2xl"
        >
          <div>
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {countedCount === 0 ? "ເລີ່ມນັບ" : "ສືບຕໍ່ນັບ"}
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-white">
              {nextLabelCode}
            </p>
          </div>
          <span className="text-2xl text-slate-300 transition group-hover:text-indigo-500">→</span>
        </Link>
      );
    }
    return (
      <div className="px-5 py-4 text-center text-sm text-emerald-700 dark:text-emerald-300">
        ✓ ນັບຄົບທຸກປ້າຍແລ້ວ — ສົ່ງເພື່ອອະນຸມັດ
      </div>
    );
  }
  if (status === "pending_approval") {
    return (
      <div className="px-5 py-4 text-center text-sm text-amber-700 dark:text-amber-300">
        {canApprove
          ? "ກວດສອບ ແລະ ອະນຸມັດໄດ້ທີ່ປຸ່ມດ້ານລຸ່ມ"
          : "ລໍຖ້າ supervisor ອະນຸມັດ"}
      </div>
    );
  }
  return (
    <Link
      href={`/stocktake/${sessionId}/summary`}
      className="flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-2xl transition"
    >
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        ເບິ່ງລາຍງານສະຫຼຸບ
      </span>
      <span className="text-xl text-slate-300">→</span>
    </Link>
  );
}

function SecondaryActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-xl border border-slate-200/80 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition hover:border-indigo-200 hover:bg-indigo-50/50 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:border-indigo-900 dark:hover:bg-indigo-950/30`}
    >
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <span className="text-slate-400">→</span>
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
        className={`absolute -left-[29px] mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-white dark:ring-slate-900 ${
          done
            ? "bg-emerald-500 text-white"
            : pending
              ? "bg-amber-500 text-white"
              : "bg-slate-200 dark:bg-slate-700"
        }`}
      >
        {done && (
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        )}
        {pending && <span className="text-[8px] font-bold">!</span>}
      </span>
      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </h4>
      <p className="mt-0.5 text-sm text-slate-900 dark:text-white">
        {employee ?? (done || pending ? "—" : "ຍັງບໍ່ໄດ້ດຳເນີນ")}
      </p>
      {at && <p className="text-xs text-slate-500">{at.slice(0, 16)}</p>}
    </li>
  );
}
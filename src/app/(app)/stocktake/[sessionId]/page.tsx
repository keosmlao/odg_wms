import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
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

  // First uncounted label — target for "continue counting" action
  const nextLabel = labels.find((l) => l.line_count === 0);
  const canApprove =
    userSession.role === "manager" || userSession.role === "supervisor";

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-12">
      {/* Hero with gradient background */}
      <header className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 p-6 shadow-lg shadow-indigo-500/20 sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-20 h-64 w-64 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-fuchsia-300/15 blur-3xl"
        />
        <Link
          href="/stocktake"
          className="relative inline-flex items-center gap-1 text-xs font-medium text-white/80 hover:text-white"
        >
          ← ກວດນັບສິນຄ້າ
        </Link>
        <div className="relative mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm sm:text-4xl">
              {detail.name ?? "ຮອບກວດນັບ"}
            </h1>
            <p className="mt-1.5 font-mono text-xs text-white/80">
              {detail.session_code} · {detail.wh_code}
              {detail.wh_name ? ` · ${detail.wh_name}` : ""} ·{" "}
              {detail.count_date}
            </p>
          </div>
          <StatusPill status={detail.status} blind={detail.blind} />
        </div>
      </header>

      {/* Progress card with vibrant fill */}
      <section className="overflow-hidden rounded-2xl bg-white p-5 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              ຄວາມຄືບໜ້າ
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text font-mono text-4xl font-bold tabular-nums text-transparent">
                {summary.counted}
              </span>
              <span className="text-base text-zinc-500">
                / {summary.labels} ປ້າຍ
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              ນັບໄດ້ລວມ
            </div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-900 dark:text-zinc-50">
              {formatQty(summary.qty)}
            </div>
            <div className="text-[10px] text-zinc-500">
              {summary.lines.toLocaleString("en-US")} ລາຍການ
            </div>
          </div>
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 shadow-sm shadow-emerald-500/40 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-zinc-500">
          <span className="font-semibold text-emerald-700 dark:text-emerald-400">
            {progress.toFixed(0)}% ສຳເລັດ
          </span>
          <span>ຍັງເຫຼືອ {summary.pending} ປ້າຍ</span>
        </div>
      </section>

      {/* Primary action — context-sensitive */}
      <PrimaryAction
        status={detail.status}
        canApprove={canApprove}
        sessionId={detail.session_id}
        nextLabelId={nextLabel?.label_id}
        nextLabelCode={nextLabel?.label_code}
        labelCount={summary.labels}
        countedCount={summary.counted}
      />

      {/* Workflow actions (state transitions) */}
      <SessionActions
        sessionId={detail.session_id}
        status={detail.status}
        blind={detail.blind}
        role={userSession.role}
      />

      {/* Secondary actions — colorful icon cards */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.lines > 0 && (
          <SecondaryAction
            href={`/stocktake/${detail.session_id}/summary`}
            label="ສະຫຼຸບ"
            icon="📊"
            gradient="from-violet-100 to-purple-100 dark:from-violet-950/40 dark:to-purple-950/40"
            iconBg="bg-violet-500"
          />
        )}
        {summary.lines > 0 && (
          <SecondaryAction
            href={`/stocktake/${detail.session_id}/report`}
            label="ປຽບທຽບ SML"
            icon="⚖️"
            gradient="from-blue-100 to-cyan-100 dark:from-blue-950/40 dark:to-cyan-950/40"
            iconBg="bg-blue-500"
          />
        )}
        {summary.lines > 0 && (
          <SecondaryAction
            href={`/stocktake/${detail.session_id}/details`}
            label="ລາຍລະອຽດ"
            icon="📋"
            gradient="from-emerald-100 to-teal-100 dark:from-emerald-950/40 dark:to-teal-950/40"
            iconBg="bg-emerald-500"
          />
        )}
        {summary.labels > 0 && (
          <SecondaryAction
            href={`/stocktake/${detail.session_id}/print`}
            label="ພິມປ້າຍ"
            icon="🖨️"
            gradient="from-amber-100 to-orange-100 dark:from-amber-950/40 dark:to-orange-950/40"
            iconBg="bg-amber-500"
          />
        )}
      </section>

      {/* Note */}
      {detail.note && (
        <div className="rounded-2xl bg-zinc-50 p-4 dark:bg-zinc-800/40">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            ບັນທຶກ
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {detail.note}
          </div>
        </div>
      )}

      {/* Approval note (if rejected/approved) */}
      {detail.approval_note && (
        <div className="rounded-2xl bg-amber-50/60 p-4 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900/50">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-300">
            ບັນທຶກອະນຸມັດ
          </div>
          <div className="mt-1 whitespace-pre-wrap text-sm text-amber-900 dark:text-amber-200">
            {detail.approval_note}
          </div>
        </div>
      )}

      {/* Labels section */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            ປ້າຍກວດນັບ
          </h2>
          <span className="text-xs text-zinc-500">
            {summary.counted} / {summary.labels} ນັບແລ້ວ
          </span>
        </div>
        {labels.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
              ຍັງບໍ່ມີປ້າຍ
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              ສ້າງປ້າຍດ້ານລຸ່ມເພື່ອເລີ່ມຕົ້ນ
            </p>
          </div>
        ) : (
          <LabelGrid
            sessionId={detail.session_id}
            labels={labels}
            canEdit={isOpen}
          />
        )}
      </section>

      {/* Create labels — only when open */}
      {isOpen && (
        <details
          className="rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
          open={summary.labels === 0}
        >
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            + ສ້າງປ້າຍກວດນັບ
            {locationCount > 0 && (
              <span className="ml-2 text-xs font-normal text-zinc-500">
                ({locationCount} location ໃນ master)
              </span>
            )}
          </summary>
          <div className="border-t border-zinc-100 p-5 dark:border-zinc-800">
            {locationCount > 0 ? (
              <>
                <LabelFromLocation
                  sessionId={detail.session_id}
                  locationCount={locationCount}
                />
                <details className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                  <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                    ຫຼື ສ້າງດ້ວຍ prefix + ຊ່ວງເລກ
                  </summary>
                  <div className="mt-3">
                    <LabelBulkCreate sessionId={detail.session_id} />
                  </div>
                </details>
              </>
            ) : (
              <>
                <div className="mb-3 rounded-lg bg-amber-50/60 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-200">
                  ສາງນີ້ບໍ່ມີ location ໃນ master.
                </div>
                <LabelBulkCreate sessionId={detail.session_id} />
              </>
            )}
          </div>
        </details>
      )}

      {/* Audit trail (collapsed) */}
      <details className="rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          ປະຫວັດ ແລະ ການອະນຸມັດ
        </summary>
        <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">
          <ol className="relative space-y-4 border-l-2 border-zinc-100 pl-5 dark:border-zinc-800">
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
        <div className="rounded-2xl border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-violet-50/50 px-5 py-5 text-center text-sm text-indigo-900 dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-violet-950/30 dark:text-indigo-200">
          <span className="text-base">✨</span> ສ້າງປ້າຍກວດນັບກ່ອນ ແລ້ວເລີ່ມຕົ້ນ
        </div>
      );
    }
    if (nextLabelId !== undefined) {
      return (
        <Link
          href={`/stocktake/${sessionId}/count/${nextLabelId}`}
          className="group relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-5 text-white shadow-lg shadow-indigo-500/30 transition hover:shadow-xl hover:shadow-indigo-500/40 active:scale-[0.98]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-white/20 to-transparent opacity-0 transition group-hover:opacity-100"
          />
          <div className="relative min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-white/80">
              {countedCount === 0 ? "ເລີ່ມນັບ" : "ສືບຕໍ່ນັບ"}
            </div>
            <div className="mt-1 font-mono text-2xl font-bold">
              {nextLabelCode}
            </div>
          </div>
          <span className="relative text-3xl transition group-hover:translate-x-1">
            →
          </span>
        </Link>
      );
    }
    // All labels counted
    return (
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 px-5 py-5 text-center shadow-lg shadow-emerald-500/30">
        <div className="text-2xl">✨</div>
        <p className="mt-1 text-sm font-semibold text-white">
          ນັບຄົບທຸກປ້າຍແລ້ວ
        </p>
        <p className="mt-0.5 text-xs text-white/85">
          ກົດ &quot;ສົ່ງເພື່ອອະນຸມັດ&quot; ດ້ານລຸ່ມ
        </p>
      </div>
    );
  }
  if (status === "pending_approval") {
    return (
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-400 to-amber-500 px-5 py-5 text-center shadow-lg shadow-amber-500/30">
        <div className="text-2xl">⏳</div>
        <p className="mt-1 text-sm font-semibold text-white">
          {canApprove
            ? "ກວດສອບ + ກົດປຸ່ມອະນຸມັດດ້ານລຸ່ມ"
            : "ລໍຖ້າ supervisor ອະນຸມັດ"}
        </p>
      </div>
    );
  }
  // Closed
  return (
    <Link
      href={`/stocktake/${sessionId}/summary`}
      className="group flex items-center justify-between gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-zinc-700 via-zinc-800 to-zinc-900 px-6 py-5 text-white shadow-lg shadow-zinc-900/30 transition hover:shadow-xl active:scale-[0.98] dark:from-zinc-200 dark:via-zinc-100 dark:to-white dark:text-zinc-900"
    >
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-widest opacity-80">
          ✓ ປິດແລ້ວ
        </div>
        <div className="mt-1 text-base font-semibold">ເບິ່ງລາຍງານສະຫຼຸບ</div>
      </div>
      <span className="text-3xl transition group-hover:translate-x-1">→</span>
    </Link>
  );
}

function SecondaryAction({
  href,
  label,
  icon,
  gradient,
  iconBg,
}: {
  href: string;
  label: string;
  icon: string;
  gradient: string;
  iconBg: string;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-br ${gradient} p-4 ring-1 ring-zinc-200/50 transition hover:-translate-y-0.5 hover:shadow-lg dark:ring-zinc-700/50`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg} text-base shadow-md`}
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        {label}
      </span>
      <span className="ml-auto text-zinc-400 opacity-0 transition group-hover:translate-x-1 group-hover:opacity-100">
        →
      </span>
    </Link>
  );
}

function StatusPill({
  status,
  blind,
}: {
  status: "open" | "pending_approval" | "closed";
  blind: boolean;
}) {
  const config = {
    open: {
      dot: "bg-emerald-400 shadow-emerald-400/60",
      label: "ກຳລັງດຳເນີນ",
    },
    pending_approval: {
      dot: "bg-amber-300 shadow-amber-300/60 animate-pulse",
      label: "ລໍຖ້າອະນຸມັດ",
    },
    closed: {
      dot: "bg-white/60",
      label: "ປິດແລ້ວ",
    },
  }[status];

  return (
    <div className="flex flex-col items-end gap-1.5">
      <span className="inline-flex items-center gap-2 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur ring-1 ring-white/30">
        <span className={`h-2 w-2 rounded-full shadow-md ${config.dot}`} />
        {config.label}
      </span>
      {blind && (
        <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur">
          🙈 Blind count
        </span>
      )}
    </div>
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
        className={`absolute -left-[27px] flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-zinc-900 ${
          done
            ? "bg-emerald-500"
            : pending
              ? "bg-amber-500"
              : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        {done && (
          <svg
            viewBox="0 0 24 24"
            className="h-2.5 w-2.5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 13 4 4L19 7" />
          </svg>
        )}
      </span>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm text-zinc-900 dark:text-zinc-50">
        {employee ?? (done || pending ? "—" : "ຍັງບໍ່ໄດ້ດຳເນີນ")}
      </div>
      {at && (
        <div className="text-xs text-zinc-500">{at.slice(0, 16)}</div>
      )}
    </li>
  );
}

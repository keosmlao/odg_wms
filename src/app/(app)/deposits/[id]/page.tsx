import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { ChevronRightIcon } from "@/components/ui/Icons";
import {
  AGING_TONE,
  calculateFee,
  depositAging,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPct,
  type DepositRow,
  type DepositStatus,
} from "@/lib/deposit";
import SettleForm from "./SettleForm";
import ReopenButton from "./ReopenButton";
import DeleteButton from "./DeleteButton";
import BillsPanel, { type DepositBill } from "./BillsPanel";
import EditHeaderForm from "./EditHeaderForm";

type PaymentRow = {
  payment_id: number;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  paid_at: string;
  received_by: number | null;
  received_employee: string | null;
  note: string | null;
};

const STATUS_CONFIG: Record<
  DepositStatus,
  { label: string; chip: string; dot: string }
> = {
  active: {
    label: "ກຳລັງຝາກ",
    chip:
      "bg-brand-50 text-brand-700 ring-brand-200/70 dark:bg-brand-950/40 dark:text-brand-300 dark:ring-brand-900/50",
    dot: "bg-brand-500",
  },
  settled: {
    label: "ສຳເລັດ",
    chip:
      "bg-emerald-50 text-emerald-700 ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900/50",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "ຍົກເລີກ",
    chip:
      "bg-zinc-100 text-zinc-600 ring-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-300 dark:ring-zinc-700",
    dot: "bg-zinc-400",
  },
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export default async function DepositDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900/50 dark:bg-amber-950/30">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          ບໍ່ມີສິດເຂົ້າເຖິງ WMS
        </p>
      </div>
    );
  }

  const { id } = await params;
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) notFound();

  const detail = (
    await query<
      DepositRow & {
        wh_name: string | null;
        sale_code: string | null;
        sale_name: string | null;
        created_employee: string | null;
        settled_employee: string | null;
        updated_employee: string | null;
        updated_at: string | null;
      }
    >(
      `SELECT
         d.deposit_id, d.deposit_code, d.wh_code,
         w.name_1 AS wh_name,
         d.cust_code, d.cust_name, d.sale_code, d.sale_name,
         d.start_date::text AS start_date,
         d.end_date::text   AS end_date,
         d.status,
         d.fee_model,
         d.free_days_max,
         d.tier1_days_max, d.tier1_pct::text AS tier1_pct,
         d.tier2_days_max, d.tier2_pct::text AS tier2_pct,
         d.tier3_days_max, d.tier3_pct::text AS tier3_pct,
         d.tier4_pct::text AS tier4_pct,
         d.min_charge::text AS min_charge,
         d.max_charge::text AS max_charge,
         d.currency,
         d.total_items,
         d.total_qty::text   AS total_qty,
         d.total_value::text AS total_value,
         d.settled_fee::text AS settled_fee,
         d.settled_days,
         d.note,
         d.created_by,
         d.created_at::text  AS created_at,
         d.settled_by,
         d.settled_at::text  AS settled_at,
         d.updated_at::text AS updated_at,
         eC.fullname_lo AS created_employee,
         eS.fullname_lo AS settled_employee,
         eU.fullname_lo AS updated_employee
       FROM public.wms_deposit d
       LEFT JOIN public.ic_warehouse w  ON w.code = d.wh_code
       LEFT JOIN public.odg_employee  eC ON eC.employee_id = d.created_by
       LEFT JOIN public.odg_employee  eS ON eS.employee_id = d.settled_by
       LEFT JOIN public.odg_employee  eU ON eU.employee_id = d.updated_by
       WHERE d.deposit_id = $1`,
      [depositId],
    )
  )[0];
  if (!detail) notFound();

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(detail.wh_code)) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-900 dark:text-red-200">
          ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້
        </p>
      </div>
    );
  }

  const [bills, payments] = await Promise.all([
    query<DepositBill>(
      `SELECT doc_no, trans_flag, doc_date::text AS doc_date,
              cust_code, cust_name, sale_name, currency_code,
              lines, items,
              qty_sum::text   AS qty_sum,
              value_sum::text AS value_sum
       FROM public.wms_deposit_bill
       WHERE deposit_id = $1
       ORDER BY doc_date DESC, doc_no`,
      [depositId],
    ),
    query<PaymentRow>(
      `SELECT p.payment_id, p.amount::text AS amount, p.currency, p.method,
              p.reference, p.paid_at::text AS paid_at, p.received_by,
              e.fullname_lo AS received_employee, p.note
       FROM public.wms_deposit_payment p
       LEFT JOIN public.odg_employee e ON e.employee_id = p.received_by
       WHERE p.deposit_id = $1
       ORDER BY p.paid_at DESC`,
      [depositId],
    ),
  ]);

  const statusCfg = STATUS_CONFIG[detail.status];
  const isActive = detail.status === "active";
  const isManager = session.role === "manager";

  const calc = isActive
    ? calculateFee({
        start_date: detail.start_date,
        free_days_max: detail.free_days_max,
        tier1_days_max: detail.tier1_days_max,
        tier1_pct: detail.tier1_pct,
        tier2_days_max: detail.tier2_days_max,
        tier2_pct: detail.tier2_pct,
        tier3_days_max: detail.tier3_days_max,
        tier3_pct: detail.tier3_pct,
        tier4_pct: detail.tier4_pct,
        min_charge: detail.min_charge,
        max_charge: detail.max_charge,
        total_value: detail.total_value,
      })
    : null;
  const age = isActive ? depositAging(detail, detail.start_date) : null;
  const ageTone = age ? AGING_TONE[age.level] : null;

  return (
    <div className="w-full">
      <nav className="mb-3 flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <Link
            href="/deposits"
            className="font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            ຮັບຝາກເຄື່ອງ
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
          <span className="font-mono text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {detail.deposit_code}
          </span>
        </div>
        <a
          href={`/print/deposit/${detail.deposit_id}?auto=1`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          🖨 ພິມໃບຮັບຝາກ
        </a>
      </nav>

      {/* Aging alert — anything past the free period is red */}
      {age?.over && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 dark:border-rose-900/50 dark:bg-rose-950/25">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-600 text-sm font-bold text-white">
              !
            </span>
            <div>
              <p className="text-sm font-bold text-rose-800 dark:text-rose-200">
                ຝາກມາແລ້ວ {age.days} ມື້ — {age.label}
              </p>
              <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80">
                ເກີນໄລຍະຟຣີ {detail.free_days_max} ມື້ · ອັດຕາປະຈຸບັນ{" "}
                {formatPct(age.pct)} ຂອງມູນຄ່າສິນຄ້າ
              </p>
            </div>
          </div>
          {age.nextAtDays !== null && (
            <p
              className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold ${
                age.soon
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                  : "bg-white/70 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
              }`}
            >
              ອີກ {age.daysToNext} ມື້ ຂຶ້ນເປັນ {formatPct(age.nextPct ?? 0)}
            </p>
          )}
        </div>
      )}

      {/* Hero */}
      <section className="mb-4 overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
        <div className="px-5 py-4 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            ຮັບຝາກເຄື່ອງ
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl dark:text-white">
              {detail.deposit_code}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${statusCfg.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
              {statusCfg.label}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              {detail.wh_code}
              {detail.wh_name ? ` (${detail.wh_name})` : ""}
            </span>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span>
              ເລີ່ມ {formatDate(detail.start_date)}
              {detail.end_date && ` → ${formatDate(detail.end_date)}`}
            </span>
            {age && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ageTone!.chip}`}
                >
                  {age.days} ມື້
                </span>
              </>
            )}
            {detail.cust_code || detail.cust_name ? (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span>
                  ລູກຄ້າ: {detail.cust_name ?? detail.cust_code}
                  {detail.cust_code && detail.cust_name && ` (${detail.cust_code})`}
                </span>
              </>
            ) : null}
            {detail.created_employee && (
              <>
                <span className="text-zinc-300 dark:text-zinc-600">·</span>
                <span>ໂດຍ {detail.created_employee}</span>
              </>
            )}
          </div>
        </div>

        {/* Stat row */}
        <div className="grid grid-cols-2 divide-x divide-zinc-100 border-t border-zinc-100 sm:grid-cols-5 dark:divide-zinc-800 dark:border-zinc-800">
          <Stat label="ບິນ" value={bills.length} tone="zinc" />
          <Stat label="ສິນຄ້າ" value={detail.total_items} tone="zinc" />
          <Stat
            label="qty ລວມ"
            value={formatQty(detail.total_qty)}
            tone="zinc"
            mono
          />
          <Stat
            label="ມູນຄ່າ"
            value={formatMoney(detail.total_value, detail.currency)}
            tone="brand"
            mono
          />
          <Stat
            label={detail.settled_fee !== null ? "ຄ່າຝາກ" : "ຄ່າຝາກປະຈຸບັນ"}
            value={
              detail.settled_fee !== null
                ? formatMoney(detail.settled_fee, detail.currency)
                : calc
                  ? formatMoney(calc.fee, detail.currency)
                  : "—"
            }
            tone={detail.settled_fee !== null ? "emerald" : "amber"}
            mono
          />
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* LEFT: bills + payments */}
        <div className="min-w-0 space-y-4">
          <BillsPanel
            depositId={detail.deposit_id}
            whCode={detail.wh_code}
            currency={detail.currency}
            bills={bills}
            editable={isActive}
          />

          {/* Payments */}
          {payments.length > 0 && (
            <section className="overflow-hidden rounded-2xl border border-zinc-200/70 bg-white/90 shadow-sm ring-1 ring-black/[0.02] dark:border-zinc-800/70 dark:bg-zinc-900/80 dark:ring-white/[0.03]">
              <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">
                  ການຮັບເງິນ
                </h2>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {payments.map((p) => (
                  <li
                    key={p.payment_id}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          {p.method}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {formatDateTime(p.paid_at)}
                        </span>
                      </div>
                      {p.received_employee && (
                        <div className="mt-0.5 text-[11px] text-zinc-500">
                          ຮັບໂດຍ {p.received_employee}
                        </div>
                      )}
                      {p.reference && (
                        <div className="text-[11px] text-zinc-500">
                          ref: {p.reference}
                        </div>
                      )}
                    </div>
                    <div className="font-mono text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(p.amount, p.currency)}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* RIGHT: settle form + audit */}
        <aside className="space-y-4 lg:sticky lg:top-0">
          {isActive ? (
            <SettleForm
              depositId={detail.deposit_id}
              startDate={detail.start_date}
              freeDaysMax={detail.free_days_max}
              tier1DaysMax={detail.tier1_days_max}
              tier1Pct={detail.tier1_pct}
              tier2DaysMax={detail.tier2_days_max}
              tier2Pct={detail.tier2_pct}
              tier3DaysMax={detail.tier3_days_max}
              tier3Pct={detail.tier3_pct}
              tier4Pct={detail.tier4_pct}
              minCharge={detail.min_charge}
              maxCharge={detail.max_charge}
              totalValue={detail.total_value}
              currency={detail.currency}
            />
          ) : null}

          {isActive && (
            <EditHeaderForm
              depositId={detail.deposit_id}
              startDate={detail.start_date}
              custCode={detail.cust_code}
              custName={detail.cust_name}
              note={detail.note}
            />
          )}

          {!isActive && (
            <div className="rounded-2xl border border-zinc-200/70 bg-white/90 p-5 dark:border-zinc-800/70 dark:bg-zinc-900/80">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
                ສະຫຼຸບການຝາກ
              </h2>
              <dl className="mt-2 space-y-1 text-sm">
                <Row k="ໄລຍະຝາກ" v={`${detail.settled_days ?? "—"} ມື້`} />
                {detail.settled_fee !== null && (
                  <Row
                    k="ຄ່າຝາກ"
                    v={formatMoney(detail.settled_fee, detail.currency)}
                  />
                )}
                {detail.settled_employee && (
                  <Row k="ສຳເລັດໂດຍ" v={detail.settled_employee} />
                )}
                {detail.settled_at && (
                  <Row k="ເວລາ" v={formatDateTime(detail.settled_at)} />
                )}
              </dl>
              {isManager && detail.status !== "active" && (
                <div className="mt-3">
                  <ReopenButton depositId={detail.deposit_id} />
                </div>
              )}
            </div>
          )}

          {/* Tier snapshot */}
          <div className="rounded-2xl border border-zinc-200/70 bg-white/90 p-5 dark:border-zinc-800/70 dark:bg-zinc-900/80">
            <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
              ອັດຕາ (snapshot)
            </h2>
            <dl className="mt-2 space-y-1 text-xs">
              <Row k="ມູນຄ່າສິນຄ້າ" v={formatMoney(detail.total_value, detail.currency)} />
              <Row k={`1-${detail.free_days_max} ມື້`} v="ຟຣີ" />
              <Row
                k={`${detail.free_days_max + 1}-${detail.tier1_days_max} ມື້`}
                v={formatPct(detail.tier1_pct)}
              />
              <Row
                k={`${detail.tier1_days_max + 1}-${detail.tier2_days_max} ມື້`}
                v={formatPct(detail.tier2_pct)}
              />
              <Row
                k={`${detail.tier2_days_max + 1}-${detail.tier3_days_max} ມື້`}
                v={formatPct(detail.tier3_pct)}
              />
              <Row
                k={`> ${detail.tier3_days_max} ມື້`}
                v={formatPct(detail.tier4_pct)}
              />
            </dl>
          </div>

          {/* Note */}
          {detail.note && (
            <div className="rounded-2xl border border-zinc-200/70 bg-white/90 p-5 dark:border-zinc-800/70 dark:bg-zinc-900/80">
              <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-200">
                ບັນທຶກ
              </h2>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {detail.note}
              </p>
            </div>
          )}

          {/* Manager actions (delete) */}
          {isManager && (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/30 p-5 dark:border-rose-900/40 dark:bg-rose-950/15">
              <h2 className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                ສິດຜູ້ຈັດການ
              </h2>
              <p className="mt-1 mb-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                ການລົບຈະເອົາຂໍ້ມູນຮັບຝາກ ບິນ ແລະ ການຮັບເງິນ ອອກທັງໝົດ.
              </p>
              <DeleteButton
                depositId={detail.deposit_id}
                depositCode={detail.deposit_code}
                status={detail.status}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  mono = false,
}: {
  label: string;
  value: string | number;
  tone: "zinc" | "emerald" | "amber" | "brand";
  mono?: boolean;
}) {
  const toneMap = {
    zinc: "text-zinc-900 dark:text-white",
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    brand: "text-brand-600 dark:text-brand-400",
  };
  return (
    <div className="px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p
        className={`mt-0.5 text-lg font-bold tabular-nums sm:text-xl ${toneMap[tone]} ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
      <dd className="font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {v}
      </dd>
    </div>
  );
}

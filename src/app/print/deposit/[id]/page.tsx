import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import AutoPrint from "../../wms/[doc]/AutoPrint";
import {
  calculateFee,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPct,
  type DepositRow,
} from "@/lib/deposit";

type Detail = DepositRow & {
  wh_name: string | null;
  sale_code: string | null;
  sale_name: string | null;
  created_employee: string | null;
  settled_employee: string | null;
};

type BillRow = {
  doc_no: string;
  trans_flag: number;
  doc_date: string | null;
  cust_code: string | null;
  cust_name: string | null;
  currency_code: string | null;
  lines: number;
  items: number;
  qty_sum: string;
  value_sum: string;
};

type PaymentRow = {
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  paid_at: string;
  received_employee: string | null;
};

const METHOD_LABEL: Record<string, string> = {
  cash: "ເງິນສົດ",
  transfer: "ໂອນ",
  other: "ອື່ນໆ",
};

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/**
 * Printable deposit slip. While the deposit is active it prints as a holding
 * receipt (ໃບຮັບຝາກ) with the fee accrued so far; once settled it prints as
 * the fee receipt (ໃບຮັບເງິນ) with the amount actually collected.
 *
 * Lives outside the (app) layout so it prints without the app chrome.
 */
export default async function PrintDepositPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) redirect("/");

  const { id } = await params;
  const sp = await searchParams;
  const depositId = Number.parseInt(id, 10);
  if (!Number.isFinite(depositId)) notFound();

  const detail = (
    await query<Detail>(
      `SELECT
         d.deposit_id, d.deposit_code, d.wh_code,
         w.name_1 AS wh_name,
         d.cust_code, d.cust_name, d.sale_code, d.sale_name,
         d.start_date::text AS start_date,
         d.end_date::text   AS end_date,
         d.status, d.fee_model,
         d.free_days_max,
         d.tier1_days_max, d.tier1_pct::text AS tier1_pct,
         d.tier2_days_max, d.tier2_pct::text AS tier2_pct,
         d.tier3_days_max, d.tier3_pct::text AS tier3_pct,
         d.tier4_pct::text  AS tier4_pct,
         d.min_charge::text AS min_charge,
         d.max_charge::text AS max_charge,
         d.currency,
         d.total_items,
         d.total_qty::text   AS total_qty,
         d.total_value::text AS total_value,
         d.settled_fee::text AS settled_fee,
         d.settled_days, d.note,
         d.created_by, d.created_at::text AS created_at,
         d.settled_by, d.settled_at::text AS settled_at,
         eC.fullname_lo AS created_employee,
         eS.fullname_lo AS settled_employee
       FROM public.wms_deposit d
       LEFT JOIN public.ic_warehouse w   ON w.code = d.wh_code
       LEFT JOIN public.odg_employee eC  ON eC.employee_id = d.created_by
       LEFT JOIN public.odg_employee eS  ON eS.employee_id = d.settled_by
       WHERE d.deposit_id = $1`,
      [depositId],
    )
  )[0];
  if (!detail) notFound();

  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && !accessible.includes(detail.wh_code)) {
    redirect("/deposits");
  }

  const [bills, payments] = await Promise.all([
    query<BillRow>(
      `SELECT doc_no, trans_flag, doc_date::text AS doc_date, cust_code, cust_name,
              currency_code, lines, items,
              qty_sum::text   AS qty_sum,
              value_sum::text AS value_sum
       FROM public.wms_deposit_bill
       WHERE deposit_id = $1
       ORDER BY doc_date, doc_no`,
      [depositId],
    ),
    query<PaymentRow>(
      `SELECT p.amount::text AS amount, p.currency, p.method, p.reference,
              p.paid_at::text AS paid_at, e.fullname_lo AS received_employee
       FROM public.wms_deposit_payment p
       LEFT JOIN public.odg_employee e ON e.employee_id = p.received_by
       WHERE p.deposit_id = $1
       ORDER BY p.paid_at`,
      [depositId],
    ),
  ]);

  const isSettled = detail.status === "settled";
  const calc = calculateFee({
    start_date: detail.start_date,
    end_date: detail.end_date,
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
  });
  const days = detail.settled_days ?? calc.duration_days;
  const fee =
    detail.settled_fee !== null
      ? Number.parseFloat(detail.settled_fee)
      : calc.fee;

  const title = isSettled
    ? "ໃບຮັບເງິນຄ່າຝາກເຄື່ອງ"
    : detail.status === "cancelled"
      ? "ໃບຮັບຝາກເຄື່ອງ (ຍົກເລີກ)"
      : "ໃບຮັບຝາກເຄື່ອງ";

  return (
    <div
      className="mx-auto max-w-3xl bg-white p-8 text-slate-900"
      style={{ fontFamily: "'Noto Sans Lao', sans-serif" }}
    >
      <style>{`@media print { .no-print { display:none !important } @page { margin: 14mm } } body { background:#fff }`}</style>
      <AutoPrint auto={sp.auto === "1"} />

      <div className="mb-1 text-center text-lg font-black">ODIEN GROUP</div>
      <div className="mb-4 text-center text-base font-bold">{title}</div>

      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <b>ເລກທີ່:</b>{" "}
          <span className="font-mono">{detail.deposit_code}</span>
        </div>
        <div>
          <b>ວັນທີ່ພິມ:</b> {formatDate(new Date())}
        </div>
        <div>
          <b>ສາງ:</b> {detail.wh_code}
          {detail.wh_name ? ` ${detail.wh_name}` : ""}
        </div>
        <div>
          <b>ລູກຄ້າ:</b> {detail.cust_name ?? detail.cust_code ?? "—"}
          {detail.cust_code && detail.cust_name ? ` (${detail.cust_code})` : ""}
        </div>
        <div>
          <b>ວັນທີ່ເລີ່ມຝາກ:</b> {formatDate(detail.start_date)}
        </div>
        <div>
          <b>ວັນທີ່ຮັບຄືນ:</b>{" "}
          {detail.end_date ? formatDate(detail.end_date) : "—"}
        </div>
        <div>
          <b>ພະນັກງານຂາຍ:</b> {detail.sale_name ?? detail.sale_code ?? "—"}
        </div>
        <div>
          <b>ຜູ້ຮັບຝາກ:</b> {detail.created_employee ?? "—"}
        </div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-100 text-left">
            <th className="w-8 border border-slate-300 px-2 py-1">#</th>
            <th className="border border-slate-300 px-2 py-1">ບິນ</th>
            <th className="border border-slate-300 px-2 py-1">ວັນທີ</th>
            <th className="border border-slate-300 px-2 py-1 text-right">
              ສິນຄ້າ
            </th>
            <th className="border border-slate-300 px-2 py-1 text-right">
              ຈຳນວນ
            </th>
            <th className="border border-slate-300 px-2 py-1 text-right">
              ມູນຄ່າ
            </th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b, i) => (
            <tr key={`${b.doc_no}::${b.trans_flag}`}>
              <td className="border border-slate-300 px-2 py-1 text-center">
                {i + 1}
              </td>
              <td className="border border-slate-300 px-2 py-1">
                <div className="font-mono text-xs font-bold">{b.doc_no}</div>
                {(b.cust_name || b.cust_code) && (
                  <div className="text-[11px] text-slate-500">
                    {b.cust_name ?? b.cust_code}
                  </div>
                )}
              </td>
              <td className="border border-slate-300 px-2 py-1 text-xs">
                {formatDate(b.doc_date)}
              </td>
              <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                {b.items}
              </td>
              <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                {formatQty(b.qty_sum)}
              </td>
              <td className="border border-slate-300 px-2 py-1 text-right font-mono">
                {formatMoney(b.value_sum, b.currency_code ?? detail.currency)}
              </td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-bold">
            <td
              className="border border-slate-300 px-2 py-1 text-right"
              colSpan={3}
            >
              ລວມ
            </td>
            <td className="border border-slate-300 px-2 py-1 text-right font-mono">
              {detail.total_items}
            </td>
            <td className="border border-slate-300 px-2 py-1 text-right font-mono">
              {formatQty(detail.total_qty)}
            </td>
            <td className="border border-slate-300 px-2 py-1 text-right font-mono">
              {formatMoney(detail.total_value, detail.currency)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Fee calculation */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div className="rounded border border-slate-300 p-3">
          <div className="mb-1 font-bold">ອັດຕາຄ່າຝາກ (snapshot)</div>
          <table className="w-full text-xs">
            <tbody>
              <FeeTierRow
                label={`1-${detail.free_days_max} ມື້`}
                value="ຟຣີ"
                active={calc.tier === 0 && !detail.settled_days}
              />
              <FeeTierRow
                label={`${detail.free_days_max + 1}-${detail.tier1_days_max} ມື້`}
                value={formatPct(detail.tier1_pct)}
              />
              <FeeTierRow
                label={`${detail.tier1_days_max + 1}-${detail.tier2_days_max} ມື້`}
                value={formatPct(detail.tier2_pct)}
              />
              <FeeTierRow
                label={`${detail.tier2_days_max + 1}-${detail.tier3_days_max} ມື້`}
                value={formatPct(detail.tier3_pct)}
              />
              <FeeTierRow
                label={`> ${detail.tier3_days_max} ມື້`}
                value={formatPct(detail.tier4_pct)}
              />
            </tbody>
          </table>
        </div>
        <div className="rounded border border-slate-300 p-3">
          <div className="mb-1 font-bold">ສະຫຼຸບຄ່າຝາກ</div>
          <dl className="space-y-0.5 text-xs">
            <SumRow k="ມູນຄ່າສິນຄ້າ" v={formatMoney(detail.total_value, detail.currency)} />
            <SumRow k="ໄລຍະຝາກ" v={`${days} ມື້`} />
            <SumRow k="ອັດຕາທີ່ໃຊ້" v={formatPct(calc.applied_pct)} />
          </dl>
          <div className="mt-2 flex items-baseline justify-between border-t border-slate-300 pt-2">
            <span className="font-bold">
              {isSettled ? "ຄ່າຝາກທີ່ຮັບ" : "ຄ່າຝາກປະຈຸບັນ"}
            </span>
            <span className="font-mono text-lg font-black">
              {formatMoney(fee, detail.currency)}
            </span>
          </div>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="mt-4 rounded border border-slate-300 p-3 text-sm">
          <div className="mb-1 font-bold">ການຮັບເງິນ</div>
          <ul className="space-y-0.5 text-xs">
            {payments.map((p, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  {formatDateTime(p.paid_at)} · {METHOD_LABEL[p.method] ?? p.method}
                  {p.reference ? ` · ref ${p.reference}` : ""}
                  {p.received_employee ? ` · ${p.received_employee}` : ""}
                </span>
                <span className="font-mono font-bold">
                  {formatMoney(p.amount, p.currency)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {detail.note && (
        <div className="mt-3 text-sm">
          <b>ໝາຍເຫດ:</b> {detail.note}
        </div>
      )}

      <div className="mt-12 grid grid-cols-3 gap-6 text-center text-sm">
        {["ຜູ້ຝາກ / ລູກຄ້າ", "ຜູ້ຮັບຝາກ", "ຜູ້ຮັບເງິນ"].map((s) => (
          <div key={s}>
            <div className="mb-10 border-b border-slate-400" />
            <div>{s}</div>
            <div className="text-[10px] text-slate-400">
              ວັນທີ່ ......./......./.......
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeeTierRow({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  return (
    <tr className={active ? "font-bold" : ""}>
      <td className="py-0.5">{label}</td>
      <td className="py-0.5 text-right font-mono">{value}</td>
    </tr>
  );
}

function SumRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="font-mono">{v}</dd>
    </div>
  );
}

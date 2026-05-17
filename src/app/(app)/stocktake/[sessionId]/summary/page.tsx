import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { accessibleWarehouses } from "@/lib/session-shared";
import { Notice } from "@/components/ui/Card";
import { AlertIcon, ChevronRightIcon } from "@/components/ui/Icons";
import PrintButton from "../print/PrintButton";
import StocktakeLayout from "../../_components/StocktakeLayout";
import { stNavLink } from "../../_components/stocktake-theme";

type SessionInfo = {
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
};

type VarianceRow = {
  item_code: string;
  item_name: string | null;
  unit_code: string | null;
  counted_qty: string;
  sml_qty: string;
  pending_qty: string;
};

type LabelStat = {
  label_count: number;
  counted_count: number;
  total_lines: number;
};

type CounterStat = {
  counted_employee: string | null;
  line_count: number;
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

function formatQty(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export default async function SessionSummaryPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!user.role) {
    return (
      <Notice
        tone="amber"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງ WMS"
      />
    );
  }
  const { sessionId } = await params;
  const sid = Number.parseInt(sessionId, 10);
  if (!Number.isFinite(sid)) notFound();

  const info = (
    await query<SessionInfo>(
      `SELECT
         s.session_id, s.session_code, s.wh_code,
         w.name_1 AS wh_name,
         s.name, s.note, s.status,
         s.count_date::text AS count_date,
         s.blind,
         s.created_at::text   AS created_at,
         s.submitted_at::text AS submitted_at,
         s.closed_at::text    AS closed_at,
         s.approval_note,
         eC.fullname_lo AS created_employee,
         eS.fullname_lo AS submitted_employee,
         eA.fullname_lo AS approved_employee,
         eX.fullname_lo AS closed_employee
       FROM public.wms_stocktake_session s
       LEFT JOIN public.ic_warehouse w   ON w.code = s.wh_code
       LEFT JOIN public.odg_employee eC  ON eC.employee_id = s.created_by
       LEFT JOIN public.odg_employee eS  ON eS.employee_id = s.submitted_by
       LEFT JOIN public.odg_employee eA  ON eA.employee_id = s.approved_by
       LEFT JOIN public.odg_employee eX  ON eX.employee_id = s.closed_by
       WHERE s.session_id = $1`,
      [sid],
    )
  )[0];
  if (!info) notFound();

  const accessible = accessibleWarehouses(user);
  if (Array.isArray(accessible) && !accessible.includes(info.wh_code)) {
    return (
      <Notice
        tone="red"
        icon={<AlertIcon className="h-5 w-5" />}
        title="ບໍ່ມີສິດເຂົ້າເຖິງສາງນີ້"
      />
    );
  }

  const [rows, labelStatRows, counterRows, pendingLines] = await Promise.all([
    query<VarianceRow>(
      `WITH counted AS (
         SELECT item_code, MAX(item_name) AS item_name, MAX(unit_code) AS unit_code,
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
         u.item_code                          AS item_code,
         COALESCE(c.item_name, u.item_name)   AS item_name,
         COALESCE(c.unit_code, u.unit_code)   AS unit_code,
         COALESCE(c.counted_qty, 0)::text     AS counted_qty,
         COALESCE(ss.snapshot_qty, 0)::text   AS sml_qty,
         COALESCE(p.pending_qty, 0)::text     AS pending_qty
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
         ON p.item_code = u.item_code AND p.session_id = $1`,
      [sid],
    ),
    query<LabelStat>(
      `SELECT
         (SELECT count(*) FROM public.wms_stocktake_label WHERE session_id = $1)::int AS label_count,
         (SELECT count(DISTINCT label_id) FROM public.wms_stocktake_line WHERE session_id = $1)::int AS counted_count,
         (SELECT count(*) FROM public.wms_stocktake_line WHERE session_id = $1)::int AS total_lines`,
      [sid],
    ),
    query<CounterStat>(
      `SELECT e.fullname_lo AS counted_employee, count(*)::int AS line_count
       FROM public.wms_stocktake_line ln
       LEFT JOIN public.odg_employee e ON e.employee_id = ln.counted_by
       WHERE ln.session_id = $1
       GROUP BY e.fullname_lo
       ORDER BY line_count DESC`,
      [sid],
    ),
    query<PendingBillLine>(
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
    ),
  ]);

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

  const labelStat = labelStatRows[0] ?? {
    label_count: 0,
    counted_count: 0,
    total_lines: 0,
  };

  // Aggregate — the reference balance is SML + pending shipments
  // (goods deducted from SML but still physically in the warehouse).
  let countedTotal = 0;
  let smlTotal = 0;
  let pendingTotal = 0;
  let referenceTotal = 0;
  let matched = 0;
  let positiveVariance = 0;
  let negativeVariance = 0;
  let onlyCounted = 0;
  let onlySml = 0;
  let positiveQty = 0;
  let negativeQty = 0;
  let onlyCountedQty = 0;
  let onlySmlQty = 0;
  const enriched: Array<
    VarianceRow & {
      reference_qty: number;
      variance: number;
      absVar: number;
    }
  > = [];
  for (const r of rows) {
    const c = Number.parseFloat(r.counted_qty) || 0;
    const s = Number.parseFloat(r.sml_qty) || 0;
    const p = Number.parseFloat(r.pending_qty) || 0;
    const ref = s + p;
    const v = c - ref;
    countedTotal += c;
    smlTotal += s;
    pendingTotal += p;
    referenceTotal += ref;
    if (v === 0) matched++;
    else if (c > 0 && ref === 0) {
      onlyCounted++;
      onlyCountedQty += v;
    } else if (ref > 0 && c === 0) {
      onlySml++;
      onlySmlQty += v;
    } else if (v > 0) {
      positiveVariance++;
      positiveQty += v;
    } else if (v < 0) {
      negativeVariance++;
      negativeQty += v;
    }
    enriched.push({ ...r, reference_qty: ref, variance: v, absVar: Math.abs(v) });
  }

  const totalItems = rows.length;
  const variantCount =
    positiveVariance + negativeVariance + onlyCounted + onlySml;
  const accuracy =
    totalItems === 0 ? 100 : (matched / totalItems) * 100;

  const top = [...enriched]
    .filter((r) => r.absVar > 0)
    .sort((a, b) => b.absVar - a.absVar)
    .slice(0, 15);

  return (
    <StocktakeLayout wide>
      <style>{`
        @media print {
          aside, body > div > div > header { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .no-print { display: none !important; }
          .print-page { background: white !important; }
          .summary-card { box-shadow: none !important; border: 1px solid #e4e4e7 !important; }
        }
        @page { margin: 12mm; size: A4; }
      `}</style>

      <div className="print-page mx-auto w-full max-w-5xl space-y-4">
        <nav className="no-print flex flex-wrap items-center gap-2 text-sm">
          <Link href="/stocktake" className={stNavLink}>
            ກວດນັບສິນຄ້າ
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
          <Link href={`/stocktake/${sid}`} className={stNavLink}>
            <span className="font-mono">{info.session_code}</span>
          </Link>
          <ChevronRightIcon className="h-3.5 w-3.5 text-zinc-300 dark:text-zinc-600" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            ສະຫຼຸບ
          </span>
        </nav>

        <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200/70 bg-white/90 p-4 backdrop-blur-sm dark:border-zinc-800/70 dark:bg-zinc-900/80">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
              ລາຍງານ
            </p>
            <div className="mt-0.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              ສະຫຼຸບການກວດນັບ
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/stocktake/${sid}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              ← ກັບໄປຮອບ
            </Link>
            <Link
              href={`/stocktake/${sid}/report`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              ລາຍລະອຽດປຽບທຽບ
            </Link>
            <PrintButton />
          </div>
        </div>

        {/* Report header */}
        <header className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-200 pb-4 dark:border-zinc-800">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                ລາຍງານສະຫຼຸບການກວດນັບ
              </div>
              <h1 className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {info.name ?? info.session_code}
              </h1>
              <div className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                ເລກທີ່: <span className="font-mono">{info.session_code}</span>
              </div>
            </div>
            <div className="text-right text-sm">
              <div>
                <span className="text-zinc-500">ສະຖານະ: </span>
                <span
                  className={
                    info.status === "open"
                      ? "font-semibold text-emerald-600"
                      : "font-semibold text-zinc-700 dark:text-zinc-300"
                  }
                >
                  {info.status === "open" ? "ກຳລັງດຳເນີນ" : "ປິດແລ້ວ"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">ວັນທີ: </span>
                <span className="font-semibold">{info.count_date}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label>ສາງ</Label>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {info.wh_code}
                {info.wh_name ? ` · ${info.wh_name}` : ""}
              </div>
            </div>
            <div>
              <Label>ຜູ້ສ້າງຮອບ</Label>
              <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {info.created_employee ?? "—"}
              </div>
              <div className="text-xs text-zinc-500">
                {info.created_at?.slice(0, 16)}
              </div>
            </div>
            {info.closed_at && (
              <div>
                <Label>ຜູ້ປິດຮອບ</Label>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {info.closed_employee ?? "—"}
                </div>
                <div className="text-xs text-zinc-500">
                  {info.closed_at?.slice(0, 16)}
                </div>
              </div>
            )}
            {info.note && (
              <div className="sm:col-span-2">
                <Label>ບັນທຶກ</Label>
                <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {info.note}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* High-level KPIs */}
        <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            ສະຫຼຸບໂດຍລວມ
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="ປ້າຍທັງໝົດ"
              value={`${labelStat.counted_count} / ${labelStat.label_count}`}
              sub="ນັບແລ້ວ / ສ້າງໄວ້"
            />
            <Stat
              label="ລາຍການນັບ"
              value={labelStat.total_lines.toLocaleString("en-US")}
              sub="ລາຍການ"
            />
            <Stat
              label="ສິນຄ້າ"
              value={totalItems.toLocaleString("en-US")}
              sub={`${matched} ກົງ · ${variantCount} ຕ່າງ`}
            />
            <Stat
              label="ຄວາມຖືກຕ້ອງ"
              value={`${accuracy.toFixed(1)}%`}
              accent={accuracy >= 95 ? "emerald" : accuracy >= 80 ? "amber" : "red"}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat
              label="ນັບໄດ້ລວມ"
              value={formatQty(countedTotal)}
              accent="indigo"
            />
            <Stat label="SML" value={formatQty(smlTotal)} />
            <Stat
              label="ບິນຄ້າງຈ່າຍ"
              value={`+${formatQty(pendingTotal)}`}
              accent="amber"
              sub="(ບວກກັບ SML)"
            />
            <Stat
              label="ຍອດອ້າງອີງ"
              value={formatQty(referenceTotal)}
              sub="SML + ຄ້າງ"
            />
            <Stat
              label="ສ່ວນຕ່າງລວມ (net)"
              value={`${countedTotal - referenceTotal > 0 ? "+" : ""}${formatQty(countedTotal - referenceTotal)}`}
              accent={
                Math.abs(countedTotal - referenceTotal) < 0.0001
                  ? "neutral"
                  : countedTotal - referenceTotal > 0
                    ? "emerald"
                    : "red"
              }
            />
          </div>
        </section>

        {/* Variance breakdown */}
        <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            ການແບ່ງປະເພດສ່ວນຕ່າງ
          </h2>
          <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40">
                <tr>
                  <th className="px-4 py-2 text-left">ປະເພດ</th>
                  <th className="px-4 py-2 text-right">ຈຳນວນສິນຄ້າ</th>
                  <th className="px-4 py-2 text-right">qty ສ່ວນຕ່າງ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                <Row
                  label="ກົງກັນ (ນັບໄດ້ = SML + ຄ້າງ)"
                  count={matched}
                  qty={0}
                  tone="neutral"
                />
                <Row
                  label="ນັບໄດ້ສູງກວ່າຍອດອ້າງອີງ"
                  count={positiveVariance}
                  qty={positiveQty}
                  tone="emerald"
                />
                <Row
                  label="ນັບໄດ້ຕ່ຳກວ່າຍອດອ້າງອີງ"
                  count={negativeVariance}
                  qty={negativeQty}
                  tone="red"
                />
                <Row
                  label="ນັບໄດ້ ແຕ່ບໍ່ມີໃນຍອດອ້າງອີງ"
                  count={onlyCounted}
                  qty={onlyCountedQty}
                  tone="emerald"
                />
                <Row
                  label="ໃນຍອດອ້າງອີງ ແຕ່ບໍ່ໄດ້ນັບ"
                  count={onlySml}
                  qty={onlySmlQty}
                  tone="red"
                />
              </tbody>
              <tfoot className="border-t-2 border-zinc-200 bg-zinc-50 text-sm font-bold dark:border-zinc-700 dark:bg-zinc-800/40">
                <tr>
                  <td className="px-4 py-2.5">ລວມທັງໝົດ</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {totalItems}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {countedTotal - referenceTotal > 0 ? "+" : ""}
                    {formatQty(countedTotal - referenceTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* Top variances */}
        {top.length > 0 && (
          <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              ສິນຄ້າທີ່ມີສ່ວນຕ່າງສຸງສຸດ
            </h2>
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">ລະຫັດ</th>
                    <th className="px-3 py-2 text-left">ຊື່</th>
                    <th className="px-3 py-2 text-right">ນັບໄດ້</th>
                    <th className="px-3 py-2 text-right">SML</th>
                    <th className="px-3 py-2 text-right">ຄ້າງ</th>
                    <th className="px-3 py-2 text-right">ອ້າງອີງ</th>
                    <th className="px-3 py-2 text-right">ສ່ວນຕ່າງ</th>
                    <th className="px-3 py-2 text-left">ຫົວໜ່ວຍ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {top.map((r, i) => (
                    <tr key={r.item_code}>
                      <td className="px-3 py-1.5 text-zinc-500">{i + 1}</td>
                      <td className="px-3 py-1.5 font-mono font-semibold">
                        {r.item_code}
                      </td>
                      <td className="px-3 py-1.5">
                        <div
                          className="max-w-[260px] truncate"
                          title={r.item_name ?? ""}
                        >
                          {r.item_name ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {formatQty(Number.parseFloat(r.counted_qty) || 0)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {formatQty(Number.parseFloat(r.sml_qty) || 0)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                        {Number.parseFloat(r.pending_qty) > 0 ? "+" : ""}
                        {formatQty(Number.parseFloat(r.pending_qty) || 0)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                        {formatQty(r.reference_qty)}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-mono font-bold tabular-nums ${
                          r.variance > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-red-700 dark:text-red-400"
                        }`}
                      >
                        {r.variance > 0 ? "+" : ""}
                        {formatQty(r.variance)}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">
                        {r.unit_code ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {enriched.filter((r) => r.absVar > 0).length > top.length && (
              <div className="mt-2 text-xs text-zinc-500">
                ສະແດງ {top.length} ຈາກ {variantCount} ລາຍການທີ່ມີສ່ວນຕ່າງ
                — ເບິ່ງທັງໝົດທີ່{" "}
                <Link
                  href={`/stocktake/${sid}/report?filter=variance`}
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  ໜ້າປຽບທຽບ
                </Link>
              </div>
            )}
          </section>
        )}

        {/* Pending bills breakdown */}
        {billGroups.length > 0 && (
          <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <div className="mb-4 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                ບິນຄ້າງຈ່າຍທີ່ຮວມໃນຍອດອ້າງອີງ
              </h2>
              <span className="text-xs text-zinc-500">
                {billGroups.length.toLocaleString("en-US")} ບິນ ·{" "}
                {pendingLines.length.toLocaleString("en-US")} ລາຍການ
              </span>
            </div>
            <div className="overflow-hidden rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/40">
                  <tr>
                    <th className="px-3 py-2 text-left">doc_no</th>
                    <th className="px-3 py-2 text-left">flag</th>
                    <th className="px-3 py-2 text-left">ວັນທີ</th>
                    <th className="px-3 py-2 text-left">ລູກຄ້າ</th>
                    <th className="px-3 py-2 text-left">ສິນຄ້າ</th>
                    <th className="px-3 py-2 text-right">qty</th>
                    <th className="px-3 py-2 text-left">ຫົວໜ່ວຍ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {billGroups.flatMap((g) => [
                    <tr
                      key={`${g.doc_no}::${g.trans_flag}::header`}
                      className="bg-amber-50/40 dark:bg-amber-950/15"
                    >
                      <td className="px-3 py-1.5 font-mono font-bold text-zinc-900 dark:text-zinc-50">
                        {g.doc_no}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">
                        {g.trans_flag}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300">
                        {g.doc_date ?? "—"}
                      </td>
                      <td
                        className="px-3 py-1.5 text-zinc-600 dark:text-zinc-300"
                        colSpan={2}
                      >
                        {g.cust_code ?? "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold tabular-nums text-amber-700 dark:text-amber-400">
                        +{formatQty(g.total_qty)}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-400">
                        {g.lines.length} ລາຍ
                      </td>
                    </tr>,
                    ...g.lines.map((l, i) => (
                      <tr
                        key={`${g.doc_no}::${g.trans_flag}::${l.item_code}::${i}`}
                      >
                        <td className="px-3 py-1" colSpan={4} />
                        <td className="px-3 py-1">
                          <div className="flex flex-col">
                            <span className="font-mono font-semibold">
                              {l.item_code}
                            </span>
                            {l.item_name && (
                              <span
                                className="max-w-[300px] truncate text-zinc-500"
                                title={l.item_name}
                              >
                                {l.item_name}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                          +{formatQty(Number.parseFloat(l.qty) || 0)}
                        </td>
                        <td className="px-3 py-1 text-zinc-500">
                          {l.unit_code ?? ""}
                        </td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Counters */}
        {counterRows.length > 0 && (
          <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              ຜູ້ກວດນັບ
            </h2>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {counterRows.map((c, i) => (
                <li
                  key={c.counted_employee ?? `unknown-${i}`}
                  className="flex items-center justify-between py-2 text-sm"
                >
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {c.counted_employee ?? "(ບໍ່ລະບຸ)"}
                  </span>
                  <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-50">
                    {c.line_count.toLocaleString("en-US")} ລາຍການ
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Signature block */}
        <section className="summary-card overflow-hidden rounded-2xl bg-white p-6 shadow-card ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <h2 className="mb-6 text-sm font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
            ການລົງລາຍເຊັນ
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <Signature title="ຜູ້ກວດນັບ" />
            <Signature title="ຜູ້ກວດສອບ" />
            <Signature title="ຜູ້ຈັດການ" />
          </div>
        </section>

        <footer className="text-center text-xs text-zinc-400">
          ພິມເມື່ອ {new Date().toLocaleString("lo-LA")}
        </footer>
      </div>
    </StocktakeLayout>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "neutral" | "indigo" | "emerald" | "red" | "amber";
}) {
  const colorMap: Record<string, string> = {
    neutral: "text-zinc-900 dark:text-zinc-50",
    indigo: "text-indigo-600 dark:text-indigo-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-600 dark:text-red-400",
    amber: "text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-3 ring-1 ring-zinc-200 dark:bg-zinc-800/40 dark:ring-zinc-700">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${colorMap[accent]}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] text-zinc-500">{sub}</div>
      )}
    </div>
  );
}

function Row({
  label,
  count,
  qty,
  tone,
}: {
  label: string;
  count: number;
  qty: number;
  tone: "neutral" | "emerald" | "red";
}) {
  const qtyColor =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "red"
        ? "text-red-700 dark:text-red-400"
        : "text-zinc-500";
  return (
    <tr>
      <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{label}</td>
      <td className="px-4 py-2 text-right font-mono tabular-nums">{count}</td>
      <td className={`px-4 py-2 text-right font-mono tabular-nums ${qtyColor}`}>
        {qty > 0 ? "+" : ""}
        {formatQty(qty)}
      </td>
    </tr>
  );
}

function Signature({ title }: { title: string }) {
  return (
    <div className="text-center">
      <div className="mx-auto mt-12 h-px w-full bg-zinc-300 dark:bg-zinc-600" />
      <div className="mt-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        {title}
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        ວັນທີ: ________________
      </div>
    </div>
  );
}

import Link from "next/link";
import { query } from "@/lib/db";
import DeleteIssueButton from "./DeleteIssueButton";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { Chip, KpiCard, EmptyState } from "@/components/ui/Card";
import {
  BuildingIcon,
  CalendarIcon,
  ListIcon,
  PackageIcon,
  SearchIcon,
  UserIcon,
} from "@/components/ui/Icons";

const PAGE_SIZE = 20;
const BASE_PATH = "/movements/issue";
/** odg_wms_trans(_detail) flag for a WMS goods issue (matches the POST route). */
const ISSUE_STOCK_FLAG = 72;

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  doc_ref: string | null;
  wh_code: string | null;
  wh_name: string | null;
  creator_code: string | null;
  creator_name: string | null;
  line_count: number;
  out_qty: string;
};

type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  shelf_code: string | null;
  shelf_code1: string | null;
  pallet: string | null;
  qty: string;
};

type WarehouseOption = { code: string; name: string | null };
type SearchParams = Record<string, string | string[] | undefined>;

function pickStr(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

function formatQty(value: string | number | null | undefined) {
  const n = typeof value === "number" ? value : Number.parseFloat(value ?? "");
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

/** ISO date string (YYYY-MM-DD) → dd-MM-yyyy for display. */
function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

export default async function IssueHistory({
  session,
  params,
}: {
  session: Session;
  params: SearchParams;
}) {
  const accessible = accessibleWarehouses(session);

  const search = pickStr(params.q);
  const requestedWh = pickStr(params.wh);
  const allTime = pickStr(params.all) === "1";
  const today = new Date().toISOString().slice(0, 10);
  const explicitFrom = pickStr(params.from);
  const explicitTo = pickStr(params.to);
  const fromDate = allTime ? "" : explicitFrom || (explicitTo ? "" : today);
  const toDate = allTime ? "" : explicitTo || (explicitFrom ? "" : today);
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  const whOptions =
    accessible === null
      ? await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE COALESCE(status, 1) = 1 ORDER BY code`,
        )
      : await query<WarehouseOption>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse
           WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );

  const allowedSet = new Set(whOptions.map((w) => w.code));
  const wh = requestedWh && allowedSet.has(requestedWh) ? requestedWh : "";

  // Headers are odg_wms_trans rows (flag 72, DP doc). Quantity/lines come from
  // the matching odg_wms_trans_detail rows.
  const where: string[] = [
    `h.trans_flag = ${ISSUE_STOCK_FLAG}`,
    `h.doc_no LIKE 'DP%'`,
    // Only real OUT documents (a −1 leg at a real warehouse). Excludes the +1
    // in-transit leg of a transfer and the receive/return docs (which move out of 9903).
    `EXISTS (SELECT 1 FROM public.odg_wms_trans_detail od WHERE od.doc_no = h.doc_no AND od.calc_flag = -1 AND od.wh_code <> '9903')`,
  ];
  const args: unknown[] = [];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`h.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`h.wh_code = $${args.length}`);
  }
  if (fromDate) {
    args.push(fromDate);
    where.push(`h.doc_date >= $${args.length}`);
  }
  if (toDate) {
    args.push(toDate);
    where.push(`h.doc_date <= $${args.length}`);
  }
  if (search) {
    args.push(`%${search}%`);
    const i = args.length;
    where.push(
      `(h.doc_no ILIKE $${i} OR h.doc_ref ILIKE $${i} OR h.user_created ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM public.odg_wms_trans_detail x
          WHERE x.doc_no = h.doc_no AND (x.item_code ILIKE $${i} OR x.item_name ILIKE $${i})
        ))`,
    );
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const [countRows, docs] = await Promise.all([
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.odg_wms_trans h ${whereSql}`,
      args,
    ),
    query<DocRow>(
      `SELECT
         h.doc_no,
         to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
         h.doc_time,
         h.doc_ref,
         h.wh_code,
         w.name_1 AS wh_name,
         h.user_created AS creator_code,
         e.fullname_lo AS creator_name,
         COALESCE(agg.line_count, 0) AS line_count,
         COALESCE(agg.out_qty, 0)::text AS out_qty
       FROM public.odg_wms_trans h
       LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
       LEFT JOIN public.odg_employee e ON e.employee_code = h.user_created
       LEFT JOIN (
         SELECT doc_no, count(*)::int AS line_count, SUM(qty) AS out_qty
         FROM public.odg_wms_trans_detail
         WHERE calc_flag = -1 AND wh_code <> '9903'
         GROUP BY doc_no
       ) agg ON agg.doc_no = h.doc_no
       ${whereSql}
       ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
    ),
  ]);

  const total = countRows[0]?.n ?? 0;
  const hasNext = docs.length > PAGE_SIZE;
  const pageDocs = hasNext ? docs.slice(0, PAGE_SIZE) : docs;

  const docNos = pageDocs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT doc_no, item_code, item_name, unit_code, shelf_code, shelf_code1, pallet,
                qty::text AS qty
         FROM public.odg_wms_trans_detail
         WHERE doc_no = ANY($1) AND calc_flag = -1 AND wh_code <> '9903'
         ORDER BY doc_no, roworder`,
        [docNos],
      )
    : [];

  const linesByDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.doc_no);
    if (arr) arr.push(l);
    else linesByDoc.set(l.doc_no, [l]);
  }

  // Related ERP documents (ໃບເບີກ 56 / ໃບໂອນ 70+72) this issue posted, linked via
  // ic_trans.doc_ref_trans = <DP doc>.
  const erpDocs = docNos.length
    ? await query<{ dp: string; doc_no: string; trans_flag: number }>(
        `SELECT DISTINCT doc_ref_trans AS dp, doc_no, trans_flag
         FROM public.ic_trans
         WHERE doc_ref_trans = ANY($1)
         ORDER BY doc_no, trans_flag`,
        [docNos],
      )
    : [];
  const ERP_FLAG_LABEL: Record<number, string> = { 56: "ໃບເບີກ", 70: "ໃບເບີກ(ເຂົ້າ)", 72: "ໃບໂອນ" };
  const erpByDoc = new Map<string, { doc_no: string; label: string }[]>();
  for (const e of erpDocs) {
    const arr = erpByDoc.get(e.dp) ?? [];
    arr.push({ doc_no: e.doc_no, label: ERP_FLAG_LABEL[e.trans_flag] ?? `flag ${e.trans_flag}` });
    erpByDoc.set(e.dp, arr);
  }

  const todayCount = pageDocs.filter((d) => d.doc_date === today).length;

  const dateLabel = allTime
    ? "ທຸກວັນ"
    : fromDate && toDate && fromDate === toDate
      ? fromDate === today
        ? "ມື້ນີ້"
        : fmtDate(fromDate)
      : fromDate && toDate
        ? `${fmtDate(fromDate)} → ${fmtDate(toDate)}`
        : fromDate
          ? fmtDate(fromDate)
          : toDate
            ? fmtDate(toDate)
            : "—";

  function buildHref(
    overrides: Partial<{ q: string; wh: string; from: string; to: string; page: string; all: string }>,
  ) {
    const sp = new URLSearchParams();
    sp.set("tab", "history");
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
    return `?${sp.toString()}`;
  }

  const inputCls =
    "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<ListIcon className="h-4 w-4" />} label="ເອກະສານທັງໝົດ" value={total} sub={dateLabel} />
        <KpiCard icon={<CalendarIcon className="h-4 w-4" />} label="ໃນໜ້ານີ້ (ມື້ນີ້)" value={todayCount} />
        <KpiCard icon={<BuildingIcon className="h-4 w-4" />} label="ສາງໃນສິດ" value={accessible === null ? "ທຸກສາງ" : `${whOptions.length}`} />
      </section>

      {/* Filter */}
      <form method="get" className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <input type="hidden" name="tab" value="history" />
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_170px_170px]">
          <div>
            <label className={labelCls}>ຄົ້ນຫາ (doc_no / ອ້າງອີງ / ສິນຄ້າ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" name="q" defaultValue={search} placeholder="ເຊັ່ນ DP260626 ຫຼື ຊື່ສິນຄ້າ" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>ສາງ</label>
            <select name="wh" defaultValue={wh} className={inputCls}>
              <option value="">{accessible === null ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${whOptions.length})`}</option>
              {whOptions.map((w) => (
                <option key={w.code} value={w.code}>
                  {w.code} {w.name ? `· ${w.name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>ຈາກວັນທີ</label>
            <input type="date" name="from" defaultValue={fromDate} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ຫາວັນທີ</label>
            <input type="date" name="to" defaultValue={toDate} className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`${BASE_PATH}?tab=history`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
              ມື້ນີ້
            </Link>
            <Link href={`${BASE_PATH}?tab=history&all=1`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
              ທຸກວັນ
            </Link>
          </div>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-red-500 to-orange-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-red-500/20 transition hover:shadow-lg">
            ກອງ
          </button>
        </div>
      </form>

      {pageDocs.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-7 w-7" />}
          title="ບໍ່ມີປະຫວັດການຈ່າຍໃນຊ່ວງທີ່ເລືອກ"
          description='ລອງປ່ຽນຊ່ວງວັນທີ ຫຼື ກົດ "ທຸກວັນ" ເພື່ອເບິ່ງທັງໝົດ'
        />
      ) : (
        <div className="space-y-3">
          {pageDocs.map((d) => {
            const docLines = linesByDoc.get(d.doc_no) ?? [];
            return (
              <details key={d.doc_no} open={pageDocs.length <= 5} className="group shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 font-mono text-[10px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    {(d.wh_code ?? "?").slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                      {d.doc_ref && <Chip tone="red">ref: {d.doc_ref}</Chip>}
                      {d.wh_code && (
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                          <BuildingIcon className="h-3 w-3" />
                          {d.wh_code}
                          {d.wh_name ? ` · ${d.wh_name}` : ""}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1">
                        <CalendarIcon className="h-3 w-3" />
                        {fmtDate(d.doc_date)}
                        {d.doc_time ? ` ${d.doc_time}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {d.creator_name ?? d.creator_code ?? "—"}
                        {d.creator_name && d.creator_code ? ` (${d.creator_code})` : ""}
                      </span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-base font-bold tabular-nums text-red-600 dark:text-red-400">−{formatQty(d.out_qty)}</div>
                    <div className="text-[10px] text-zinc-400">{d.line_count} ລາຍການ</div>
                  </div>
                  <a href={`/print/wms/${encodeURIComponent(d.doc_no)}?auto=1`} target="_blank" rel="noopener"
                    title="ພິມໃບຈ່າຍ" className="shrink-0 rounded-lg p-2 text-zinc-400 ring-1 ring-zinc-200 transition hover:bg-slate-50 hover:text-slate-700 dark:ring-zinc-800">🖨</a>
                  <DeleteIssueButton docNo={d.doc_no} />
                </summary>

                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                        <th className="px-4 py-2">ສິນຄ້າ</th>
                        <th className="px-4 py-2">ພື້ນທີ່</th>
                        <th className="px-4 py-2 text-right">ຈ່າຍອອກ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {docLines.map((l, idx) => {
                        const loc = [l.shelf_code, l.shelf_code1, l.pallet].filter(Boolean).join(" / ");
                        return (
                          <tr key={`${l.doc_no}-${l.item_code}-${idx}`}>
                            <td className="px-4 py-2">
                              <div className="font-mono text-[11px] font-bold text-red-600 dark:text-red-400">{l.item_code}</div>
                              <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{loc || "—"}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs font-bold tabular-nums text-red-600 dark:text-red-400">
                              −{formatQty(l.qty)}
                              <span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* ເອກະສານທີ່ກ່ຽວຂ້ອງ */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 bg-zinc-50/40 px-4 py-2.5 text-[11px] dark:border-zinc-800 dark:bg-zinc-950/20">
                    <span className="font-bold text-zinc-500 dark:text-zinc-400">ເອກະສານກ່ຽວຂ້ອງ:</span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold text-red-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-red-400 dark:ring-zinc-800" title="WMS ໃບຈ່າຍ">DP · {d.doc_no}</span>
                    {d.doc_ref && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold text-blue-600 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-blue-400 dark:ring-zinc-800" title="ໃບຂໍ (ຕົ້ນທາງ)">ໃບຂໍ · {d.doc_ref}</span>
                    )}
                    {(erpByDoc.get(d.doc_no) ?? []).map((e) => (
                      <span key={e.doc_no + e.label} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 font-mono font-semibold text-emerald-700 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-emerald-400 dark:ring-zinc-800" title="ERP">{e.label} · {e.doc_no}</span>
                    ))}
                    {(erpByDoc.get(d.doc_no) ?? []).length === 0 && (
                      <span className="text-[10px] text-zinc-400">(ບໍ່ມີ ERP doc ຫຼື ຍັງບໍ່ post)</span>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {pageDocs.length > 0 && (
        <nav className="shadow-card flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            ໜ້າ <span className="font-semibold text-zinc-700 dark:text-zinc-200">{page}</span> · ສະແດງ{" "}
            {pageDocs.length.toLocaleString("en-US")} ຈາກ {total.toLocaleString("en-US")}
          </div>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={`${BASE_PATH}${buildHref({ page: String(page - 1) })}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                ← ກ່ອນໜ້າ
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">← ກ່ອນໜ້າ</span>
            )}
            {hasNext ? (
              <Link href={`${BASE_PATH}${buildHref({ page: String(page + 1) })}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800 dark:hover:bg-zinc-800">
                ໜ້າຕໍ່ →
              </Link>
            ) : (
              <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">ໜ້າຕໍ່ →</span>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

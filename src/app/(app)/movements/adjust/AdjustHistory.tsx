import Link from "next/link";
import { query } from "@/lib/db";
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
/** Same-page route; history lives under the "ປະຫວັດ" tab of the adjust page. */
const BASE_PATH = "/movements/adjust";

const REASON_LABEL: Record<string, string> = {
  count: "ນັບສິນຄ້າ",
  damaged: "ເສຍຫາຍ",
  lost: "ສູນຫາຍ",
  found: "ພົບເພີ່ມ",
  other: "ອື່ນໆ",
};

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  doc_type: string | null;
  note: string | null;
  wh_code: string | null;
  wh_name: string | null;
  creator_code: string | null;
  creator_name: string | null;
  status: number | null;
  line_count: number;
  inc_qty: string;
  dec_qty: string;
};

type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  shelf_code: string | null;
  box_code: string | null;
  before_qty: string;
  counted_qty: string;
  diff_qty: string;
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
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function reasonLabel(code: string | null) {
  if (!code) return "—";
  return REASON_LABEL[code] ?? code;
}

export default async function AdjustHistory({
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

  // The adjust route stores the warehouse as a "[wh] note" prefix in the header
  // remark. We split it with position()/substring() (POSIX regex bracket classes
  // can't safely contain a literal ']').
  const docsCte = `
    docs AS (
      SELECT
        h.doc_no,
        to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
        h.doc_time,
        h.doc_type,
        h.creator_code,
        h.status,
        CASE
          WHEN left(h.remark, 1) = '[' AND position(']' in h.remark) > 1
          THEN NULLIF(substring(h.remark from 2 for position(']' in h.remark) - 2), '')
          ELSE NULL
        END AS wh_code,
        CASE
          WHEN left(h.remark, 1) = '[' AND position(']' in h.remark) > 0
          THEN NULLIF(btrim(substring(h.remark from position(']' in h.remark) + 1)), '')
          ELSE NULLIF(btrim(h.remark), '')
        END AS note,
        e.fullname_lo AS creator_name
      FROM public.wms_product_adj_stock h
      LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
    )`;

  const where: string[] = [];
  const args: unknown[] = [];

  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`d.wh_code = ANY($${args.length})`);
  }
  if (wh) {
    args.push(wh);
    where.push(`d.wh_code = $${args.length}`);
  }
  if (fromDate) {
    args.push(fromDate);
    where.push(`d.doc_date >= $${args.length}`);
  }
  if (toDate) {
    args.push(toDate);
    where.push(`d.doc_date <= $${args.length}`);
  }
  if (search) {
    args.push(`%${search}%`);
    const i = args.length;
    where.push(
      `(d.doc_no ILIKE $${i} OR d.creator_name ILIKE $${i} OR d.creator_code ILIKE $${i} OR d.note ILIKE $${i}
        OR EXISTS (
          SELECT 1 FROM public.wms_product_adj_stock_detail x
          LEFT JOIN public.ic_inventory i2 ON i2.code = x.item_code
          WHERE x.doc_no = d.doc_no AND (x.item_code ILIKE $${i} OR i2.name_1 ILIKE $${i})
        ))`,
    );
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [countRows, docs] = await Promise.all([
    query<{ n: number }>(
      `WITH ${docsCte} SELECT count(*)::int AS n FROM docs d ${whereSql}`,
      args,
    ),
    query<DocRow>(
      `WITH ${docsCte}
       SELECT
         d.doc_no,
         d.doc_date,
         d.doc_time,
         d.doc_type,
         d.note,
         d.wh_code,
         w.name_1 AS wh_name,
         d.creator_code,
         d.creator_name,
         d.status,
         COALESCE(agg.line_count, 0) AS line_count,
         COALESCE(agg.inc_qty, 0)::text AS inc_qty,
         COALESCE(agg.dec_qty, 0)::text AS dec_qty
       FROM docs d
       LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
       LEFT JOIN (
         SELECT
           doc_no,
           count(*)::int AS line_count,
           SUM(diff_qty) FILTER (WHERE diff_qty > 0) AS inc_qty,
           SUM(diff_qty) FILTER (WHERE diff_qty < 0) AS dec_qty
         FROM public.wms_product_adj_stock_detail
         GROUP BY doc_no
       ) agg ON agg.doc_no = d.doc_no
       ${whereSql}
       ORDER BY d.doc_date DESC NULLS LAST, d.doc_time DESC NULLS LAST, d.doc_no DESC
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
        `SELECT
           x.doc_no,
           x.item_code,
           i.name_1 AS item_name,
           x.unit_code,
           x.shelf_code,
           x.box_code,
           x.current_qty::text AS before_qty,
           x.qty::text AS counted_qty,
           x.diff_qty::text AS diff_qty
         FROM public.wms_product_adj_stock_detail x
         LEFT JOIN public.ic_inventory i ON i.code = x.item_code
         WHERE x.doc_no = ANY($1)
         ORDER BY x.doc_no, x.roworder`,
        [docNos],
      )
    : [];

  const linesByDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.doc_no);
    if (arr) arr.push(l);
    else linesByDoc.set(l.doc_no, [l]);
  }

  const todayCount = pageDocs.filter((d) => d.doc_date === today).length;

  const dateLabel = allTime
    ? "ທຸກວັນ"
    : fromDate && toDate && fromDate === toDate
      ? fromDate === today
        ? "ມື້ນີ້"
        : fromDate
      : fromDate && toDate
        ? `${fromDate} → ${toDate}`
        : fromDate || toDate || "—";

  function buildHref(
    overrides: Partial<{
      q: string;
      wh: string;
      from: string;
      to: string;
      page: string;
      all: string;
    }>,
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
    "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-indigo-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
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
            <label className={labelCls}>ຄົ້ນຫາ (doc_no / ຜູ້ປັບປຸງ / ສິນຄ້າ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" name="q" defaultValue={search} placeholder="ເຊັ່ນ ADJ260617 ຫຼື ຊື່ສິນຄ້າ" className={`${inputCls} pl-9`} />
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
          <button type="submit" className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 transition hover:shadow-lg">
            ກອງ
          </button>
        </div>
      </form>

      {/* Documents */}
      {pageDocs.length === 0 ? (
        <EmptyState
          icon={<PackageIcon className="h-7 w-7" />}
          title="ບໍ່ມີປະຫວັດການປັບປຸງໃນຊ່ວງທີ່ເລືອກ"
          description='ລອງປ່ຽນຊ່ວງວັນທີ ຫຼື ກົດ "ທຸກວັນ" ເພື່ອເບິ່ງທັງໝົດ'
        />
      ) : (
        <div className="space-y-3">
          {pageDocs.map((d) => {
            const docLines = linesByDoc.get(d.doc_no) ?? [];
            const inc = Number.parseFloat(d.inc_qty) || 0;
            const dec = Number.parseFloat(d.dec_qty) || 0;
            return (
              <details
                key={d.doc_no}
                open={pageDocs.length <= 5}
                className="group shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
              >
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 font-mono text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    {(d.wh_code ?? "?").slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                      <Chip tone="amber">{reasonLabel(d.doc_type)}</Chip>
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
                        {d.doc_date ?? "—"}
                        {d.doc_time ? ` ${d.doc_time}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {d.creator_name ?? d.creator_code ?? "—"}
                        {d.creator_name && d.creator_code ? ` (${d.creator_code})` : ""}
                      </span>
                      {d.note && <span className="truncate">📝 {d.note}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-2 font-mono text-xs font-bold tabular-nums">
                      {inc > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{formatQty(inc)}</span>}
                      {dec < 0 && <span className="text-red-600 dark:text-red-400">{formatQty(dec)}</span>}
                      {inc === 0 && dec === 0 && <span className="text-zinc-400">0</span>}
                    </div>
                    <div className="text-[10px] text-zinc-400">{d.line_count} ລາຍການ</div>
                  </div>
                </summary>

                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                        <th className="px-4 py-2">ສິນຄ້າ</th>
                        <th className="px-4 py-2">ພື້ນທີ່</th>
                        <th className="px-4 py-2 text-right">ກ່ອນ</th>
                        <th className="px-4 py-2 text-right">ຫຼັງ</th>
                        <th className="px-4 py-2 text-right">ປ່ຽນແປງ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {docLines.map((l, idx) => {
                        const diff = Number.parseFloat(l.diff_qty) || 0;
                        const dColor =
                          diff > 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : diff < 0
                              ? "text-red-600 dark:text-red-400"
                              : "text-zinc-400";
                        const loc = [l.shelf_code, l.box_code].filter(Boolean).join(" / ");
                        return (
                          <tr key={`${l.doc_no}-${l.item_code}-${idx}`}>
                            <td className="px-4 py-2">
                              <div className="font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{l.item_code}</div>
                              <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>
                                {l.item_name ?? "—"}
                              </div>
                            </td>
                            <td className="px-4 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{loc || "—"}</td>
                            <td className="px-4 py-2 text-right font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                              {formatQty(l.before_qty)}
                              <span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                              {formatQty(l.counted_qty)}
                            </td>
                            <td className={`px-4 py-2 text-right font-mono text-xs font-bold tabular-nums ${dColor}`}>
                              {diff > 0 ? "+" : ""}
                              {formatQty(diff)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {/* Pagination */}
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

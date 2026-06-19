import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarIcon, ListIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { Card, Hero, KpiCard } from "@/components/ui/Card";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | string[] | undefined>;
type SerialRow = {
  samsung_serial_id: string;
  record_date: string | null;
  record_year: number;
  record_month: number;
  record_day: number;
  serial_no: string;
  duplicate_count: number;
  duplicate_bills: string | null;
  item_code: string | null;
  product_name: string;
  bill_no: string | null;
  week_label: string | null;
  quantity: string;
  quarter_label: string | null;
  note: string | null;
  claim_note: string | null;
};

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function pageHref(
  current: {
    q: string;
    year: string;
    quarter: string;
    claim: string;
    duplicate: string;
  },
  changes: Partial<{
    q: string;
    year: string;
    quarter: string;
    claim: string;
    duplicate: string;
    page: number;
  }>,
) {
  const next = { ...current, ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.year) params.set("year", next.year);
  if (next.quarter) params.set("quarter", next.quarter);
  if (next.claim) params.set("claim", next.claim);
  if (next.duplicate) params.set("duplicate", next.duplicate);
  if (changes.page && changes.page > 1) params.set("page", String(changes.page));
  const queryString = params.toString();
  return queryString ? `/samsung-serials?${queryString}` : "/samsung-serials";
}

export default async function SamsungSerialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return (
      <Card className="mx-auto max-w-md p-6 text-center text-sm text-amber-700">
        ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS
      </Card>
    );
  }

  const params = await searchParams;
  const q = pick(params.q);
  const year = pick(params.year);
  const quarter = pick(params.quarter);
  const claim = pick(params.claim);
  const duplicate = pick(params.duplicate);
  const page = Math.max(1, Number.parseInt(pick(params.page), 10) || 1);

  const args: unknown[] = [];
  const where: string[] = [];
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    where.push(
      `(s.serial_no ILIKE $${args.length} ESCAPE '\\'
        OR s.product_name ILIKE $${args.length} ESCAPE '\\'
        OR s.bill_no ILIKE $${args.length} ESCAPE '\\'
        OR s.item_code ILIKE $${args.length} ESCAPE '\\')`,
    );
  }
  if (/^\d{4}$/.test(year)) {
    args.push(Number(year));
    where.push(`s.record_year = $${args.length}`);
  }
  if (/^Q[1-4]$/.test(quarter)) {
    args.push(quarter);
    where.push(`s.quarter_label = $${args.length}`);
  }
  if (claim === "with") {
    where.push(`(NULLIF(BTRIM(s.note), '') IS NOT NULL OR NULLIF(BTRIM(s.claim_note), '') IS NOT NULL)`);
  } else if (claim === "without") {
    where.push(`NULLIF(BTRIM(s.note), '') IS NULL AND NULLIF(BTRIM(s.claim_note), '') IS NULL`);
  }
  if (duplicate === "only") {
    where.push(`EXISTS (
      SELECT 1
      FROM public.wms_samsung_serial duplicate_filter
      WHERE duplicate_filter.serial_no = s.serial_no
        AND duplicate_filter.samsung_serial_id <> s.samsung_serial_id
    )`);
  } else if (duplicate === "unique") {
    where.push(`NOT EXISTS (
      SELECT 1
      FROM public.wms_samsung_serial duplicate_filter
      WHERE duplicate_filter.serial_no = s.serial_no
        AND duplicate_filter.samsung_serial_id <> s.samsung_serial_id
    )`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const listArgs = [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE];

  const [rows, countRows, years, totals] = await Promise.all([
    query<SerialRow>(
      `SELECT s.samsung_serial_id::text, s.record_date::text,
              s.record_year, s.record_month, s.record_day, s.serial_no,
              (
                SELECT count(*)::int
                FROM public.wms_samsung_serial duplicate
                WHERE duplicate.serial_no = s.serial_no
              ) AS duplicate_count,
              (
                SELECT string_agg(
                  DISTINCT COALESCE(NULLIF(BTRIM(duplicate.bill_no), ''), 'ບໍ່ມີເລກບິນ'),
                  ', '
                )
                FROM public.wms_samsung_serial duplicate
                WHERE duplicate.serial_no = s.serial_no
                  AND duplicate.samsung_serial_id <> s.samsung_serial_id
              ) AS duplicate_bills,
              s.item_code,
              s.product_name, s.bill_no, s.week_label, s.quantity::text,
              s.quarter_label, s.note, s.claim_note
       FROM public.wms_samsung_serial s
       ${whereSql}
       ORDER BY s.record_year DESC, s.record_month DESC, s.record_day DESC, s.source_row DESC
       LIMIT $${listArgs.length - 1} OFFSET $${listArgs.length}`,
      listArgs,
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.wms_samsung_serial s
       ${whereSql}`,
      args,
    ),
    query<{ record_year: number }>(
      `SELECT DISTINCT record_year FROM public.wms_samsung_serial ORDER BY record_year DESC`,
    ),
    query<{ total: number; unique_serials: number; claimed: number }>(
      `SELECT count(*)::int AS total,
              count(DISTINCT serial_no)::int AS unique_serials,
              count(*) FILTER (
                WHERE NULLIF(BTRIM(note), '') IS NOT NULL
                   OR NULLIF(BTRIM(claim_note), '') IS NOT NULL
              )::int AS claimed
       FROM public.wms_samsung_serial`,
    ),
  ]);

  const filteredCount = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const summary = totals[0] ?? { total: 0, unique_serials: 0, claimed: 0 };
  const current = { q, year, quarter, claim, duplicate };

  return (
    <div className="space-y-5">
      <Hero
        title="ລາຍການ SN Samsung"
        description="ຄົ້ນຫາ Serial Number, ສິນຄ້າ, ເລກບິນ ແລະຂໍ້ມູນເຄມ"
        icon={<PackageIcon className="h-6 w-6" />}
        tone="blue"
        right={
          <Link
            href="/samsung-serials/missing"
            className="inline-flex rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700"
          >
            ເບິ່ງ SN ທີ່ຂາດ
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<ListIcon />} label="ລາຍການທັງໝົດ" value={summary.total} tone="blue" highlight />
        <KpiCard icon={<PackageIcon />} label="SN ບໍ່ຊ້ຳ" value={summary.unique_serials} tone="indigo" />
        <KpiCard icon={<CalendarIcon />} label="ມີຂໍ້ມູນເຄມ" value={summary.claimed} tone="amber" />
      </div>

      <Card>
        <form method="get" className="grid gap-3 border-b border-zinc-200 p-4 lg:grid-cols-[minmax(240px,1fr)_110px_100px_140px_150px_auto] dark:border-zinc-800">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="ຄົ້ນຫາ SN, ລະຫັດສິນຄ້າ ຫຼື ເລກບິນ..."
              className="w-full rounded-xl bg-white py-2.5 pl-9 pr-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700"
            />
          </div>
          <select name="year" defaultValue={year} className="rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-700">
            <option value="">ທຸກປີ</option>
            {years.map((item) => <option key={item.record_year} value={item.record_year}>{item.record_year}</option>)}
          </select>
          <select name="quarter" defaultValue={quarter} className="rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-700">
            <option value="">ທຸກ Q</option>
            {["Q1", "Q2", "Q3", "Q4"].map((item) => <option key={item}>{item}</option>)}
          </select>
          <select name="claim" defaultValue={claim} className="rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-700">
            <option value="">ທຸກສະຖານະ</option>
            <option value="with">ມີຂໍ້ມູນເຄມ</option>
            <option value="without">ບໍ່ມີຂໍ້ມູນເຄມ</option>
          </select>
          <select name="duplicate" defaultValue={duplicate} className="rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:ring-zinc-700">
            <option value="">ທຸກ Serial</option>
            <option value="only">ເຄມຊ້ຳ</option>
            <option value="unique">ບໍ່ຊ້ຳ</option>
          </select>
          <button type="submit" className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
            ຄົ້ນຫາ
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-zinc-500">
          <span>ພົບ {filteredCount.toLocaleString("en-US")} ລາຍການ</span>
          {(q || year || quarter || claim || duplicate) && <Link href="/samsung-serials" className="font-semibold text-blue-600 hover:text-blue-700">ລ້າງຕົວກອງ</Link>}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1220px] w-full text-left text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-950/60">
              <tr>
                <th className="px-4 py-3 font-semibold">ວັນທີ</th>
                <th className="px-4 py-3 font-semibold">Serial No.</th>
                <th className="px-4 py-3 font-semibold">ລະຫັດສິນຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ຊື່ສິນຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ເລກບິນ</th>
                <th className="px-4 py-3 font-semibold">ອາທິດ / Q</th>
                <th className="px-4 py-3 text-right font-semibold">ຈຳນວນ</th>
                <th className="px-4 py-3 font-semibold">ໝາຍເຫດ / ເຄມ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row) => {
                const claimText = [row.note, row.claim_note].filter(Boolean).join(" · ");
                const displayDate =
                  row.record_date ??
                  `${row.record_year}-${String(row.record_month).padStart(2, "0")}-${String(row.record_day).padStart(2, "0")} *`;
                return (
                  <tr key={row.samsung_serial_id} className="align-top transition hover:bg-blue-50/40 dark:hover:bg-blue-950/10">
                    <td className={`whitespace-nowrap px-4 py-3 ${row.record_date ? "text-zinc-600 dark:text-zinc-400" : "font-medium text-red-600 dark:text-red-400"}`}>{displayDate}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`font-mono font-semibold ${
                          row.duplicate_count > 1
                            ? "text-red-600 dark:text-red-400"
                            : "text-blue-700 dark:text-blue-300"
                        }`}
                      >
                        {row.serial_no}
                      </span>
                      {row.duplicate_count > 1 && (
                        <>
                          <span className="ml-2 inline-flex rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900/60">
                            ຊ້ຳ {row.duplicate_count}
                          </span>
                          <div className="mt-1 max-w-72 whitespace-normal text-[11px] font-medium leading-4 text-red-600 dark:text-red-400">
                            ຊ້ຳກັບບິນ: {row.duplicate_bills || "ບໍ່ມີເລກບິນ"}
                          </div>
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {row.item_code ? (
                        <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {row.item_code}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">ບໍ່ພົບໃນ sn_inventory</span>
                      )}
                    </td>
                    <td className="max-w-md px-4 py-3 text-zinc-800 dark:text-zinc-200">{row.product_name}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-400">{row.bill_no || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-400">{[row.week_label, row.quarter_label].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{Number(row.quantity).toLocaleString("en-US")}</td>
                    <td className="max-w-sm px-4 py-3">
                      {claimText ? <span className="inline-flex rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50">{claimText}</span> : <span className="text-zinc-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="px-6 py-16 text-center text-sm text-zinc-500">ບໍ່ພົບລາຍການ SN Samsung</div>}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
            <Link
              href={pageHref(current, { page: Math.max(1, page - 1) })}
              aria-disabled={page <= 1}
              className={`rounded-lg px-3 py-1.5 font-medium ring-1 ring-zinc-200 dark:ring-zinc-700 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
            >
              ກ່ອນໜ້າ
            </Link>
            <span className="text-xs text-zinc-500">ໜ້າ {Math.min(page, totalPages)} / {totalPages}</span>
            <Link
              href={pageHref(current, { page: Math.min(totalPages, page + 1) })}
              aria-disabled={page >= totalPages}
              className={`rounded-lg px-3 py-1.5 font-medium ring-1 ring-zinc-200 dark:ring-zinc-700 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
            >
              ໜ້າຕໍ່ໄປ
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

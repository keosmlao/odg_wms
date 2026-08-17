import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import { Card, Hero, KpiCard } from "@/components/ui/Card";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | string[] | undefined>;
type MissingRow = {
  sn: string;
  item_code: string | null;
  item_name: string | null;
  status: number | null;
  wh_code: string | null;
  unit_code: string | null;
  item_brand: string | null;
};

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function href(current: { q: string; status: string }, page: number) {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.status) params.set("status", current.status);
  if (page > 1) params.set("page", String(page));
  return `/samsung-serials/missing${params.size ? `?${params}` : ""}`;
}

export default async function MissingSamsungSerialsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) redirect("/samsung-serials");

  const params = await searchParams;
  const q = pick(params.q);
  const status = pick(params.status);
  const page = Math.max(1, Number.parseInt(pick(params.page), 10) || 1);

  const args: unknown[] = [];
  const where = [
    `NULLIF(BTRIM(i.sn), '') IS NOT NULL`,
    `inventory.item_brand = 'SAMSUNG'`,
    `NOT EXISTS (
      SELECT 1
      FROM public.wms_samsung_serial samsung
      WHERE samsung.serial_no = i.sn
    )`,
  ];

  if (q) {
    args.push(`%${escapeLike(q)}%`);
    where.push(`(
      i.sn ILIKE $${args.length} ESCAPE '\\'
      OR i.item_code ILIKE $${args.length} ESCAPE '\\'
      OR i.item_name ILIKE $${args.length} ESCAPE '\\'
      OR i.wh_code ILIKE $${args.length} ESCAPE '\\'
      OR inventory.item_brand ILIKE $${args.length} ESCAPE '\\'
    )`);
  }
  if (status === "stock") {
    where.push(`COALESCE(i.status, 0) = 0`);
  } else if (status === "other") {
    where.push(`COALESCE(i.status, 0) <> 0`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const listArgs = [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE];

  const [rows, filtered, totals] = await Promise.all([
    query<MissingRow>(
      `SELECT i.sn, i.item_code, i.item_name, i.status, i.wh_code, i.unit_code,
              inventory.item_brand
       FROM public.sn_inventory i
       INNER JOIN public.ic_inventory inventory
         ON inventory.code = i.item_code
       ${whereSql}
       ORDER BY i.item_code, i.sn
       LIMIT $${listArgs.length - 1} OFFSET $${listArgs.length}`,
      listArgs,
    ),
    query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM public.sn_inventory i
       INNER JOIN public.ic_inventory inventory
         ON inventory.code = i.item_code
       ${whereSql}`,
      args,
    ),
    query<{ total: number; in_stock: number; other_status: number; item_count: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE COALESCE(i.status, 0) = 0)::int AS in_stock,
              count(*) FILTER (WHERE COALESCE(i.status, 0) <> 0)::int AS other_status,
              count(DISTINCT i.item_code)::int AS item_count
       FROM public.sn_inventory i
       INNER JOIN public.ic_inventory inventory
         ON inventory.code = i.item_code
       WHERE NULLIF(BTRIM(i.sn), '') IS NOT NULL
         AND inventory.item_brand = 'SAMSUNG'
         AND NOT EXISTS (
           SELECT 1
           FROM public.wms_samsung_serial samsung
           WHERE samsung.serial_no = i.sn
         )`,
    ),
  ]);

  const count = filtered[0]?.count ?? 0;
  const summary = totals[0] ?? { total: 0, in_stock: 0, other_status: 0, item_count: 0 };
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const current = { q, status };

  return (
    <div className="space-y-5">
      <Hero
        title="Samsung SN ທີ່ບໍ່ຢູ່ໃນລາຍການ"
        description="ກອງ brand SAMSUNG ຈາກ ic_inventory ແລ້ວປຽບທຽບ Serial ກັບລາຍການ"
        icon={<AlertIcon className="h-6 w-6" />}
        tone="red"
        right={
          <Link
            href="/samsung-serials"
            className="inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700"
          >
            ກັບລາຍການຫຼັກ
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <KpiCard icon={<AlertIcon />} label="SN ທີ່ຂາດ" value={summary.total} tone="red" highlight />
        <KpiCard icon={<PackageIcon />} label="ຍັງຢູ່ໃນສາງ" value={summary.in_stock} tone="emerald" />
        <KpiCard icon={<PackageIcon />} label="ຂາຍອອກໄປ" value={summary.other_status} tone="amber" />
        <KpiCard icon={<PackageIcon />} label="ລະຫັດສິນຄ້າ" value={summary.item_count} tone="brand" />
      </div>

      <Card>
        <form method="get" className="grid gap-3 border-b border-zinc-200 p-4 sm:grid-cols-[1fr_180px_auto] dark:border-zinc-800">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="ຄົ້ນຫາ SN, ລະຫັດສິນຄ້າ, ຊື່ ຫຼື ສາງ..."
              className="w-full rounded-xl bg-white py-2.5 pl-9 pr-3 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:ring-zinc-700"
            />
          </div>
          <select name="status" defaultValue={status} className="rounded-xl bg-white px-3 py-2.5 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-red-500 dark:bg-zinc-950 dark:ring-zinc-700">
            <option value="">ທຸກສະຖານະ</option>
            <option value="stock">ຍັງຢູ່ໃນສາງ</option>
            <option value="other">ຂາຍອອກໄປ</option>
          </select>
          <button className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-700">
            ຄົ້ນຫາ
          </button>
        </form>

        <div className="flex items-center justify-between px-4 py-3 text-xs text-zinc-500">
          <span>ພົບ {count.toLocaleString("en-US")} ລາຍການ</span>
          {(q || status) && <Link href="/samsung-serials/missing" className="font-semibold text-red-600">ລ້າງຕົວກອງ</Link>}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-left text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-950/60">
              <tr>
                <th className="px-4 py-3">Serial No.</th>
                <th className="px-4 py-3">ລະຫັດສິນຄ້າ</th>
                <th className="px-4 py-3">ຊື່ສິນຄ້າ</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">ສາງ</th>
                <th className="px-4 py-3">ຫົວໜ່ວຍ</th>
                <th className="px-4 py-3">ສະຖານະ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row) => (
                <tr key={row.sn} className="hover:bg-red-50/30 dark:hover:bg-red-950/10">
                  <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-red-600 dark:text-red-400">{row.sn}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">{row.item_code || "—"}</td>
                  <td className="max-w-lg px-4 py-3">{row.item_name || "—"}</td>
                  <td className="px-4 py-3 text-xs font-bold text-brand-700 dark:text-brand-300">{row.item_brand || "—"}</td>
                  <td className="px-4 py-3 font-mono">{row.wh_code || "—"}</td>
                  <td className="px-4 py-3">{row.unit_code || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${Number(row.status ?? 0) === 0 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"}`}>
                      {Number(row.status ?? 0) === 0 ? "ຢູ່ໃນສາງ" : Number(row.status) === 1 ? "ຂາຍອອກໄປ" : `ສະຖານະ ${row.status}`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
            <Link href={href(current, Math.max(1, page - 1))} className={`rounded-lg px-3 py-1.5 ring-1 ring-zinc-200 dark:ring-zinc-700 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}>ກ່ອນໜ້າ</Link>
            <span className="text-xs text-zinc-500">ໜ້າ {Math.min(page, totalPages)} / {totalPages}</span>
            <Link href={href(current, Math.min(totalPages, page + 1))} className={`rounded-lg px-3 py-1.5 ring-1 ring-zinc-200 dark:ring-zinc-700 ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}>ໜ້າຕໍ່ໄປ</Link>
          </div>
        )}
      </Card>
    </div>
  );
}

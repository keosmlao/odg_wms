import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertIcon, CheckIcon, ListIcon, PackageIcon, SearchIcon, TrendIcon } from "@/components/ui/Icons";
import { Card, Hero, KpiCard, Notice } from "@/components/ui/Card";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | string[] | undefined>;

type SummaryRow = {
  total: number;
  in_stock: number;
  sold: number;
  claimed: number;
  claimed_in_stock: number;
  item_count: number;
};

type ModelRow = {
  item_code: string | null;
  item_name: string | null;
  total: number;
  in_stock: number;
  sold: number;
  claimed: number;
};

type DetailRow = {
  sn: string;
  item_code: string | null;
  item_name: string | null;
  status: number | null;
  wh_code: string | null;
  sale_bill: string | null;
  claim_bill: string | null;
  claim_count: number;
  claim_text: string | null;
};

function pick(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

// SN Samsung ທີ່ມີຂໍ້ມູນເຄມ = ມີ note ຫຼື claim_note ໃນ wms_samsung_serial (ຈັບຄູ່ດ້ວຍ serial_no)
const CLAIM_EXISTS = `EXISTS (
  SELECT 1
  FROM public.wms_samsung_serial s
  WHERE s.serial_no = i.sn
    AND (NULLIF(BTRIM(s.note), '') IS NOT NULL OR NULLIF(BTRIM(s.claim_note), '') IS NOT NULL)
)`;

// ມຸມມອງລາຍລະອຽດ (filter ເພີ່ມໃສ່ຂອບເຂດ SN Samsung) — ທຸກຄ່າເປັນຄ່າຄົງທີ່ ບໍ່ມີ input ຜູ້ໃຊ້
const VIEWS: Record<string, { label: string; filter: string }> = {
  "claimed-in-stock": {
    label: "ເຄມແລ້ວ ແຕ່ຍັງຢູ່ໃນສາງ",
    filter: `${CLAIM_EXISTS} AND COALESCE(i.status, 0) = 0`,
  },
  claimed: { label: "ເຄມແລ້ວ", filter: CLAIM_EXISTS },
  sold: { label: "ຂາຍ / ຈ່າຍອອກແລ້ວ", filter: `COALESCE(i.status, 0) <> 0` },
  "in-stock": { label: "ຍັງຄົງເຫຼືອ", filter: `COALESCE(i.status, 0) = 0` },
  total: { label: "ທັງໝົດ", filter: "TRUE" },
};

export default async function SamsungSummaryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) redirect("/samsung-serials");

  const params = await searchParams;
  const q = pick(params.q);
  const view = VIEWS[pick(params.view)] ? pick(params.view) : "";
  const page = Math.max(1, Number.parseInt(pick(params.page), 10) || 1);

  // ຂອບເຂດ: SN Samsung ໃນສາງຈິງ (sn_inventory) ກອງ brand SAMSUNG ຈາກ ic_inventory
  const base = `FROM public.sn_inventory i
       INNER JOIN public.ic_inventory inv ON inv.code = i.item_code
       WHERE NULLIF(BTRIM(i.sn), '') IS NOT NULL
         AND inv.item_brand = 'SAMSUNG'`;

  const totalsPromise = query<SummaryRow>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE COALESCE(i.status, 0) = 0)::int AS in_stock,
            count(*) FILTER (WHERE COALESCE(i.status, 0) <> 0)::int AS sold,
            count(*) FILTER (WHERE ${CLAIM_EXISTS})::int AS claimed,
            count(*) FILTER (WHERE ${CLAIM_EXISTS} AND COALESCE(i.status, 0) = 0)::int AS claimed_in_stock,
            count(DISTINCT i.item_code)::int AS item_count
     ${base}`,
  );

  // ໂໝດ 1: ບໍ່ມີ view → ສະແດງຕາຕະລາງແຍກຕາມລຸ້ນສິນຄ້າ
  // ໂໝດ 2: ມີ view → ສະແດງລາຍການ SN ຕົວຈິງ (ມີ pagination)
  if (!view) {
    const modelArgs: unknown[] = [];
    let modelFilter = "";
    if (q) {
      modelArgs.push(`%${escapeLike(q)}%`);
      modelFilter = ` AND (i.item_code ILIKE $1 ESCAPE '\\' OR i.item_name ILIKE $1 ESCAPE '\\')`;
    }
    const [totals, models] = await Promise.all([
      totalsPromise,
      query<ModelRow>(
        `SELECT i.item_code,
                max(i.item_name) AS item_name,
                count(*)::int AS total,
                count(*) FILTER (WHERE COALESCE(i.status, 0) = 0)::int AS in_stock,
                count(*) FILTER (WHERE COALESCE(i.status, 0) <> 0)::int AS sold,
                count(*) FILTER (WHERE ${CLAIM_EXISTS})::int AS claimed
         ${base}${modelFilter}
         GROUP BY i.item_code
         ORDER BY count(*) DESC, i.item_code`,
        modelArgs,
      ),
    ]);
    const s = totals[0] ?? { total: 0, in_stock: 0, sold: 0, claimed: 0, claimed_in_stock: 0, item_count: 0 };

    return (
      <div className="space-y-5">
        <SummaryHeader />
        <KpiGrid s={s} />

        {s.claimed_in_stock > 0 && (
          <Notice
            tone="red"
            icon={<AlertIcon className="h-5 w-5" />}
            title={`ມີ ${s.claimed_in_stock.toLocaleString("en-US")} SN ທີ່ເຄມແລ້ວ ແຕ່ຍັງເປັນຄົງເຫຼືອ (status 0)`}
            description="ໝາຍຄວາມວ່າ SN ຖືກບັນທຶກເຄມ/ຂາຍ ໃນ wms_samsung_serial ແຕ່ໃນສາງຍັງບໍ່ໄດ້ຕັດ stock — ຄວນກວດ."
            action={
              <Link
                href="/samsung-serials/summary?view=claimed-in-stock"
                className="inline-flex rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                ເບິ່ງລາຍການ
              </Link>
            }
          />
        )}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">ແຍກຕາມລຸ້ນສິນຄ້າ</h2>
            <form method="get" className="flex gap-2">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  name="q"
                  defaultValue={q}
                  placeholder="ຄົ້ນຫາລະຫັດ ຫຼື ຊື່ສິນຄ້າ..."
                  className="w-64 rounded-xl bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-700"
                />
              </div>
              <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                ຄົ້ນຫາ
              </button>
              {q && (
                <Link
                  href="/samsung-serials/summary"
                  className="inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700"
                >
                  ລ້າງ
                </Link>
              )}
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-left text-sm">
              <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-950/60">
                <tr>
                  <th className="px-4 py-3 font-semibold">ລະຫັດສິນຄ້າ</th>
                  <th className="px-4 py-3 font-semibold">ຊື່ສິນຄ້າ</th>
                  <th className="px-4 py-3 text-right font-semibold">ທັງໝົດ</th>
                  <th className="px-4 py-3 text-right font-semibold">ຄົງເຫຼືອ</th>
                  <th className="px-4 py-3 text-right font-semibold">ຂາຍແລ້ວ</th>
                  <th className="px-4 py-3 text-right font-semibold">ເຄມແລ້ວ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {models.map((m) => (
                  <tr key={m.item_code ?? "—"} className="transition hover:bg-blue-50/40 dark:hover:bg-blue-950/10">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {m.item_code || "—"}
                    </td>
                    <td className="max-w-md px-4 py-3 text-zinc-800 dark:text-zinc-200">{m.item_name || "—"}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
                      {m.total.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {m.in_stock.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {m.sold.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {m.claimed > 0 ? (
                        <span className="inline-flex rounded-lg bg-violet-50 px-2 py-0.5 font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900/60">
                          {m.claimed.toLocaleString("en-US")}
                        </span>
                      ) : (
                        <span className="text-zinc-400">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              {models.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-zinc-200 bg-zinc-50 font-semibold dark:border-zinc-700 dark:bg-zinc-950/60">
                    <td className="px-4 py-3" colSpan={2}>ລວມ ({models.length.toLocaleString("en-US")} ລຸ້ນ)</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-zinc-900 dark:text-zinc-100">
                      {models.reduce((a, m) => a + m.total, 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                      {models.reduce((a, m) => a + m.in_stock, 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                      {models.reduce((a, m) => a + m.sold, 0).toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-violet-700 dark:text-violet-400">
                      {models.reduce((a, m) => a + m.claimed, 0).toLocaleString("en-US")}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
            {models.length === 0 && (
              <div className="px-6 py-16 text-center text-sm text-zinc-500">ບໍ່ພົບ SN Samsung ໃນສາງ</div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // ---- ໂໝດ 2: ລາຍລະອຽດ SN ຕາມ view ----
  const cfg = VIEWS[view];
  const args: unknown[] = [];
  let qFilter = "";
  if (q) {
    args.push(`%${escapeLike(q)}%`);
    qFilter = ` AND (i.sn ILIKE $${args.length} ESCAPE '\\' OR i.item_code ILIKE $${args.length} ESCAPE '\\' OR i.item_name ILIKE $${args.length} ESCAPE '\\')`;
  }
  const detailWhere = `${base} AND (${cfg.filter})${qFilter}`;
  const listArgs = [...args, PAGE_SIZE, (page - 1) * PAGE_SIZE];

  // ໃນ wms_samsung_serial: ແຖວ note='ເຄມມາແລ້ວ' (ຫຼື claim_note) = ທຸລະກຳເຄມ → bill_no ຄືບິນເຄມ;
  // ແຖວທີ່ບໍ່ມີ note/claim_note = ການຂາຍຈິງ → bill_no ຄືບິນຂາຍຈິງ. SN ໜຶ່ງເຄມໄດ້ຫຼາຍຄັ້ງ.
  const IS_CLAIM = `(NULLIF(BTRIM(s.note), '') IS NOT NULL OR NULLIF(BTRIM(s.claim_note), '') IS NOT NULL)`;
  const listFrom = `FROM public.sn_inventory i
       INNER JOIN public.ic_inventory inv ON inv.code = i.item_code
       LEFT JOIN LATERAL (
         SELECT
           string_agg(DISTINCT NULLIF(BTRIM(s.bill_no), ''), ', ') FILTER (WHERE NOT ${IS_CLAIM}) AS sale_bill,
           string_agg(DISTINCT NULLIF(BTRIM(s.bill_no), ''), ', ') FILTER (WHERE ${IS_CLAIM}) AS claim_bill,
           count(*) FILTER (WHERE ${IS_CLAIM})::int AS claim_count,
           string_agg(DISTINCT NULLIF(BTRIM(concat_ws(' · ', s.claim_note, s.note)), ''), ' | ') AS claim_text
         FROM public.wms_samsung_serial s
         WHERE s.serial_no = i.sn
       ) c ON TRUE
       WHERE NULLIF(BTRIM(i.sn), '') IS NOT NULL
         AND inv.item_brand = 'SAMSUNG'
         AND (${cfg.filter})${qFilter}`;

  const [totals, countRows, rows] = await Promise.all([
    totalsPromise,
    query<{ count: number }>(`SELECT count(*)::int AS count ${detailWhere}`, args),
    query<DetailRow>(
      `SELECT i.sn, i.item_code, i.item_name, i.status, i.wh_code,
              c.sale_bill, c.claim_bill, COALESCE(c.claim_count, 0) AS claim_count, c.claim_text
       ${listFrom}
       ORDER BY i.item_code, i.sn
       LIMIT $${listArgs.length - 1} OFFSET $${listArgs.length}`,
      listArgs,
    ),
  ]);

  const s = totals[0] ?? { total: 0, in_stock: 0, sold: 0, claimed: 0, claimed_in_stock: 0, item_count: 0 };
  const count = countRows[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const hrefPage = (p: number) => {
    const sp = new URLSearchParams();
    sp.set("view", view);
    if (q) sp.set("q", q);
    if (p > 1) sp.set("page", String(p));
    return `/samsung-serials/summary?${sp}`;
  };

  return (
    <div className="space-y-5">
      <SummaryHeader />
      <KpiGrid s={s} active={view} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              ລາຍລະອຽດ: {cfg.label}
            </h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {count.toLocaleString("en-US")} SN
            </span>
          </div>
          <form method="get" className="flex gap-2">
            <input type="hidden" name="view" value={view} />
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                name="q"
                defaultValue={q}
                placeholder="ຄົ້ນຫາ SN, ລະຫັດ, ຊື່..."
                className="w-64 rounded-xl bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-zinc-950 dark:ring-zinc-700"
              />
            </div>
            <button className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              ຄົ້ນຫາ
            </button>
            <Link
              href="/samsung-serials/summary"
              className="inline-flex items-center rounded-xl px-3 py-2 text-sm font-semibold text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:ring-zinc-700"
            >
              ກັບສະຫຼຸບ
            </Link>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1120px] w-full text-left text-sm">
            <thead className="bg-zinc-50 text-[11px] uppercase tracking-wider text-zinc-500 dark:bg-zinc-950/60">
              <tr>
                <th className="px-4 py-3 font-semibold">Serial No.</th>
                <th className="px-4 py-3 font-semibold">ລະຫັດສິນຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ຊື່ສິນຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ສະຖານະ</th>
                <th className="px-4 py-3 font-semibold">ເລກບິນຂາຍຈິງ</th>
                <th className="px-4 py-3 font-semibold">ເລກບິນທີ່ເຄມ</th>
                <th className="px-4 py-3 font-semibold">ໝາຍເຫດ / ເຄມ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((row) => {
                const inStock = Number(row.status ?? 0) === 0;
                return (
                  <tr key={row.sn} className="align-top transition hover:bg-blue-50/40 dark:hover:bg-blue-950/10">
                    <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold text-blue-700 dark:text-blue-300">
                      {row.sn}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {row.item_code || "—"}
                    </td>
                    <td className="max-w-md px-4 py-3 text-zinc-800 dark:text-zinc-200">{row.item_name || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-semibold ${
                          inStock
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                        }`}
                      >
                        {inStock ? "ຢູ່ໃນສາງ" : Number(row.status) === 1 ? "ຂາຍອອກໄປ" : `ສະຖານະ ${row.status}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-emerald-700 dark:text-emerald-400">{row.sale_bill || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.claim_bill ? (
                        <div className="flex items-start gap-2">
                          <span className="text-amber-700 dark:text-amber-400">{row.claim_bill}</span>
                          {row.claim_count > 1 && (
                            <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60">
                              ×{row.claim_count}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      {row.claim_text ? (
                        <span className="inline-flex rounded-lg bg-violet-50 px-2 py-1 text-xs text-violet-800 ring-1 ring-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:ring-violet-900/50">
                          {row.claim_text}
                        </span>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && (
            <div className="px-6 py-16 text-center text-sm text-zinc-500">ບໍ່ພົບ SN ໃນມຸມມອງນີ້</div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
            <Link
              href={hrefPage(Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={`rounded-lg px-3 py-1.5 font-medium ring-1 ring-zinc-200 dark:ring-zinc-700 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
            >
              ກ່ອນໜ້າ
            </Link>
            <span className="text-xs text-zinc-500">ໜ້າ {Math.min(page, totalPages)} / {totalPages}</span>
            <Link
              href={hrefPage(Math.min(totalPages, page + 1))}
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

function SummaryHeader() {
  return (
    <Hero
      title="ສະຫຼຸບ SN Samsung"
      description="ນັບຈາກສາງຈິງ (sn_inventory · brand SAMSUNG) — ກົດທີ່ການ໌ດ ເພື່ອເບິ່ງລາຍລະອຽດ SN"
      icon={<TrendIcon className="h-6 w-6" />}
      tone="blue"
      right={
        <Link
          href="/samsung-serials"
          className="inline-flex rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-700"
        >
          ກັບລາຍການຫຼັກ
        </Link>
      }
    />
  );
}

function KpiGrid({ s, active }: { s: SummaryRow; active?: string }) {
  const cards = [
    { view: "total", icon: <ListIcon />, label: "ທັງໝົດ", value: s.total, sub: `${s.item_count.toLocaleString("en-US")} ລຸ້ນ`, tone: "blue" as const },
    { view: "in-stock", icon: <PackageIcon />, label: "ຍັງຄົງເຫຼືອ", value: s.in_stock, sub: "status 0", tone: "emerald" as const },
    { view: "sold", icon: <CheckIcon />, label: "ຂາຍ / ຈ່າຍອອກແລ້ວ", value: s.sold, sub: "status ≠ 0", tone: "amber" as const },
    { view: "claimed", icon: <TrendIcon />, label: "ເຄມແລ້ວ", value: s.claimed, sub: "ມີ note / claim_note", tone: "violet" as const },
    { view: "claimed-in-stock", icon: <AlertIcon />, label: "ເຄມແລ້ວ ແຕ່ຍັງຢູ່ສາງ", value: s.claimed_in_stock, sub: "ຄວນກວດ", tone: "red" as const },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <Link
          key={c.view}
          href={`/samsung-serials/summary?view=${c.view}`}
          className={`rounded-2xl transition ${active === c.view ? "ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-zinc-950" : ""}`}
        >
          <KpiCard icon={c.icon} label={c.label} value={c.value} sub={c.sub} tone={c.tone} highlight />
        </Link>
      ))}
    </div>
  );
}

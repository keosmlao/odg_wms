import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ROLE_LABEL_LO, accessibleWarehouses } from "@/lib/session-shared";
import { Notice as UiNotice } from "@/components/ui/Card";
import { AlertIcon, BuildingIcon, PackageIcon, SearchIcon } from "@/components/ui/Icons";
import SerialItemGroup from "./SerialItemGroup";
import SerialKpi from "./SerialKpi";

const STATUS_INSTOCK = "ຄົງເຫຼືອໃນສາງ";
const STATUS_ISSUED = "ຈ່າຍອອກແລ້ວ";
const PAGE_SIZE = 100;

type SearchParams = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return v?.trim() ?? "";
}
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}
function statusClause(status: string): string {
  if (status === "instock") return `b.status_name = '${STATUS_INSTOCK}'`;
  if (status === "issued") return `b.status_name = '${STATUS_ISSUED}'`;
  return "";
}

export default async function SerialsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.role) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ບັນຊີຂອງທ່ານຍັງບໍ່ມີສິດເຂົ້າເຖິງ WMS" />;
  }
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <UiNotice tone="amber" icon={<AlertIcon className="h-5 w-5" />} title="ຍັງບໍ່ມີສາງທີ່ມອບໝາຍໃຫ້ທ່ານ" />;
  }

  const params = await searchParams;
  const rawMode = pickStr(params.mode);
  const mode = rawMode === "wh" || rawMode === "search" ? rawMode : "item";
  const q = pickStr(params.q);
  const requestedWh = pickStr(params.wh);
  const status = pickStr(params.status) || "instock";
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  const whInfo =
    accessible === null
      ? await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 AND code IS NOT NULL ORDER BY code`,
        )
      : await query<{ code: string; name: string | null }>(
          `SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`,
          [accessible],
        );
  const allowed = new Set(whInfo.map((w) => w.code));
  const wh = requestedWh && allowed.has(requestedWh) ? requestedWh : "";

  // Scope clause builder
  function scope(start: unknown[]): { sql: string; args: unknown[] } {
    const where: string[] = [];
    const args = [...start];
    const sc = statusClause(status);
    if (sc) where.push(sc);
    if (Array.isArray(accessible)) {
      args.push(accessible);
      where.push(`b.wh_code = ANY($${args.length})`);
    }
    if (wh) {
      args.push(wh);
      where.push(`b.wh_code = $${args.length}`);
    }
    return { sql: where.length ? `WHERE ${where.join(" AND ")}` : "", args };
  }

  // KPI is loaded client-side (SerialKpi) so this page renders without waiting
  // on the full-view count scan.

  // Mode data
  let itemRows: { item_code: string; item_name: string | null; item_brand: string | null; count: number }[] = [];
  let itemHasMore = false;
  let whRows: { wh_code: string; wh_name: string | null; count: number; item_count: number }[] = [];
  let searchRows: { sn: string; item_code: string; item_name: string | null; wh_code: string; wh_name: string | null; item_brand: string | null; status_name: string | null }[] = [];
  let searchHasMore = false;

  if (mode === "item") {
    const { sql, args } = scope([]);
    const qWhere = q ? ` ${sql ? "AND" : "WHERE"} (b.item_code ILIKE $${args.length + 1} ESCAPE '\\' OR b.item_name ILIKE $${args.length + 1} ESCAPE '\\')` : "";
    const a = q ? [...args, `%${escapeLike(q)}%`] : args;
    a.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
    itemRows = await query(
      `SELECT b.item_code, MAX(b.item_name) AS item_name, MAX(b.item_brand) AS item_brand, count(*)::int AS count
       FROM public.odg_sn_balance b ${sql}${qWhere}
       GROUP BY b.item_code ORDER BY b.item_code
       LIMIT $${a.length - 1} OFFSET $${a.length}`,
      a,
    );
    itemHasMore = itemRows.length > PAGE_SIZE;
    if (itemHasMore) itemRows = itemRows.slice(0, PAGE_SIZE);
  } else if (mode === "wh") {
    const { sql, args } = scope([]);
    whRows = await query(
      `SELECT b.wh_code, MAX(b.wh_name) AS wh_name, count(*)::int AS count, count(DISTINCT b.item_code)::int AS item_count
       FROM public.odg_sn_balance b ${sql} GROUP BY b.wh_code ORDER BY b.wh_code`,
      args,
    );
  } else {
    // search
    if (q || wh) {
      const { sql, args } = scope([]);
      const qWhere = q ? ` ${sql ? "AND" : "WHERE"} (b.sn ILIKE $${args.length + 1} ESCAPE '\\' OR b.item_code ILIKE $${args.length + 1} ESCAPE '\\' OR b.item_name ILIKE $${args.length + 1} ESCAPE '\\')` : "";
      const a = q ? [...args, `%${escapeLike(q)}%`] : args;
      a.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
      searchRows = await query(
        `SELECT b.sn, b.item_code, b.item_name, b.wh_code, b.wh_name, b.item_brand, b.status_name
         FROM public.odg_sn_balance b ${sql}${qWhere}
         ORDER BY b.item_code, b.sn LIMIT $${a.length - 1} OFFSET $${a.length}`,
        a,
      );
      searchHasMore = searchRows.length > PAGE_SIZE;
      if (searchHasMore) searchRows = searchRows.slice(0, PAGE_SIZE);
    }
  }

  function href(over: Partial<{ mode: string; q: string; wh: string; status: string; page: string }>) {
    const sp = new URLSearchParams();
    const next = { mode: over.mode ?? mode, q: over.q ?? q, wh: over.wh ?? wh, status: over.status ?? status, page: over.page ?? "1" };
    if (next.mode !== "item") sp.set("mode", next.mode);
    if (next.q) sp.set("q", next.q);
    if (next.wh) sp.set("wh", next.wh);
    if (next.status !== "instock") sp.set("status", next.status);
    if (next.page && next.page !== "1") sp.set("page", next.page);
    const s = sp.toString();
    return s ? `/serials?${s}` : "/serials";
  }

  const modeTabs = [
    { key: "item", label: "ຕາມສິນຄ້າ" },
    { key: "wh", label: "ຕາມສາງ" },
    { key: "search", label: "ຄົ້ນຫາ / scan" },
  ];
  const statusTabs = [
    { key: "instock", label: "ຄົງເຫຼືອ" },
    { key: "issued", label: "ຈ່າຍອອກ" },
    { key: "all", label: "ທັງໝົด" },
  ];

  return (
    <div className="w-full space-y-4">
      <header className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
            <BarcodeIcon className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">ບໍລິຫານ Serial Number</h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">ຕິດຕາມ serial ຕາມສິນຄ້າ · ສາງ · ຄົ້ນຫາ/ສະແກນ</p>
          </div>
          <span className="ml-auto hidden rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 sm:inline dark:bg-zinc-800 dark:text-zinc-300">
            {ROLE_LABEL_LO[session.role]}
          </span>
        </div>

        {/* KPI (client-loaded) */}
        <SerialKpi wh={wh} />

        {/* Filters */}
        <form method="get" className="mt-4 grid gap-2.5 sm:grid-cols-[1fr_220px_auto]">
          <input type="hidden" name="mode" value={mode} />
          <input type="hidden" name="status" value={status} />
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder={mode === "search" ? "ສະແກນ / ພິມ serial..." : "ຄົ້ນຫາ ລະຫັດ / ຊື່ສິນຄ້າ..."}
              className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition focus:ring-2 focus:ring-violet-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
            />
          </div>
          <select name="wh" defaultValue={wh} className="rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-violet-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800">
            <option value="">{accessible === null ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${whInfo.length})`}</option>
            {whInfo.map((w) => (
              <option key={w.code} value={w.code}>{w.code}{w.name ? ` · ${w.name}` : ""}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-violet-500/20 transition hover:shadow-lg">ກອງ</button>
        </form>

        {/* Mode + status tabs */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {modeTabs.map((t) => (
              <Link key={t.key} href={href({ mode: t.key, page: "1" })}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition ${mode === t.key ? "bg-white text-violet-700 shadow-sm dark:bg-zinc-900 dark:text-violet-300" : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400"}`}>
                {t.label}
              </Link>
            ))}
          </div>
          <span className="text-zinc-300">|</span>
          {statusTabs.map((t) => (
            <Link key={t.key} href={href({ status: t.key, page: "1" })}
              className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${status === t.key ? "bg-violet-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"}`}>
              {t.label}
            </Link>
          ))}
        </div>
      </header>

      {/* Body */}
      <section className="overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {mode === "item" && (
          itemRows.length === 0 ? (
            <Empty
              title="ບໍ່ພົບສິນຄ້າທີ່ມີ serial"
              sub={status === "instock" ? "ບາງ serial ອາດຈ່າຍອອກໝົດແລ້ວ — ລອງ tab “ທັງໝົด”" : "ລອງປ່ຽນສາງ ຫຼື ຄຳຄົ້ນຫາ"}
            />
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {itemRows.map((r) => (
                <SerialItemGroup key={r.item_code} itemCode={r.item_code} itemName={r.item_name} itemBrand={r.item_brand} count={r.count} wh={wh} status={status} />
              ))}
            </div>
          )
        )}

        {mode === "wh" && (
          whRows.length === 0 ? (
            <Empty title="ບໍ່ພົບ serial ໃນສາງ" sub="ລອງປ່ຽນສະຖານະ" />
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {whRows.map((w) => (
                <Link key={w.wh_code} href={href({ mode: "item", wh: w.wh_code, page: "1" })}
                  className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 font-mono text-xs font-bold text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">{w.wh_code.slice(-2)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-50">{w.wh_code}{w.wh_name ? ` · ${w.wh_name}` : ""}</div>
                    <div className="text-xs text-zinc-500">{w.item_count.toLocaleString("en-US")} ສິນຄ້າ</div>
                  </div>
                  <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold tabular-nums text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{w.count.toLocaleString("en-US")} SN</span>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg>
                </Link>
              ))}
            </div>
          )
        )}

        {mode === "search" && (
          !q && !wh ? (
            <Empty title="ສະແກນ ຫຼື ພິມ ເພື່ອຄົ້ນຫາ serial" sub="ໃສ່ serial, ລະຫັດ/ຊື່ສິນຄ້າ ຫຼື ເລືອກສາງ" />
          ) : searchRows.length === 0 ? (
            <Empty title="ບໍ່ພົບ serial" sub={status === "instock" ? "ລອງ tab “ທັງໝົด” (ອາດຈ່າຍອອກແລ້ວ) ຫຼື ປ່ຽນຄຳຄົ້ນຫາ" : "ລອງປ່ຽນຄຳຄົ້ນຫາ"} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-100 bg-zinc-50/60 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/40">
                  <tr><th className="px-4 py-3">Serial</th><th className="px-4 py-3">ສິນຄ້າ</th><th className="px-4 py-3">ສາງ</th><th className="px-4 py-3">ສະຖານະ</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {searchRows.map((r) => {
                    const inStock = r.status_name === STATUS_INSTOCK;
                    return (
                      <tr key={`${r.sn}-${r.wh_code}`} className="group transition hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                        <td className="px-4 py-2.5"><Link href={`/serials/${encodeURIComponent(r.sn)}`} className="font-mono text-xs font-semibold text-violet-700 group-hover:underline dark:text-violet-300">{r.sn}</Link></td>
                        <td className="px-4 py-2.5"><div className="font-mono text-[11px] font-semibold text-zinc-900 dark:text-zinc-100">{r.item_code}</div><div className="max-w-[280px] truncate text-xs text-zinc-600 dark:text-zinc-400">{r.item_name ?? "—"}</div></td>
                        <td className="px-4 py-2.5 text-xs text-zinc-600 dark:text-zinc-400">{r.wh_code}</td>
                        <td className="px-4 py-2.5"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${inStock ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}><span className={`h-1.5 w-1.5 rounded-full ${inStock ? "bg-emerald-500" : "bg-zinc-400"}`} />{r.status_name ?? "—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </section>

      {/* Pagination (item / search) */}
      {((mode === "item" && (page > 1 || itemHasMore)) || (mode === "search" && (page > 1 || searchHasMore))) && (
        <nav className="shadow-card flex items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <span className="text-xs text-zinc-500">ໜ້າ {page}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">← ກ່ອນ</Link> : <span className="px-4 py-1.5 text-xs text-zinc-300">← ກ່ອນ</span>}
            {((mode === "item" && itemHasMore) || (mode === "search" && searchHasMore)) ? <Link href={href({ page: String(page + 1) })} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ຕໍ່ →</Link> : <span className="px-4 py-1.5 text-xs text-zinc-300">ຕໍ່ →</span>}
          </div>
        </nav>
      )}
    </div>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-4 py-16 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"><PackageIcon className="h-8 w-8" /></div>
      <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-200">{title}</p>
      <p className="mt-1 text-xs text-zinc-500">{sub}</p>
    </div>
  );
}

function BarcodeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14" />
    </svg>
  );
}

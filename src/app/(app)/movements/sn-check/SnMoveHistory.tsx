import Link from "next/link";
import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { Chip, KpiCard, EmptyState } from "@/components/ui/Card";
import { BuildingIcon, CalendarIcon, ListIcon, PackageIcon, SearchIcon, UserIcon } from "@/components/ui/Icons";
import DeleteSnMoveButton from "./DeleteSnMoveButton";

const PAGE_SIZE = 20;
const BASE = "/movements/sn-check";

type SearchParams = Record<string, string | string[] | undefined>;
function pick(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0]?.trim() ?? "") : (v?.trim() ?? "");
}
function fmtDate(s: string | null) {
  if (!s) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}
function locLabel(rack: string | null, location: string | null, pallet: string | null) {
  return [rack, location, pallet].filter(Boolean).join(" / ") || "(ສາງ)";
}

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  wh_code: string | null;
  wh_name: string | null;
  creator_code: string | null;
  creator_name: string | null;
  item_count: number | null;
  sn_count: number;
};
type LineRow = {
  doc_no: string;
  sn: string;
  isn: string | null;
  item_code: string | null;
  item_name: string | null;
  calc_flag: number | null;
  rack: string | null;
  location: string | null;
  pallet: string | null;
};

export default async function SnMoveHistory({ session, params }: { session: Session; params: SearchParams }) {
  const accessible = accessibleWarehouses(session);

  const search = pick(params.q);
  const requestedWh = pick(params.wh);
  const allTime = pick(params.all) === "1";
  const today = new Date().toISOString().slice(0, 10);
  const explicitFrom = pick(params.from);
  const explicitTo = pick(params.to);
  const fromDate = allTime ? "" : explicitFrom || (explicitTo ? "" : today);
  const toDate = allTime ? "" : explicitTo || (explicitFrom ? "" : today);
  const page = Math.max(1, Number.parseInt(pick(params.page), 10) || 1);

  const whOptions =
    accessible === null
      ? await query<{ code: string; name: string | null }>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE COALESCE(status,1)=1 ORDER BY code`)
      : await query<{ code: string; name: string | null }>(`SELECT code, name_1 AS name FROM public.ic_warehouse WHERE code = ANY($1) ORDER BY code`, [accessible]);
  const allowed = new Set(whOptions.map((w) => w.code));
  const wh = requestedWh && allowed.has(requestedWh) ? requestedWh : "";

  // SNMV = the serial-relocation docs written by the "ຍ້າຍ SN" action.
  const where: string[] = ["h.doc_format_code = 'SNMV'"];
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
      `(h.doc_no ILIKE $${i} OR h.user_created ILIKE $${i}
        OR EXISTS (SELECT 1 FROM public.sn_trans_detail d WHERE d.doc_no = h.doc_no AND (d.item_code ILIKE $${i} OR d.item_name ILIKE $${i} OR d.sn ILIKE $${i})))`,
    );
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const docs = await query<DocRow>(
    `SELECT h.doc_no,
            to_char(h.doc_date, 'YYYY-MM-DD') AS doc_date,
            h.wh_code, w.name_1 AS wh_name,
            h.user_created AS creator_code, e.fullname_lo AS creator_name,
            h.item_count,
            (SELECT count(*)::int FROM public.sn_trans_detail d WHERE d.doc_no = h.doc_no AND d.calc_flag > 0) AS sn_count
     FROM public.sn_trans h
     LEFT JOIN public.ic_warehouse w ON w.code = h.wh_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.user_created
     ${whereSql}
     ORDER BY h.doc_date DESC NULLS LAST, h.roworder DESC
     LIMIT ${PAGE_SIZE + 1} OFFSET ${(page - 1) * PAGE_SIZE}`,
    args,
  );
  const hasNext = docs.length > PAGE_SIZE;
  const pageDocs = hasNext ? docs.slice(0, PAGE_SIZE) : docs;

  const docNos = pageDocs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT doc_no, sn, isn, item_code, item_name, calc_flag, rack, location, pallet
         FROM public.sn_trans_detail WHERE doc_no = ANY($1) ORDER BY doc_no, item_code, sn, calc_flag`,
        [docNos],
      )
    : [];

  // Summarise per doc: source location(s), and destination groups
  // (item + to-location → list of serials), so a 300-serial move shows a few
  // summary rows that expand to the individual SN/ISN.
  type Dest = { item_code: string | null; item_name: string | null; to: string; serials: string[] };
  type DocAgg = { sources: Set<string>; dests: Map<string, Dest> };
  const aggByDoc = new Map<string, DocAgg>();
  for (const l of lines) {
    let g = aggByDoc.get(l.doc_no);
    if (!g) {
      g = { sources: new Set(), dests: new Map() };
      aggByDoc.set(l.doc_no, g);
    }
    const loc = locLabel(l.rack, l.location, l.pallet);
    if ((l.calc_flag ?? 0) < 0) {
      g.sources.add(loc);
    } else {
      const key = `${l.item_code}|${loc}`;
      let d = g.dests.get(key);
      if (!d) {
        d = { item_code: l.item_code, item_name: l.item_name, to: loc, serials: [] };
        g.dests.set(key, d);
      }
      d.serials.push(l.isn ?? l.sn ?? "—");
    }
  }

  const todayCount = pageDocs.filter((d) => d.doc_date === today).length;
  const dateLabel = allTime
    ? "ທຸກວັນ"
    : fromDate && toDate && fromDate === toDate
      ? fromDate === today ? "ມື້ນີ້" : fmtDate(fromDate)
      : fromDate && toDate ? `${fmtDate(fromDate)} → ${fmtDate(toDate)}` : fromDate ? fmtDate(fromDate) : toDate ? fmtDate(toDate) : "—";

  function href(over: Record<string, string>) {
    const sp = new URLSearchParams();
    sp.set("tab", "history");
    const next = { q: search, wh, from: explicitFrom, to: explicitTo, all: allTime ? "1" : "", page: String(page), ...over };
    for (const [k, v] of Object.entries(next)) if (v && !(k === "page" && v === "1")) sp.set(k, v);
    return `${BASE}?${sp.toString()}`;
  }

  const inputCls = "w-full rounded-lg bg-white px-3 py-2 text-sm text-zinc-900 ring-1 ring-zinc-200 outline-none transition hover:ring-zinc-300 focus:ring-2 focus:ring-aqua-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800";
  const labelCls = "mb-1.5 block text-xs font-semibold text-zinc-700 dark:text-zinc-300";

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-3">
        <KpiCard icon={<ListIcon className="h-4 w-4" />} label="ໃບຍ້າຍ (ໜ້ານີ້)" value={pageDocs.length} sub={dateLabel} />
        <KpiCard icon={<CalendarIcon className="h-4 w-4" />} label="ມື້ນີ້" value={todayCount} />
        <KpiCard icon={<BuildingIcon className="h-4 w-4" />} label="ສາງໃນສິດ" value={accessible === null ? "ທຸກສາງ" : `${whOptions.length}`} />
      </section>

      <form method="get" className="shadow-card rounded-2xl bg-white p-5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <input type="hidden" name="tab" value="history" />
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_170px_170px]">
          <div>
            <label className={labelCls}>ຄົ້ນຫາ (doc_no / SN / ສິນຄ້າ)</label>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input type="text" name="q" defaultValue={search} placeholder="ເຊັ່ນ SNMV260626 ຫຼື ເລກ SN" className={`${inputCls} pl-9`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>ສາງ</label>
            <select name="wh" defaultValue={wh} className={inputCls}>
              <option value="">{accessible === null ? "ທຸກສາງ" : `ສາງທີ່ຮັບຜິດຊອບ (${whOptions.length})`}</option>
              {whOptions.map((w) => (<option key={w.code} value={w.code}>{w.code} {w.name ? `· ${w.name}` : ""}</option>))}
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
            <Link href={`${BASE}?tab=history`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ມື້ນີ້</Link>
            <Link href={`${BASE}?tab=history&all=1`} className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ທຸກວັນ</Link>
          </div>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-aqua-600 to-brand-700 px-5 py-2 text-sm font-semibold text-white shadow-md shadow-aqua-500/20 transition hover:shadow-lg">ກອງ</button>
        </div>
      </form>

      {pageDocs.length === 0 ? (
        <EmptyState icon={<PackageIcon className="h-7 w-7" />} title="ບໍ່ມີປະຫວັດການຍ້າຍ SN ໃນຊ່ວງທີ່ເລືອກ" description='ລອງປ່ຽນຊ່ວງວັນທີ ຫຼື ກົດ "ທຸກວັນ"' />
      ) : (
        <div className="space-y-3">
          {pageDocs.map((d) => {
            const g = aggByDoc.get(d.doc_no);
            const dests = g ? Array.from(g.dests.values()) : [];
            const fromLabel = g && g.sources.size > 0 ? Array.from(g.sources).join(", ") : "—";
            return (
              <details key={d.doc_no} open={pageDocs.length <= 5} className="group shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-aqua-50 font-mono text-[10px] font-bold text-aqua-700 dark:bg-aqua-950/40 dark:text-aqua-300">
                    {(d.wh_code ?? "?").slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                      <Chip tone="aqua">ຍ້າຍ SN</Chip>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{fmtDate(d.doc_date)}</span>
                      <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{d.wh_code}{d.wh_name ? ` · ${d.wh_name}` : ""}</span>
                      <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{d.creator_name ?? d.creator_code ?? "—"}</span>
                      <span className="inline-flex items-center gap-1">📍 ຈາກ {fromLabel}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-base font-bold tabular-nums text-aqua-600 dark:text-aqua-400">{d.sn_count}</div>
                      <div className="text-[10px] text-zinc-400">SN ຍ້າຍ</div>
                    </div>
                    <DeleteSnMoveButton docNo={d.doc_no} snCount={d.sn_count} />
                  </div>
                </summary>
                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                        <th className="px-4 py-2">ສິນຄ້າ</th>
                        <th className="px-4 py-2">ໄປ location</th>
                        <th className="px-4 py-2 text-right">ຈຳນວນ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {dests.map((dg, idx) => (
                        <tr key={`${d.doc_no}-${dg.item_code}-${idx}`}>
                          <td className="px-4 py-2 align-top">
                            <div className="font-mono text-[11px] font-bold text-aqua-600 dark:text-aqua-400">{dg.item_code}</div>
                            <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={dg.item_name ?? ""}>{dg.item_name ?? "—"}</div>
                          </td>
                          <td className="px-4 py-2 align-top font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            → {dg.to}
                            {/* expandable list of the individual SN/ISN that landed here */}
                            <details className="mt-1">
                              <summary className="cursor-pointer text-[10px] font-normal text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">ເບິ່ງ {dg.serials.length} SN</summary>
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {dg.serials.map((s, i) => (
                                  <span key={`${s}-${i}`} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{s}</span>
                                ))}
                              </div>
                            </details>
                          </td>
                          <td className="px-4 py-2 align-top text-right font-mono text-sm font-bold tabular-nums text-zinc-800 dark:text-zinc-100">{dg.serials.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}

      {pageDocs.length > 0 && (
        <nav className="shadow-card flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">ໜ້າ <span className="font-semibold text-zinc-700 dark:text-zinc-200">{page}</span> · ສະແດງ {pageDocs.length}</div>
          <div className="flex gap-2">
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">← ກ່ອນໜ້າ</Link> : <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">← ກ່ອນໜ້າ</span>}
            {hasNext ? <Link href={href({ page: String(page + 1) })} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ໜ້າຕໍ່ →</Link> : <span className="cursor-not-allowed rounded-lg px-4 py-1.5 text-xs text-zinc-300 dark:text-zinc-700">ໜ້າຕໍ່ →</span>}
          </div>
        </nav>
      )}
    </div>
  );
}

import { Fragment } from "react";
import Link from "next/link";
import { query } from "@/lib/db";
import { type Session, accessibleWarehouses } from "@/lib/session-shared";
import { BuildingIcon, CalendarIcon, PackageIcon, SearchIcon, UserIcon } from "@/components/ui/Icons";
import DeleteReceiveButton from "./DeleteReceiveButton";
import EditReceiveButton from "./EditReceiveButton";

const PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;
function pickStr(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0]?.trim() ?? "";
  return v?.trim() ?? "";
}
function fmt(v: string | number | null) {
  const n = typeof v === "number" ? v : Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 4 }) : "0";
}

type DocRow = {
  doc_no: string;
  doc_date: string | null;
  doc_time: string | null;
  wh_code: string | null;
  wh_name: string | null;
  supplier_code: string | null;
  po_no: string | null;
  remark: string | null;
  creator_code: string | null;
  creator_name: string | null;
  line_count: number;
  total_qty: string;
};
type LineRow = {
  doc_no: string;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  qty: string;
  box_code: string | null;
  shelf_code: string | null;
};

export default async function ReceiveHistory({
  session,
  params,
}: {
  session: Session;
  params: SearchParams;
}) {
  const accessible = accessibleWarehouses(session);
  if (Array.isArray(accessible) && accessible.length === 0) {
    return <div className="rounded-2xl bg-white px-4 py-12 text-center text-sm text-zinc-500 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">ຍັງບໍ່ມີສາງທີ່ມອບໝາຍ</div>;
  }

  const q = pickStr(params.q);
  const page = Math.max(1, Number.parseInt(pickStr(params.page), 10) || 1);

  // Posted receipts only — count sheets (doc_type=2) live in their own tab.
  const where: string[] = ["COALESCE(h.doc_type,1) <> 2"];
  const args: unknown[] = [];
  if (Array.isArray(accessible)) {
    args.push(accessible);
    where.push(`h.warehouse_code = ANY($${args.length})`);
  }
  if (q) {
    args.push(`%${q}%`);
    const i = args.length;
    where.push(`(h.doc_no ILIKE $${i} OR h.ref_doc_no ILIKE $${i} OR h.supplier_code ILIKE $${i})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const docs = await query<DocRow>(
    `SELECT h.doc_no, to_char(h.doc_date,'YYYY-MM-DD') AS doc_date, h.doc_time,
            h.warehouse_code AS wh_code, w.name_1 AS wh_name, h.supplier_code,
            h.ref_doc_no AS po_no, h.remark, h.creator_code, e.fullname_lo AS creator_name,
            COALESCE(agg.line_count,0) AS line_count, COALESCE(agg.total_qty,0)::text AS total_qty
     FROM public.wms_product_receive h
     LEFT JOIN public.ic_warehouse w ON w.code = h.warehouse_code
     LEFT JOIN public.odg_employee e ON e.employee_code = h.creator_code
     LEFT JOIN (SELECT doc_no, count(*)::int AS line_count, SUM(qty) AS total_qty
                FROM public.wms_product_receive_detail GROUP BY doc_no) agg ON agg.doc_no = h.doc_no
     ${whereSql}
     ORDER BY h.doc_date DESC NULLS LAST, h.doc_time DESC NULLS LAST, h.doc_no DESC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE],
  );
  const hasMore = docs.length > PAGE_SIZE;
  const pageDocs = hasMore ? docs.slice(0, PAGE_SIZE) : docs;

  const docNos = pageDocs.map((d) => d.doc_no);
  const lines = docNos.length
    ? await query<LineRow>(
        `SELECT doc_no, item_code, item_name, unit_code, qty::text AS qty, box_code, shelf_code
         FROM public.wms_product_receive_detail WHERE doc_no = ANY($1) ORDER BY doc_no, roworder`,
        [docNos],
      )
    : [];
  const linesByDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const arr = linesByDoc.get(l.doc_no);
    if (arr) arr.push(l);
    else linesByDoc.set(l.doc_no, [l]);
  }

  // Generated ISN per receive (serial ledger, doc_no = receive code).
  const serials = docNos.length
    ? await query<{ doc_no: string; item_code: string; sn: string }>(
        `SELECT doc_no, item_code, sn FROM public.sn_trans_detail
         WHERE doc_no = ANY($1) ORDER BY doc_no, item_code, sn`,
        [docNos],
      )
    : [];
  const snByDocItem = new Map<string, string[]>();
  for (const s of serials) {
    const k = `${s.doc_no}|${s.item_code}`;
    const a = snByDocItem.get(k);
    if (a) a.push(s.sn);
    else snByDocItem.set(k, [s.sn]);
  }

  // Source count sheet per receipt (doc_type=2 ref) → enables "ແກ້ໄຂ" (void + reopen).
  const countRefs = docNos.length
    ? await query<{ rc: string; count_no: string }>(
        `SELECT r.doc_no AS rc, r.ref_doc_no AS count_no
         FROM public.wms_product_receive_ref r
         JOIN public.wms_product_receive cs ON cs.doc_no = r.ref_doc_no AND cs.doc_type = 2
         WHERE r.doc_no = ANY($1)`,
        [docNos],
      )
    : [];
  const countNoByRc = new Map(countRefs.map((r) => [r.rc, r.count_no]));

  return (
    <div className="space-y-4">
      <form method="get" className="shadow-card rounded-2xl bg-white p-4 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <input type="hidden" name="tab" value="history" />
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input type="text" name="q" defaultValue={q} placeholder="ຄົ້ນຫາ ໃບຮັບ / PO / ຜູ້ສະໜອງ..." className="w-full rounded-lg bg-white py-2 pl-9 pr-3 text-sm ring-1 ring-zinc-200 outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800" />
          </div>
          <button type="submit" className="rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-sm font-semibold text-white">ກອງ</button>
        </div>
      </form>

      {pageDocs.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-14 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <PackageIcon className="mx-auto h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <p className="mt-2 text-sm font-semibold text-zinc-500">ຍັງບໍ່ມີປະຫວັດການຮັບ</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pageDocs.map((d) => {
            const docLines = linesByDoc.get(d.doc_no) ?? [];
            return (
              <details key={d.doc_no} open={pageDocs.length <= 4} className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 font-mono text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {(d.wh_code ?? "?").slice(-2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-50">{d.doc_no}</span>
                      {d.po_no && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">PO {d.po_no}</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{d.doc_date ?? "—"}{d.doc_time ? ` ${d.doc_time}` : ""}</span>
                      <span className="inline-flex items-center gap-1"><UserIcon className="h-3 w-3" />{d.creator_name ?? d.creator_code ?? "—"}</span>
                      {d.wh_code && <span className="inline-flex items-center gap-1"><BuildingIcon className="h-3 w-3" />{d.wh_code}{d.wh_name ? ` · ${d.wh_name}` : ""}</span>}
                      {d.supplier_code && <span>ຜູ້ສະໜອງ: {d.supplier_code}</span>}
                      {d.remark && <span className="truncate">📝 {d.remark}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">+{fmt(d.total_qty)}</div>
                      <div className="text-[10px] text-zinc-400">{d.line_count} ລາຍການ</div>
                    </div>
                    {countNoByRc.has(d.doc_no) && <EditReceiveButton docNo={d.doc_no} countNo={countNoByRc.get(d.doc_no)!} />}
                    <DeleteReceiveButton docNo={d.doc_no} />
                  </div>
                </summary>
                <div className="border-t border-zinc-100 dark:border-zinc-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                        <th className="px-4 py-2">ສິນຄ້າ</th>
                        <th className="px-4 py-2">ບ່ອນເກັບ</th>
                        <th className="px-4 py-2 text-right">ຈຳນວນຮັບ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {docLines.map((l, idx) => {
                        const loc = [l.shelf_code, l.box_code].filter(Boolean).join(" / ");
                        const sns = snByDocItem.get(`${l.doc_no}|${l.item_code}`) ?? [];
                        return (
                          <Fragment key={`${l.doc_no}-${l.item_code}-${idx}`}>
                            <tr>
                              <td className="px-4 py-2">
                                <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-400">{l.item_code}</div>
                                <div className="truncate text-xs text-zinc-700 dark:text-zinc-300" title={l.item_name ?? ""}>{l.item_name ?? "—"}</div>
                              </td>
                              <td className="px-4 py-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{loc || "—"}</td>
                              <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                +{fmt(l.qty)}<span className="ml-1 text-[10px] uppercase text-zinc-400">{l.unit_code}</span>
                              </td>
                            </tr>
                            {sns.length > 0 && (
                              <tr>
                                <td colSpan={3} className="bg-aqua-50/40 px-4 py-2 dark:bg-aqua-950/10">
                                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-aqua-700 dark:text-aqua-300">Serial ({sns.length})</div>
                                  <div className="flex flex-wrap gap-1">
                                    {sns.map((sn) => (
                                      <Link key={sn} href={`/serials/${encodeURIComponent(sn)}`} className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-aqua-700 ring-1 ring-aqua-200 hover:bg-aqua-100 dark:bg-zinc-900 dark:text-aqua-300 dark:ring-aqua-900/50">
                                        {sn}
                                      </Link>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
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

      {pageDocs.length > 0 && (page > 1 || hasMore) && (
        <nav className="shadow-card flex items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <span className="text-xs text-zinc-500">ໜ້າ {page}</span>
          <div className="flex gap-2">
            {page > 1 ? <Link href={`/movements/receive?tab=history${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page - 1}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">← ກ່ອນ</Link> : <span className="px-4 py-1.5 text-xs text-zinc-300">← ກ່ອນ</span>}
            {hasMore ? <Link href={`/movements/receive?tab=history${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${page + 1}`} className="rounded-md bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">ຕໍ່ →</Link> : <span className="px-4 py-1.5 text-xs text-zinc-300">ຕໍ່ →</span>}
          </div>
        </nav>
      )}
    </div>
  );
}

import { query } from "@/lib/db";
import { EmptyState } from "@/components/ui/Card";
import { ListIcon } from "@/components/ui/Icons";
import { directionLabel, fmtQty } from "@/lib/stockCard";

/**
 * The batch documents entries were posted under, newest first, each expandable
 * to its lines. Server-rendered: this is a read-only audit view, so there is
 * nothing to hydrate and the whole page can stream.
 *
 * `accessible` follows the three-valued warehouse contract (null = all).
 */
type SearchParams = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 25;

type DocRow = {
  doc_no: string; wh_code: string; wh_name: string | null; doc_date: string | null; doc_time: string | null;
  remark: string | null; line_count: number; user_created: string | null;
  in_qty: string; out_qty: string;
};
type LineRow = {
  doc_no: string; item_code: string; item_name: string | null; unit_code: string | null;
  calc_flag: number; qty: string; rack_code: string | null; location_code: string | null;
};

function pick(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}

export default async function StockCardDocs({
  params, accessible,
}: { params: SearchParams; accessible: string[] | null }) {
  const page = Math.max(1, Number.parseInt(pick(params.page) || "1", 10) || 1);

  const where: string[] = [];
  const args: unknown[] = [];
  if (Array.isArray(accessible)) { args.push(accessible); where.push(`d.wh_code = ANY($${args.length})`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  args.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const docs = await query<DocRow>(
    `SELECT d.doc_no, d.wh_code, w.name_1 AS wh_name,
            to_char(d.doc_date, 'DD-MM-YYYY') AS doc_date, d.doc_time,
            d.remark, d.line_count, d.user_created,
            COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_entry e
                       WHERE e.doc_no = d.doc_no AND e.calc_flag = 1), 0)::text AS in_qty,
            COALESCE((SELECT SUM(qty) FROM public.odg_wms_stock_card_entry e
                       WHERE e.doc_no = d.doc_no AND e.calc_flag = -1), 0)::text AS out_qty
     FROM public.odg_wms_stock_card_doc d
     LEFT JOIN public.ic_warehouse w ON w.code = d.wh_code
     ${whereSql}
     ORDER BY d.created_at DESC
     LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args,
  );
  const hasNext = docs.length > PAGE_SIZE;
  const pageDocs = hasNext ? docs.slice(0, PAGE_SIZE) : docs;

  const lines = pageDocs.length
    ? await query<LineRow>(
        `SELECT doc_no, item_code, item_name, unit_code, calc_flag, qty::text, rack_code, location_code
         FROM public.odg_wms_stock_card_entry
         WHERE doc_no = ANY($1) ORDER BY doc_no, roworder`,
        [pageDocs.map((d) => d.doc_no)],
      )
    : [];
  const byDoc = new Map<string, LineRow[]>();
  for (const l of lines) {
    const a = byDoc.get(l.doc_no); if (a) a.push(l); else byDoc.set(l.doc_no, [l]);
  }

  if (pageDocs.length === 0) {
    return <EmptyState icon={<ListIcon className="h-6 w-6" />} title="ຍັງບໍ່ມີໃບບັນທຶກ"
      description="ໃບບັນທຶກຈະປາກົດຢູ່ນີ້ຫຼັງຈາກເພີ່ມຂໍ້ມູນເຂົ້າ stock card" />;
  }

  return (
    <div className="space-y-3">
      {pageDocs.map((d) => (
        <details key={d.doc_no} className="shadow-card overflow-hidden rounded-2xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
          <summary className="flex cursor-pointer flex-wrap items-center gap-3 p-3.5">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-indigo-600 dark:text-indigo-400">{d.doc_no}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{d.wh_code}{d.wh_name ? ` · ${d.wh_name}` : ""}</span>
                <span className="text-[11px] text-zinc-400">{d.doc_date} {d.doc_time}</span>
              </span>
              {d.remark && <span className="block truncate text-xs text-zinc-500">📝 {d.remark}</span>}
            </span>
            <span className="flex items-center gap-3 text-xs">
              {Number.parseFloat(d.in_qty) > 0 && <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">+{fmtQty(d.in_qty)}</span>}
              {Number.parseFloat(d.out_qty) > 0 && <span className="font-mono font-bold text-rose-600 dark:text-rose-400">−{fmtQty(d.out_qty)}</span>}
              <span className="text-[11px] text-zinc-400">{d.line_count} ລາຍການ · {d.user_created ?? "—"}</span>
            </span>
          </summary>
          <div className="overflow-x-auto border-t border-zinc-100 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-zinc-50 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:bg-zinc-800/50">
                  <th className="px-4 py-2">ປະເພດ</th>
                  <th className="px-4 py-2">ລະຫັດສິນຄ້າ</th>
                  <th className="px-4 py-2">ຊື່ສິນຄ້າ</th>
                  <th className="px-4 py-2">ບ່ອນເກັບ</th>
                  <th className="px-4 py-2 text-right">ຈຳນວນ</th>
                  <th className="px-4 py-2">ຫົວໜ່ວຍ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {(byDoc.get(d.doc_no) ?? []).map((l, i) => (
                  <tr key={`${l.item_code}-${i}`}>
                    <td className={`px-4 py-2 text-xs font-bold ${l.calc_flag === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{directionLabel(l.calc_flag)}</td>
                    <td className="px-4 py-2 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{l.item_code}</td>
                    <td className="px-4 py-2 max-w-sm truncate text-[13px] text-zinc-700 dark:text-zinc-300">{l.item_name ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-zinc-500">{l.rack_code ? `${l.rack_code}${l.location_code ? ` / ${l.location_code}` : ""}` : <span className="text-amber-600 dark:text-amber-400">ບໍ່ໄດ້ລະບຸ</span>}</td>
                    <td className={`px-4 py-2 text-right font-mono font-bold tabular-nums ${l.calc_flag === 1 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                      {l.calc_flag === 1 ? "+" : "−"}{fmtQty(l.qty)}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-zinc-400">{l.unit_code ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      {(page > 1 || hasNext) && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <a href={`/stock-card?tab=docs&page=${page - 1}`}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 dark:ring-zinc-800 ${page > 1 ? "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300" : "pointer-events-none opacity-40"}`}>← ກ່ອນໜ້າ</a>
          <span className="text-xs text-zinc-400">ໜ້າ {page}</span>
          <a href={`/stock-card?tab=docs&page=${page + 1}`}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ring-1 ring-zinc-200 dark:ring-zinc-800 ${hasNext ? "bg-white text-zinc-700 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300" : "pointer-events-none opacity-40"}`}>ຕໍ່ໄປ →</a>
        </div>
      )}
    </div>
  );
}
